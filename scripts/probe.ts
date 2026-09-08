/**
 * Fetches every source live for one city and prints what came back.
 *
 * Run with `npm run probe -- [cityKey]` to check whether a site changed its
 * markup or started blocking, without touching the database or Telegram.
 */
import { findCityByKey, CITIES } from '../src/core/cities.js';
import type { SavedSearch } from '../src/core/types.js';
import { buildAdapters } from '../src/sources/index.js';

// No database here: every source reads everything afresh.
const adapters = buildAdapters({ find: () => undefined });

const cityKey = process.argv[2] ?? 'modiin';
const city = findCityByKey(cityKey);

if (!city) {
  console.error(`Unknown city "${cityKey}". Known: ${CITIES.map((c) => c.key).join(', ')}`);
  process.exit(1);
}

const search: SavedSearch = {
  id: 0,
  chatId: 1,
  name: 'probe',
  cityKeys: [city.key],
  cityName: city.name,
  minRooms: null,
  maxRooms: null,
  minPrice: null,
  maxPrice: null,
  active: true,
  createdAt: '',
};

console.log(`Probing sources for ${city.name}\n`);

let failures = 0;

for (const adapter of adapters) {
  const started = Date.now();
  try {
    const listings = await adapter.fetchListings(search, city);
    console.log(`${adapter.name}: ${listings.length} listings in ${Date.now() - started}ms`);

    for (const l of listings.slice(0, 3)) {
      const price = l.price === null ? 'no price' : `${l.price.toLocaleString('en-US')} ₪`;
      const rooms = l.rooms === null ? '?' : l.rooms;
      console.log(
        `   ${price} · ${rooms} rooms · ${l.neighborhood ?? l.city} · ${l.sqm ?? '?'} sqm`,
      );
      console.log(`   ${l.url}`);
    }
    if (listings.length > 3) console.log(`   … and ${listings.length - 3} more`);
    console.log();
  } catch (error) {
    failures++;
    console.error(`${adapter.name}: FAILED - ${error instanceof Error ? error.message : error}\n`);
  }
}

process.exit(failures > 0 ? 1 : 0);
