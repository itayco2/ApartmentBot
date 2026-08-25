import { listingCityMatches } from '../../core/cities.js';
import type { CityEntry, Listing, SavedSearch, SourceAdapter } from '../../core/types.js';
import { logger } from '../../logger.js';
import { fetchText } from '../../util/http.js';
import { parseHomelessListings } from './homelessParse.js';

const MOBILE_BASE = 'https://m.homeless.co.il/rent';

/**
 * homeless.co.il renders its desktop results into a JavaScript-populated
 * iframe, but the mobile site returns the same listings as plain HTML, so the
 * adapter reads the mobile site.
 *
 * Two queries are combined because they return different sets: the city query
 * is exact but shallow, while the region query is wider and includes
 * neighbouring towns, which are then filtered out by city name.
 */
export const homelessAdapter: SourceAdapter = {
  name: 'homeless',
  cadenceMinutes: 0,

  supports(): boolean {
    return true; // URLs derive from the city name, so every city works.
  },

  async fetchListings(search: SavedSearch, city: CityEntry): Promise<Listing[]> {
    const urls = [`${MOBILE_BASE}?city=${encodeURIComponent(city.name)}`];
    if (city.homelessRegionCode) {
      urls.push(`${MOBILE_BASE}?inumber1=${encodeURIComponent(city.homelessRegionCode)}`);
    }

    const byId = new Map<string, Listing>();
    for (const url of urls) {
      const html = await fetchText(url, { source: 'homeless', profile: 'mobile' });

      for (const listing of parseHomelessListings(html)) {
        if (!listingCityMatches(city, listing.city)) continue;
        if (!byId.has(listing.sourceId)) byId.set(listing.sourceId, listing);
      }
    }

    logger.debug({ search: search.id, city: city.key, found: byId.size }, 'homeless fetch complete');
    return [...byId.values()];
  },
};
