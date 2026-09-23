/**
 * Regenerates src/core/cities.generated.ts: every Israeli locality Yad2 lists, with the
 * city and region codes its API needs. A maintainer runs it rarely; self-hosters never do,
 * because the result is committed.
 *
 *   npm run build-cities
 *
 * One Yad2 autocomplete request per locality (~1,300), about a second apart: slower than
 * the site's own search box asks while someone types. Every answer is cached under
 * data/cache/yad2-autocomplete/, so an interrupted run resumes where it stopped. Only
 * `text` is ever sent: any other parameter trips Yad2's firewall, whose block record
 * carries the caller's IP, and a block stops the run at once.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURATED_CITIES } from '../src/core/cities.js';
import {
  buildGeneratedEntries,
  parseGovLocalities,
  pickYad2City,
  renderGeneratedModule,
  type GovLocality,
  type Yad2CityMatch,
} from '../src/core/cityBuild.js';
import { BlockedError } from '../src/core/types.js';
import { fetchText } from '../src/util/http.js';

const GOV_URL =
  'https://data.gov.il/api/3/action/datastore_search?resource_id=5c78e9fa-c2e2-4771-93ff-7f400a12f7ba&limit=5000';
const AUTOCOMPLETE = 'https://gw.yad2.co.il/address-autocomplete/realestate/v2';
const CACHE_DIR = join('data', 'cache', 'yad2-autocomplete');
const OUTPUT = join('src', 'core', 'cities.generated.ts');

async function loadLocalities(): Promise<GovLocality[]> {
  const body = await fetchText(GOV_URL, {
    source: 'build-cities',
    headers: { Accept: 'application/json' },
  });
  const records = (JSON.parse(body) as { result?: { records?: unknown[] } }).result?.records ?? [];
  return parseGovLocalities(records);
}

async function autocomplete(locality: GovLocality): Promise<unknown> {
  const cached = join(CACHE_DIR, `${locality.code}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'));

  const body = await fetchText(`${AUTOCOMPLETE}?text=${encodeURIComponent(locality.name)}`, {
    source: 'build-cities',
    profile: 'desktop',
    delayRange: [900, 1_400],
    headers: {
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.yad2.co.il',
      Referer: 'https://www.yad2.co.il/',
    },
  });
  const parsed: unknown = JSON.parse(body);
  writeFileSync(cached, JSON.stringify(parsed));
  return parsed;
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const localities = await loadLocalities();
  console.log(`${localities.length} localities from data.gov.il`);

  const matches: Array<{ locality: GovLocality; match: Yad2CityMatch }> = [];
  const notCities: string[] = [];
  const failed: string[] = [];

  for (const [index, locality] of localities.entries()) {
    try {
      const match = pickYad2City(locality, await autocomplete(locality));
      if (match) matches.push({ locality, match });
      else notCities.push(locality.name);
    } catch (error) {
      if (error instanceof BlockedError) {
        console.error(
          `Yad2 blocked the run at ${locality.name}. Stopping; wait an hour before rerunning. Cached answers are kept.`,
        );
        process.exit(1);
      }
      failed.push(`${locality.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if ((index + 1) % 50 === 0) console.log(`${index + 1}/${localities.length}`);
  }

  const entries = buildGeneratedEntries(matches);
  const codes = new Set(entries.map((e) => e.yad2CityCode));
  const missing = CURATED_CITIES.filter((c) => c.yad2CityCode !== undefined && !codes.has(c.yad2CityCode));
  if (missing.length > 0) {
    // A half-finished run must never replace a good registry.
    console.error(`Refusing to write: curated cities did not resolve: ${missing.map((c) => c.key).join(', ')}`);
    process.exit(1);
  }

  writeFileSync(OUTPUT, renderGeneratedModule(entries, new Date().toISOString().slice(0, 10)));
  console.log(`wrote ${entries.length} cities to ${OUTPUT}`);
  console.log(`not a Yad2 city (${notCities.length}): ${notCities.join(', ')}`);
  if (failed.length > 0) console.log(`failed (${failed.length}):\n${failed.join('\n')}`);
}

await main();
