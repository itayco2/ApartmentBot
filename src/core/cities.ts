import type { CityEntry } from './types.js';

/**
 * Hebrew city names are written inconsistently across sites
 * ("מודיעין-מכבים-רעות" vs "מודיעין מכבים רעות"), so every comparison goes
 * through this. Hyphens become spaces and runs of whitespace collapse.
 */
export function normalizeCityName(raw: string): string {
  return collapseKtiv(
    raw
      .replace(/["'״׳]/g, '')
      .replace(/[-־–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Reduces full spelling to defective (כתיב מלא → חסר), so the same name
 * written either way compares equal.
 *
 * Each board picks its own spelling: Realta publishes "נוה הדרים" where the
 * "צפון ראשון" alias says "נווה הדרים", and that one vav was enough to drop
 * every listing in the neighbourhood from a filtered search, silently. The
 * same split is why `CITIES` carries "פתח תקוה" as an alias of "פתח תקווה"
 * and why the alias list once spelled קרית גנים twice - spelling variants
 * patched one at a time, as each was noticed.
 *
 * Doubled vav and yod are a spelling choice within a word, never a different
 * word, so collapsing them cannot merge two real places. Only doubling
 * *inside* a word is touched: a leading ו is the conjunction "and".
 */
function collapseKtiv(text: string): string {
  return text.replace(/(?<=[א-ת])וו/gu, 'ו').replace(/(?<=[א-ת])יי/gu, 'י');
}

/**
 * Normalizes a street or neighbourhood for comparison.
 *
 * Sources spell the same place several ways - רמב"ם, רמב''ם and רמב``ם all
 * appear in real data - and a street arrives with its house number attached
 * ("עמק איילון 4"). Both are stripped so "עמק איילון 4" and "עמק איילון"
 * count as the same street.
 */
export function normalizePlace(raw: string): string {
  return normalizeCityName(raw.replace(/[`]/g, ''))
    .replace(/^(רחוב|רח|שדרות|שד|סמטת|דרך)\s+/u, '')
    .replace(/\s+\d+[א-ת]?$/u, '')
    .trim();
}

/**
 * Cities the /add wizard offers. Homeless and Madlan work for any Israeli
 * city because their URLs derive from the name, so adding one here is just a
 * convenience - plus the place to record source-specific codes when known.
 */
export const CITIES: CityEntry[] = [
  {
    key: 'modiin',
    name: 'מודיעין מכבים רעות',
    aliases: ['מודיעין-מכבים-רעות', 'מודיעין מכבים-רעות', 'מודיעין'],
    homelessRegionCode: '13',
    realtaSlug: 'modiin-maccabim-reut',
    onmapSlug: 'modiin-maccabim-reut',
    yad2CityCode: 1200,
    yad2RegionCode: 1, // מרכז והשרון
  },
  // Realta slugs are its own English transliterations and do not always follow
  // one rule (Modi'in is "maccabim", not "makabim"), so each is recorded rather
  // than derived. A city without one simply skips the Realta source.
  // Yad2 codes come from its own address autocomplete
  // (gw.yad2.co.il/address-autocomplete/realestate/v2), which answers each
  // city with cityId and regionId. They are not guessable and not derivable
  // from the name; the three that predated this were re-read from the same
  // endpoint and matched exactly, which is why it is trusted for the rest.
  //
  // BOTH codes are required. `yad2Adapter.supports` needs the pair, so a city
  // carrying one and not the other is skipped by the richest source there is
  // with no error, no empty result and nothing in the log - Petah Tikva sat
  // in a live search that way while Yad2 held 200 rentals for it.
  { key: 'tel-aviv', name: 'תל אביב יפו', aliases: ['תל אביב', 'תל-אביב-יפו', 'תל אביב-יפו'], realtaSlug: 'tel-aviv-yafo', yad2CityCode: 5000, yad2RegionCode: 3 },
  { key: 'jerusalem', name: 'ירושלים', aliases: [], realtaSlug: 'jerusalem', yad2CityCode: 3000, yad2RegionCode: 6 },
  { key: 'haifa', name: 'חיפה', aliases: [], realtaSlug: 'haifa', yad2CityCode: 4000, yad2RegionCode: 5 },
  { key: 'ramat-gan', name: 'רמת גן', aliases: ['רמת-גן'], realtaSlug: 'ramat-gan', yad2CityCode: 8600, yad2RegionCode: 3 },
  { key: 'givatayim', name: 'גבעתיים', aliases: [], realtaSlug: 'givatayim', yad2CityCode: 6300, yad2RegionCode: 3 },
  {
    key: 'petah-tikva',
    name: 'פתח תקווה',
    aliases: ['פתח תקוה', 'פתח-תקווה'],
    realtaSlug: 'petakh-tikva',
    yad2CityCode: 7900,
    yad2RegionCode: 1, // מרכז והשרון, same region as Modi'in and Rishon
  },
  // Every site transliterates this one differently - Realta says "le-tsiyon",
  // OnMap says "letsiyon" - so both are recorded rather than derived.
  {
    key: 'rishon',
    name: 'ראשון לציון',
    aliases: ['ראשון-לציון'],
    realtaSlug: 'rishon-le-tsiyon',
    onmapSlug: 'rishon-letsiyon',
    yad2CityCode: 8300,
    yad2RegionCode: 1, // מרכז והשרון, same region as Modi'in
  },
  { key: 'netanya', name: 'נתניה', aliases: [], realtaSlug: 'netanya', yad2CityCode: 7400, yad2RegionCode: 1 },
  { key: 'beer-sheva', name: 'באר שבע', aliases: ['באר-שבע'], realtaSlug: 'beer-sheva', yad2CityCode: 9000, yad2RegionCode: 2 },
  { key: 'herzliya', name: 'הרצליה', aliases: [], realtaSlug: 'herzliya', yad2CityCode: 6400, yad2RegionCode: 1 },
  { key: 'holon', name: 'חולון', aliases: [], realtaSlug: 'holon', yad2CityCode: 6600, yad2RegionCode: 3 },
  { key: 'bat-yam', name: 'בת ים', aliases: ['בת-ים'], realtaSlug: 'bat-yam', yad2CityCode: 6200, yad2RegionCode: 3 },
  { key: 'rehovot', name: 'רחובות', aliases: [], realtaSlug: 'rekhovot', yad2CityCode: 8400, yad2RegionCode: 1 },
  { key: 'kfar-saba', name: 'כפר סבא', aliases: ['כפר-סבא'], yad2CityCode: 6900, yad2RegionCode: 1 },
  { key: 'raanana', name: 'רעננה', aliases: [], yad2CityCode: 8700, yad2RegionCode: 1 },
  { key: 'shoham', name: 'שוהם', aliases: [], yad2CityCode: 1304, yad2RegionCode: 1 },
];

export function findCityByKey(key: string): CityEntry | undefined {
  return CITIES.find((c) => c.key === key);
}

/**
 * Matches free text typed in the wizard against the city list. Exact
 * normalized matches win outright; otherwise falls back to prefix matches so
 * "רמת" offers "רמת גן".
 */
export function searchCities(query: string, limit = 5): CityEntry[] {
  const q = normalizeCityName(query);
  if (!q) return [];

  const exact = CITIES.filter((c) => cityNameVariants(c).includes(q));
  if (exact.length > 0) return exact.slice(0, limit);

  return CITIES.filter((c) => cityNameVariants(c).some((v) => v.startsWith(q) || v.includes(q))).slice(
    0,
    limit,
  );
}

/**
 * True when a listing's city string refers to this city. Deliberately an
 * exact normalized comparison: a substring test would make "מודיעין עילית"
 * (a different town) match "מודיעין".
 */
export function listingCityMatches(city: CityEntry, listingCity: string): boolean {
  return cityNameVariants(city).includes(normalizeCityName(listingCity));
}

function cityNameVariants(city: CityEntry): string[] {
  return [city.name, ...city.aliases].map(normalizeCityName);
}

/**
 * Everyday region names, per city, and the neighbourhoods they stand for.
 *
 * People say "צפון ראשון"; no board labels a listing that way, so a search
 * filtered on the phrase matched nothing for two weeks. Aliases are expanded
 * at filter time into the names sources actually publish. The groupings are
 * the everyday meaning of each phrase; the neighbourhood names themselves are
 * checked against Yad2's address index.
 */
export const REGION_ALIASES: Record<string, Record<string, string[]>> = {
  rishon: {
    // Each name checked against Yad2's address index on 2026-09-08.
    // "כפר הנביאים" is not a neighbourhood there and was left out. Spellings
    // need listing only once - Yad2's "קרית גנים" and "קריית גנים" are the
    // same key to `normalizePlace`, which collapses כתיב מלא/חסר.
    'צפון ראשון': [
      'נווה הדרים',
      'קרית גנים',
      'נאות שקמה',
      'נווה חוף',
      'מישור הנוף',
      'נחלת יהודה',
    ],
  },
};

/** The neighbourhoods an area name stands for; a plain street or neighbourhood is itself. */
export function expandArea(cityKey: string, area: string): string[] {
  const aliases = REGION_ALIASES[cityKey];
  if (!aliases) return [area];
  const target = normalizePlace(area);
  const match = Object.keys(aliases).find((alias) => normalizePlace(alias) === target);
  return match ? [...aliases[match]!] : [area];
}

/**
 * Whether an area name could ever match a listing: a region alias, or a
 * spelling of a neighbourhood/street that has actually been advertised.
 * Used by the wizard to warn before saving a filter that would silence a
 * search.
 */
export function isKnownAreaName(cityKey: string, area: string, known: string[]): boolean {
  const target = normalizePlace(area);
  if (!target) return false;
  if (expandArea(cityKey, area).length > 1) return true;
  return known.some((name) => {
    const candidate = normalizePlace(name);
    return candidate === target || candidate.includes(target) || target.includes(candidate);
  });
}
