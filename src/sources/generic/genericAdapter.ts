import { createHash } from 'node:crypto';
import { listingCityMatches } from '../../core/cities.js';
import type { CityEntry, Listing, SavedSearch, SourceAdapter } from '../../core/types.js';
import { extractListingsFromHtml, type ExtractedListing } from '../../llm/extractListings.js';
import { isGeminiConfigured } from '../../llm/gemini.js';
import { logger } from '../../logger.js';
import { fetchText, randomBetween, sleep } from '../../util/http.js';
import { parseEntryDate, parsePostedDate } from '../../util/time.js';

export interface GenericSiteConfig {
  /** Adapter name; also the dedupe namespace, so keep it stable. */
  name: string;
  /** Shown on the message, e.g. "יאנגלו". */
  displayName: string;
  baseUrl: string;
  /** Pages to read for a city. More than one when the site splits by area. */
  urlsFor: (city: CityEntry) => string[];
  profile?: 'desktop' | 'mobile';
  /** Narrows the page before extraction, saving tokens on big pages. */
  contentSelector?: string;
  /** Cities this site covers; omit for nationwide sites. */
  cityKeys?: string[];
}

/**
 * Builds a source adapter that reads a site with no site-specific parser:
 * fetch the page, reduce it to text, let the model pull the listings out.
 *
 * This is how the bot covers the long tail of Israeli rental boards without a
 * bespoke scraper - and without going quiet when one of them redesigns.
 */
export function createGenericAdapter(
  config: GenericSiteConfig,
  cadenceMinutes: number,
): SourceAdapter {
  return {
    name: config.name,
    cadenceMinutes,

    supports(_search: SavedSearch, city: CityEntry): boolean {
      if (!isGeminiConfigured()) return false;
      if (config.cityKeys && !config.cityKeys.includes(city.key)) return false;
      return config.urlsFor(city).length > 0;
    },

    async fetchListings(_search: SavedSearch, city: CityEntry): Promise<Listing[]> {
      // Without the model the pages cannot be read, so do not even fetch them.
      if (!isGeminiConfigured()) return [];

      const byId = new Map<string, Listing>();

      for (const url of config.urlsFor(city)) {
        let html: string;
        try {
          html = await fetchText(url, {
            source: config.name,
            profile: config.profile ?? 'desktop',
          });
        } catch (error) {
          // One bad page should not lose the site's other pages.
          logger.warn({ err: error, url, source: config.name }, 'generic source page failed');
          continue;
        }

        const extracted = await extractListingsFromHtml(
          html,
          city.name,
          config.name,
          config.contentSelector,
        );

        for (const raw of extracted) {
          const listing = toListing(raw, config, city);
          if (!listing) continue;
          if (!byId.has(listing.sourceId)) byId.set(listing.sourceId, listing);
        }

        await sleep(randomBetween(2_000, 5_000));
      }

      logger.debug({ source: config.name, city: city.key, found: byId.size }, 'generic fetch done');
      return [...byId.values()];
    },
  };
}

function toListing(
  raw: ExtractedListing,
  config: GenericSiteConfig,
  city: CityEntry,
): Listing | null {
  // The model is told to skip other cities, but it is the dedupe key and the
  // alert that pay for a mistake, so the check is repeated here.
  if (raw.city && !listingCityMatches(city, raw.city)) return null;
  // A listing with neither price nor rooms is almost always a misread heading.
  if (raw.price === null && raw.rooms === null) return null;
  // Boards mix shops and offices into the same rental index; a live run
  // surfaced "Commercial real estate in Modi'in" as an apartment alert.
  if (looksCommercial(raw)) return null;

  const url = absoluteUrl(raw.url, config.baseUrl);

  return {
    source: config.name,
    sourceId: stableId(raw, config, url),
    url: url ?? config.baseUrl,
    price: plausiblePrice(raw.price, raw.rooms),
    rooms: raw.rooms,
    city: raw.city ?? city.name,
    ...(raw.neighborhood ? { neighborhood: raw.neighborhood } : {}),
    ...(raw.street ? { address: raw.street } : {}),
    ...(raw.propertyType ? { propertyType: raw.propertyType } : {}),
    ...(raw.sqm ? { sqm: raw.sqm } : {}),
    ...(raw.floor ? { floor: raw.floor } : {}),
    amenities: raw.amenities,
    ...(raw.description ? { description: raw.description } : {}),
    ...(parsePostedDate(raw.postedText) ? { postedAt: parsePostedDate(raw.postedText) as Date } : {}),
    ...(raw.entryText ? { entryText: raw.entryText } : {}),
    ...(parseEntryDate(raw.entryText) ? { entryDate: parseEntryDate(raw.entryText) as Date } : {}),
    imageUrls: imageUrlsFor(raw.imageUrl, config.baseUrl),
    originalSource: config.displayName,
    ...(raw.isBroker !== null ? { isBroker: raw.isBroker } : {}),
  };
}

/**
 * The property type is a short label, so a word appearing in it means the
 * listing IS that thing.
 */
const COMMERCIAL_TYPES =
  /מחסן|חניה|חנייה|משרד|חנות|מסחרי|קליניקה|מגרש|תעשי|storage|parking|office|shop|store|commercial/i;

/**
 * Descriptions are free prose, where the same words are usually amenities: an
 * apartment "עם מחסן וחניה" has a storage room and a parking space. Only
 * phrases that cannot describe a home are matched here.
 *
 * Hebrew also has no usable word boundaries, so short stems match inside
 * innocent words - a bare "עסק" also matches "עסקה" (a transaction), which
 * appears in most property copy and silently discarded an entire source.
 */
const COMMERCIAL_PHRASES =
  /נדל[״"']?ן מסחרי|(?:חנות|משרד|קליניקה|מחסן|מגרש)\s+להשכרה|מבנה תעשייה|בית עסק|commercial (?:real estate|property)|office space|storefront/i;

/** True when the listing is business premises rather than somewhere to live. */
export function looksCommercial(
  raw: Pick<ExtractedListing, 'propertyType' | 'description'>,
): boolean {
  if (raw.propertyType && COMMERCIAL_TYPES.test(raw.propertyType)) return true;
  return Boolean(raw.description && COMMERCIAL_PHRASES.test(raw.description));
}

/**
 * Rejects prices the model has clearly misread.
 *
 * Pages carry other numbers - agency fees, deposits, price-per-metre - and a
 * model will occasionally grab one. A observed real case: "750 ₪" attached to
 * a 4.5-room flat. Nulling it keeps the listing (it still shows as "price not
 * stated") while stopping a wrong number from satisfying a price filter.
 */
export function plausiblePrice(price: number | null, rooms: number | null): number | null {
  if (price === null) return null;
  if (price < 500 || price > 200_000) return null;
  // Roughly 500 NIS per room is far below any real Israeli rent.
  if (rooms !== null && rooms >= 2 && price < rooms * 500) return null;
  return price;
}

/**
 * Dedupe key. Prefers the site's own id, then the listing URL. Falls back to a
 * hash of the listing's own facts - without which a site that publishes no ids
 * would re-alert the same flat on every run.
 */
function stableId(
  raw: ExtractedListing,
  config: GenericSiteConfig,
  url: string | null,
): string {
  if (raw.externalId) return raw.externalId;
  if (url && url !== config.baseUrl) return url;

  const fingerprint = [raw.price, raw.rooms, raw.sqm, raw.street, raw.neighborhood, raw.floor]
    .map((v) => v ?? '')
    .join('|');
  return `fp_${createHash('sha1').update(fingerprint).digest('hex').slice(0, 16)}`;
}

/** Telegram fetches photos itself, so only absolute https urls are usable. */
function imageUrlsFor(imageUrl: string | null, baseUrl: string): string[] {
  const absolute = absoluteUrl(imageUrl, baseUrl);
  return absolute && absolute.startsWith('https://') ? [absolute] : [];
}

function absoluteUrl(url: string | null, baseUrl: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return null;
  }
}
