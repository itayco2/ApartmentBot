import type { CityEntry } from '../../core/types.js';
import type { GenericSiteConfig } from './genericAdapter.js';

/**
 * How often the model-extracted sources are read, in minutes.
 *
 * Sources read by the model are expensive and slow, so they run on their own
 * schedule while the native parsers keep alerting every cycle. Hourly is
 * about 120 Gemini calls a day across the five of them - roughly an eighth of
 * the free daily quota, and a 5-call burst against a 15-per-minute ceiling
 * since the sources are fetched in parallel. There is room to halve this
 * again if fresher data is ever worth it.
 */
export const GENERIC_CADENCE_MINUTES = 60;

/**
 * Sites read via the model rather than a bespoke parser.
 *
 * Adding one is a URL and a display name - no selectors, no normaliser, no
 * fixture. That is the whole point: the long tail of Israeli rental boards is
 * too large and too changeable to hand-write a scraper for each.
 */
export const GENERIC_SITES: GenericSiteConfig[] = [
  {
    name: 'janglo',
    displayName: 'יאנגלו',
    baseUrl: 'https://www.janglo.net',
    // English-language board, strong for the Modi'in / Chashmonaim area.
    cityKeys: ['modiin'],
    urlsFor: () => ['https://www.janglo.net/real-estate-rentals/modiin'],
  },
  {
    name: 'anglosaxon',
    displayName: 'אנגלו סכסון',
    baseUrl: 'https://www.anglo-saxon.co.il',
    // The largest single Modi'in rental inventory found anywhere (~47). It
    // publishes no dates at all, so first-sight seeding is what keeps its back
    // catalogue out of the alert stream.
    cityKeys: ['modiin'],
    urlsFor: (city) => [
      `https://www.anglo-saxon.co.il/locales/${encodeURIComponent(city.name)}/?type=${encodeURIComponent('דירות_להשכרה')}`,
    ],
  },
  {
    name: 'homely',
    displayName: 'Homely MLS',
    baseUrl: 'https://www.homely-mls.co.il',
    // Israeli agents' MLS. Small, but its listings skew to normal budgets and
    // several sit in ranges the big boards were empty at.
    // id=80 is residential rent; cityId=48 is Modi'in-Maccabim-Re'ut.
    cityKeys: ['modiin'],
    urlsFor: () => ['https://www.homely-mls.co.il/index2.php?id=80&cityId=48&lang=HEB'],
  },
  {
    name: 'ktovet',
    displayName: 'כתובת מודיעין',
    baseUrl: 'https://ktovet-modiin.co.il',
    // Hyper-local Modi'in board; small but carries private ads the big
    // boards never see.
    cityKeys: ['modiin'],
    urlsFor: () => ['https://ktovet-modiin.co.il/for-rent/'],
  },
  {
    name: 'komo',
    displayName: 'קומו',
    baseUrl: 'https://www.komo.co.il',
    // cityName must use the spaced spelling, not the hyphenated one.
    // orderBy puts the most recently updated ads first, which matters because
    // the default ordering is not by date.
    urlsFor: (city) => [
      `https://www.komo.co.il/code/nadlan/apartments-for-rent.asp?cityName=${encodeURIComponent(city.name)}&orderBy=LastUpdate:Desc`,
    ],
  },
];

/**
 * Two sources were tried and removed.
 *
 * ad.co.il orders its rental index by "popularity" with no working sort
 * override - every sort parameter tested was ignored - so its top results were
 * ads created in 2023 that have long since been let. A board that cannot be
 * asked for its newest listings is worse than useless to an alerting bot.
 *
 * luxuryestate.com was reachable and parsed cleanly, but every Modi'in listing
 * it carried was an agency ad in the ₪6,400-9,200 band. It added noise at the
 * top of the market rather than flats anyone here is looking for.
 */

export function sitesForCity(city: CityEntry): GenericSiteConfig[] {
  return GENERIC_SITES.filter((s) => !s.cityKeys || s.cityKeys.includes(city.key));
}
