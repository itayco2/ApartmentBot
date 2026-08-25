import { listingCityMatches } from '../../core/cities.js';
import type { CityEntry, Listing, SavedSearch, SourceAdapter } from '../../core/types.js';
import { logger } from '../../logger.js';
import { fetchText } from '../../util/http.js';
import { parseOnmapListings } from './onmapNormalize.js';

const API = 'https://phoenix.onmap.co.il/v1/properties/mixed_search';

/**
 * OnMap's public backend, which needs no authentication.
 *
 * Its city filter is geographic rather than a name match: the value is a slug
 * and the server resolves it to a polygon, so listings just outside a city's
 * label but inside its boundary are included. Results are still checked
 * against the city name locally.
 *
 * The slugs are OnMap's own transliterations and do not match anyone else's
 * ("rishon-letsiyon" here, "rishon-le-tsiyon" on Realta), so each is recorded
 * in the city table rather than derived.
 */
export const onmapAdapter: SourceAdapter = {
  name: 'onmap',
  cadenceMinutes: 0,

  supports(_search: SavedSearch, city: CityEntry): boolean {
    return Boolean(city.onmapSlug);
  },

  async fetchListings(search: SavedSearch, city: CityEntry): Promise<Listing[]> {
    if (!city.onmapSlug) return [];

    const url =
      `${API}?option=rent,rent-short&section=residence&country=Israel` +
      `&city=${encodeURIComponent(city.onmapSlug)}&$limit=100&$skip=0&$sort=-search_date`;

    const body = await fetchText(url, {
      source: 'onmap',
      profile: 'desktop',
      headers: {
        Accept: 'application/json',
        Origin: 'https://www.onmap.co.il',
        Referer: 'https://www.onmap.co.il/',
      },
    });

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      logger.warn({ url }, 'onmap returned a non-JSON body');
      return [];
    }

    const listings = parseOnmapListings(payload, city.name).filter((l) =>
      listingCityMatches(city, l.city),
    );

    logger.debug({ search: search.id, city: city.key, found: listings.length }, 'onmap fetch done');
    return listings;
  },
};
