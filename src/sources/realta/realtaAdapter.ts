import { listingCityMatches } from '../../core/cities.js';
import type { CityEntry, Listing, SavedSearch, SourceAdapter } from '../../core/types.js';
import { logger } from '../../logger.js';
import { fetchText } from '../../util/http.js';
import { parseRealtaListings } from './realtaNormalize.js';

const API = 'https://realta.co.il/api/v1/search/';
const PAGE_SIZE = 50;
const MAX_PAGES = 4;

/**
 * Realta aggregates Yad2, Madlan, OnMap, Homeless, Komo and Facebook into one
 * public JSON API. That matters twice over: Yad2 is otherwise unreachable
 * without a stealth browser (Radware blocks plain HTTP), and Facebook listings
 * arrive without touching the owner's account.
 *
 * The bot asks for the whole city and filters locally rather than sending
 * price bounds, so a listing whose price is missing or later corrected is
 * still seen. Rooms are left unfiltered for the same reason.
 */
export const realtaAdapter: SourceAdapter = {
  name: 'realta',
  cadenceMinutes: 0,

  supports(_search: SavedSearch, city: CityEntry): boolean {
    return Boolean(city.realtaSlug);
  },

  async fetchListings(search: SavedSearch, city: CityEntry): Promise<Listing[]> {
    if (!city.realtaSlug) return [];

    const collected: Listing[] = [];
    const seen = new Set<string>();

    for (let page = 0; page < MAX_PAGES; page++) {
      const url =
        `${API}?city=${encodeURIComponent(city.realtaSlug)}` +
        `&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&sortBy=newest`;

      const body = await fetchText(url, {
        source: 'realta',
        profile: 'desktop',
        headers: { Accept: 'application/json', Referer: 'https://realta.co.il/he/' },
      });

      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        logger.warn({ url }, 'realta returned a non-JSON body');
        break;
      }

      const listings = parseRealtaListings(payload, city.name);
      if (listings.length === 0) break;

      for (const listing of listings) {
        if (!listingCityMatches(city, listing.city)) continue;
        if (seen.has(listing.sourceId)) continue;
        seen.add(listing.sourceId);
        collected.push(listing);
      }

      if (listings.length < PAGE_SIZE) break;
    }

    logger.debug(
      { search: search.id, city: city.key, found: collected.length },
      'realta fetch complete',
    );
    return collected;
  },
};
