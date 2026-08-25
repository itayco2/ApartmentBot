import { listingCityMatches } from '../../core/cities.js';
import type { CityEntry, Listing, SavedSearch, SourceAdapter } from '../../core/types.js';
import { logger } from '../../logger.js';
import { fetchText } from '../../util/http.js';
import { parseYad2Body } from './yad2Normalize.js';

const MAP_API = 'https://gw.yad2.co.il/realestate-feed/rent/map';

/**
 * Yad2 is Israel's largest board and the single richest source here.
 *
 * Its HTML site is genuinely unreachable - www.yad2.co.il answers a Radware
 * challenge with HTTP 200, which is what earlier attempts got stuck on - but
 * the gateway JSON API it calls is open. One request returns the city's entire
 * rental inventory, with no pagination.
 *
 * `region` is mandatory: omitting it returns HTTP 400 "region is required",
 * and sending `topArea` is rejected outright.
 */
export const yad2Adapter: SourceAdapter = {
  name: 'yad2',
  cadenceMinutes: 0,

  supports(_search: SavedSearch, city: CityEntry): boolean {
    return Boolean(city.yad2CityCode && city.yad2RegionCode);
  },

  async fetchListings(search: SavedSearch, city: CityEntry): Promise<Listing[]> {
    if (!city.yad2CityCode || !city.yad2RegionCode) return [];

    const url = `${MAP_API}?region=${city.yad2RegionCode}&city=${city.yad2CityCode}`;
    const body = await fetchText(url, {
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

    const listings = parseYad2Body(body, city.name).filter((l) =>
      listingCityMatches(city, l.city),
    );

    logger.debug({ search: search.id, city: city.key, found: listings.length }, 'yad2 fetch done');
    return listings;
  },
};
