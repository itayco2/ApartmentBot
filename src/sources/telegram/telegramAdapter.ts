import { listingCityMatches } from '../../core/cities.js';
import { MAX_LISTING_AGE_DAYS } from '../../core/filter.js';
import type {
  CityEntry,
  Listing,
  SavedSearch,
  SourceAdapter,
  StoredListings,
} from '../../core/types.js';
import { extractPosts, type ParsedPost } from '../../llm/extractPosts.js';
import { isGeminiConfigured, redactPhones } from '../../llm/gemini.js';
import { logger } from '../../logger.js';
import { fetchText } from '../../util/http.js';
import { daysBetween, parseEntryDate } from '../../util/time.js';
import { ParsedPostCache } from '../parsedPostCache.js';
import { channelsForCity, type TelegramChannel } from './channels.js';
import { parseChannelPage, type ChannelPost } from './telegramParse.js';

const SOURCE = 'telegram';
/** Posts the model has already judged are not sent again for a day. */
const PARSED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Reads public Telegram rental channels through their web preview.
 *
 * Same shape as the Facebook source - free-text posts, batched through the
 * model, only the unjudged ones - but with none of its risk: the preview
 * page needs no account, so nothing can expire or be flagged.
 */
export function createTelegramAdapter(stored: StoredListings): SourceAdapter {
  const judged = new ParsedPostCache(PARSED_TTL_MS);

  return {
    name: SOURCE,
    // A channel shows its last ~20 posts; twenty minutes keeps up with a
    // busy one without re-reading the same page every five.
    cadenceMinutes: 20,

    supports(_search: SavedSearch, city: CityEntry): boolean {
      return isGeminiConfigured() && channelsForCity(city).length > 0;
    },

    async fetchListings(_search: SavedSearch, city: CityEntry): Promise<Listing[]> {
      const listings: Listing[] = [];

      for (const channel of channelsForCity(city)) {
        const html = await fetchText(`https://t.me/s/${channel.name}`, {
          source: SOURCE,
          profile: 'desktop',
        });
        const page = parseChannelPage(html, channel.name);
        const title = page.title ?? channel.title;

        // Channels keep years of history; the 30-day rule applies up front
        // so old posts are never sent to the model at all.
        const recent = page.posts.filter(
          (post) => !post.postedAt || daysBetween(post.postedAt) <= MAX_LISTING_AGE_DAYS,
        );

        const unjudged: ChannelPost[] = [];
        for (const post of recent) {
          const known = stored.find(SOURCE, post.id);
          if (known) {
            listings.push(known);
            continue;
          }
          if (!judged.has(SOURCE, post.id)) unjudged.push(post);
        }

        const parsed = await extractPosts(
          unjudged.map((post) => ({ id: post.id, text: post.text })),
          city.name,
          SOURCE,
        );

        for (const post of unjudged) {
          const result = parsed.get(post.id);
          if (!result) continue;
          judged.add(SOURCE, post.id);
          const listing = toListing(post, result, title, city);
          if (listing) listings.push(listing);
        }

        logger.debug(
          { channel: channel.name, posts: page.posts.length, sentToModel: unjudged.length },
          'telegram channel read',
        );
      }

      return listings;
    },
  };
}

/** Exported for tests: the pure mapping from a judged post to a listing. */
export function toListing(
  post: ChannelPost,
  parsed: ParsedPost,
  channelTitle: TelegramChannel['title'],
  city: CityEntry,
): Listing | null {
  if (!parsed.isRentalListing || parsed.isWantedPost) return null;
  // The channel implies the city; a post naming a different one is not ours.
  if (parsed.city && !listingCityMatches(city, parsed.city)) return null;

  // Phone numbers never left the machine; re-attach them for the owner. The
  // first becomes the WhatsApp button; any others stay in the text.
  const [phone, ...morePhones] = redactPhones(post.text).phones;
  const description = [parsed.summary, morePhones.length > 0 ? `📞 ${morePhones.join(' · ')}` : null]
    .filter(Boolean)
    .join('\n');
  const entryDate = parseEntryDate(parsed.entryDateText);

  return {
    source: SOURCE,
    sourceId: post.id,
    url: post.url,
    price: parsed.price,
    rooms: parsed.rooms,
    city: parsed.city ?? city.name,
    ...(parsed.neighborhood ? { neighborhood: parsed.neighborhood } : {}),
    ...(parsed.street ? { address: parsed.street } : {}),
    ...(parsed.propertyType ? { propertyType: parsed.propertyType } : {}),
    ...(parsed.sqm ? { sqm: parsed.sqm } : {}),
    ...(parsed.floor ? { floor: parsed.floor } : {}),
    amenities: parsed.amenities,
    ...(description ? { description } : {}),
    imageUrls: post.photo ? [post.photo] : [],
    ...(post.postedAt ? { postedAt: post.postedAt } : {}),
    ...(parsed.entryDateText ? { entryText: parsed.entryDateText } : {}),
    ...(entryDate ? { entryDate } : {}),
    ...(phone ? { phone } : {}),
    originalSource: `טלגרם · ${channelTitle}`,
    ...(parsed.isBroker !== null ? { isBroker: parsed.isBroker } : {}),
  };
}
