import { z } from 'zod';
import { normalizeCityName } from './cities.js';
import type { CityEntry } from './types.js';

/**
 * Pure pieces of `npm run build-cities`, kept apart from the script so they can be tested
 * without the network calls the script makes.
 */

/** One row of the official (CBS) locality list published on data.gov.il. */
export interface GovLocality {
  code: number;
  name: string;
  englishName: string;
}

/** What Yad2's address autocomplete says about a city. */
export interface Yad2CityMatch {
  cityId: number;
  regionId: number;
  /** Yad2's own spelling, which is what its listings carry in `address.city`. */
  title: string;
}

const govRecordSchema = z.object({
  סמל_ישוב: z.union([z.string(), z.number()]),
  שם_ישוב: z.string(),
  שם_ישוב_לועזי: z.string().nullish(),
});

/** Reads data.gov.il records, dropping rows with no usable code or name. */
export function parseGovLocalities(records: unknown[]): GovLocality[] {
  const localities: GovLocality[] = [];
  for (const raw of records) {
    const parsed = govRecordSchema.safeParse(raw);
    if (!parsed.success) continue;
    const code = Number(String(parsed.data.סמל_ישוב).trim());
    const name = parsed.data.שם_ישוב.trim().replace(/\s+/g, ' ');
    if (!Number.isInteger(code) || code <= 0 || !name) continue;
    localities.push({ code, name, englishName: (parsed.data.שם_ישוב_לועזי ?? '').trim() });
  }
  return localities;
}

const autocompleteSchema = z.object({
  cities: z
    .array(
      z
        .object({
          fullTitleText: z.string(),
          cityId: z.union([z.string(), z.number()]),
          regionId: z.union([z.string(), z.number()]),
        })
        .passthrough(),
    )
    .default([]),
});

/**
 * Picks the autocomplete answer that is this locality. The official code is the strong
 * match: Yad2's `cityId` equals it for every city checked. The name is the fallback, for a
 * place Yad2 files under a different code.
 */
export function pickYad2City(locality: GovLocality, response: unknown): Yad2CityMatch | undefined {
  const parsed = autocompleteSchema.safeParse(response);
  if (!parsed.success) return undefined;

  const cities = parsed.data.cities
    .map((c) => ({ cityId: Number(c.cityId), regionId: Number(c.regionId), title: c.fullTitleText.trim() }))
    .filter((c) => Number.isInteger(c.cityId) && c.cityId > 0 && Number.isInteger(c.regionId) && c.regionId > 0);

  return (
    cities.find((c) => c.cityId === locality.code) ??
    cities.find((c) => normalizeCityName(c.title) === normalizeCityName(locality.name))
  );
}

/** `KEFAR YONA` → `kefar-yona`; no usable English name → `city-<code>`. */
export function cityKeyFor(locality: GovLocality): string {
  const slug = locality.englishName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `city-${locality.code}`;
}

/**
 * Registry entries, sorted by Yad2 code. The name is Yad2's spelling, because that is what
 * its listings say and `listingCityMatches` compares against. The official spelling is kept
 * as an alias when it differs.
 *
 * Saved searches store the key, so a city keeps the key it was published with
 * (`existingKeys`, by Yad2 code) even if its official English name changes, and no new
 * place may take a key another city already has. Otherwise a regeneration could leave a
 * search pointing at nothing, or quietly at a different town.
 *
 * A key two new places would share gets the later one's code appended. A second row
 * resolving to a Yad2 city already taken, or a second city with a name already taken, is
 * dropped: one spelling must lead to one city.
 */
export function buildGeneratedEntries(
  matches: Array<{ locality: GovLocality; match: Yad2CityMatch }>,
  existingKeys: ReadonlyMap<number, string> = new Map(),
): CityEntry[] {
  const sorted = [...matches].sort((a, b) => a.match.cityId - b.match.cityId);
  const reserved = new Set(existingKeys.values());
  const usedKeys = new Set<string>();
  const usedCodes = new Set<number>();
  const usedNames = new Set<string>();
  const entries: CityEntry[] = [];

  for (const { locality, match } of sorted) {
    const name = normalizeCityName(match.title);
    if (usedCodes.has(match.cityId) || usedNames.has(name)) continue;
    usedCodes.add(match.cityId);
    usedNames.add(name);

    let key = existingKeys.get(match.cityId);
    if (key === undefined) {
      key = cityKeyFor(locality);
      if (usedKeys.has(key) || reserved.has(key)) key = `${key}-${locality.code}`;
    }
    usedKeys.add(key);

    const aliases = normalizeCityName(locality.name) === name ? [] : [locality.name];
    entries.push({
      key,
      name: match.title,
      aliases,
      yad2CityCode: match.cityId,
      yad2RegionCode: match.regionId,
    });
  }

  return entries;
}

/** The source of `cities.generated.ts`: one entry per line, so a regeneration diffs cleanly. */
export function renderGeneratedModule(entries: CityEntry[], generatedOn: string): string {
  const lines = entries.map(
    (e) =>
      `  { key: ${JSON.stringify(e.key)}, name: ${JSON.stringify(e.name)}, ` +
      `aliases: ${JSON.stringify(e.aliases)}, yad2CityCode: ${e.yad2CityCode}, ` +
      `yad2RegionCode: ${e.yad2RegionCode} },`,
  );
  return [
    `// Generated by \`npm run build-cities\` on ${generatedOn} from data.gov.il's locality list`,
    "// and Yad2's address autocomplete. Do not edit by hand: a regeneration overwrites this",
    '// file. Hand-kept details live in CURATED_CITIES in cities.ts.',
    "import type { CityEntry } from './types.js';",
    '',
    'export const GENERATED_CITIES: CityEntry[] = [',
    ...lines,
    '];',
    '',
  ].join('\n');
}
