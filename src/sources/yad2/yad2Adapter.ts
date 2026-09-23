import { listingCityMatches } from '../../core/cities.js';
import {
  BlockedError,
  type CityEntry,
  type FetchOptions,
  type Listing,
  type SavedSearch,
  type SourceAdapter,
} from '../../core/types.js';
import { logger } from '../../logger.js';
import { fetchText } from '../../util/http.js';
import { parseYad2FeedBody, type Yad2FeedPage } from './yad2Normalize.js';

const FEED_API = 'https://gw.yad2.co.il/realestate-feed/rent/feed';

/**
 * Pages read at least, once the adapter has read the city before.
 *
 * The feed is ordered by last update, and a bump counts as one, so whatever changed since
 * the last read sits at the top. One page can still be all bumps with a new ad just below
 * it; a second page is cheap insurance.
 */
export const MIN_PAGES = 2;

/**
 * Pages read at most. A restart forgets what was read, so the first walk goes this deep:
 * it is the catch-up after the PC was switched off. Ten pages is ~400 ads, several hours of
 * Tel Aviv's updates; an ad that sank further while the bot was down is lost, by design.
 */
export const MAX_PAGES = 10;

/** One page of a city's rental feed, as the raw response body. */
export type FeedFetcher = (city: CityEntry, page: number) => Promise<string>;

/**
 * Only `region`, `city` and `page` are ever sent. Any other parameter (`order=1` and
 * `sort=1` were tried) makes the gateway's firewall answer with a block record instead of
 * data, and that record carries the caller's IP address.
 */
export const fetchFeedPage: FeedFetcher = (city, page) =>
  fetchText(`${FEED_API}?region=${city.yad2RegionCode}&city=${city.yad2CityCode}&page=${page}`, {
    source: 'yad2',
    profile: 'desktop',
    headers: {
      Accept: 'application/json, text/plain, */*',
      // The gateway is a different subdomain, so it checks CORS headers.
      Origin: 'https://www.yad2.co.il',
      Referer: 'https://www.yad2.co.il/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
    },
  });

/**
 * Yad2 is Israel's largest board and the single richest source here.
 *
 * Its website answers a Radware challenge, but the gateway API the site calls is open. The
 * map endpoint this adapter used to read returned at most 200 ads per city, and a sample
 * rather than the newest: 188 of Tel Aviv's 4,769 on 2026-09-23. The feed pages through all
 * of them.
 *
 * `region` is mandatory, and a wrong one returns an empty city with HTTP 200, which is why
 * the codes come from Yad2 itself (see cities.generated.ts) and never from a guess.
 */
export function createYad2Adapter(fetchPage: FeedFetcher = fetchFeedPage): SourceAdapter {
  // Tokens read so far, per city. Memory is enough: it only decides how deep to read, and
  // losing it on restart is exactly what makes the first walk a catch-up. Only poll cycles
  // write it; previews walk on a copy.
  const seenByCity = new Map<string, Set<string>>();

  return {
    name: 'yad2',
    cadenceMinutes: 0,

    supports(_search: SavedSearch, city: CityEntry): boolean {
      return Boolean(city.yad2CityCode && city.yad2RegionCode);
    },

    async fetchListings(search: SavedSearch, city: CityEntry, options?: FetchOptions): Promise<Listing[]> {
      if (!city.yad2CityCode || !city.yad2RegionCode) return [];

      const remembered = seenByCity.get(city.key) ?? new Set<string>();
      if (!options?.preview) seenByCity.set(city.key, remembered);
      // A preview walks on a copy: it may use what poll cycles have read, but what it reads
      // itself never reaches the alert path, so counting it would make the next cycle stop
      // early. A /latest sent after a restart would otherwise swallow the whole catch-up.
      const seen = options?.preview ? new Set(remembered) : remembered;
      const collected = new Map<string, Listing>();
      let pagesRead = 0;

      for (let page = 1; page <= MAX_PAGES; page++) {
        let feed: Yad2FeedPage;
        try {
          feed = parseYad2FeedBody(await fetchPage(city, page), city.name);
        } catch (error) {
          // A block always surfaces so the source backs off, and so does a failed first
          // page, or the city would just look empty. A later page is worth losing instead.
          if (page === 1 || error instanceof BlockedError) throw error;
          logger.warn({ err: error, city: city.key, page }, 'yad2 page failed, keeping earlier pages');
          break;
        }
        pagesRead = page;

        const sawNew = feed.tokens.some((token) => !seen.has(token));
        for (const token of feed.tokens) seen.add(token);
        for (const listing of feed.listings) {
          if (listingCityMatches(city, listing.city)) collected.set(listing.sourceId, listing);
        }

        if (page >= feed.totalPages) break;
        if (page >= MIN_PAGES && !sawNew) break;
      }

      logger.debug(
        { search: search.id, city: city.key, pages: pagesRead, found: collected.size },
        'yad2 fetch done',
      );
      return [...collected.values()];
    },
  };
}
