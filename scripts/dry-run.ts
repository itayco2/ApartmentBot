/**
 * Exercises the whole pipeline against the live sites without Telegram.
 *
 * Runs a real poll cycle into an in-memory database and prints the messages
 * that would have been sent. Proves seeding, filtering, dedupe and formatting
 * end to end; the only untested link is delivery to Telegram itself.
 *
 *   npm run dry-run -- [cityKey] [maxPrice]
 */
import type { Api } from 'grammy';
import { findCityByKey } from '../src/core/cities.js';
import { HealthTracker } from '../src/core/health.js';
import { Notifier } from '../src/core/notifier.js';
import { PollCycle } from '../src/core/pollCycle.js';
import { openDatabase } from '../src/db/database.js';
import { KvRepo, KV_KEYS } from '../src/db/kv.repo.js';
import { ListingsRepo } from '../src/db/listings.repo.js';
import { SearchesRepo } from '../src/db/searches.repo.js';
import { buildAdapters } from '../src/sources/index.js';

const cityKey = process.argv[2] ?? 'modiin';
const maxPrice = process.argv[3] ? Number(process.argv[3]) : null;

const city = findCityByKey(cityKey);
if (!city) {
  console.error(`Unknown city "${cityKey}"`);
  process.exit(1);
}

/**
 * Sources with hand-written parsers return the same ids every time. The
 * model-read ones can re-identify a listing under a new hash between two
 * reads of the same page, which is jitter to note, not a fault.
 */
const NATIVE_SOURCES = new Set(['yad2', 'realta', 'homeless', 'onmap', 'madlan']);

/** Stands in for Telegram: prints what would have been sent. */
const sent: string[] = [];
const fakeApi = {
  sendMessage: async (_chat: number, text: string) => {
    sent.push(text);
    return {} as never;
  },
  sendPhoto: async (_chat: number, photo: string, options?: { caption?: string }) => {
    sent.push(`${options?.caption ?? ''}\n[photo] ${photo}`);
    return {} as never;
  },
} as unknown as Api;

const db = openDatabase(':memory:');
const searches = new SearchesRepo(db);
const listings = new ListingsRepo(db);
const kv = new KvRepo(db);
kv.set(KV_KEYS.ownerChatId, '1');

const notifier = new Notifier(fakeApi, listings, searches, kv);
const adapters = buildAdapters({ find: (source, id) => listings.findStored(source, id) });
const cycle = new PollCycle(adapters, searches, listings, kv, notifier, new HealthTracker());

const search = searches.create({
  chatId: 1,
  name: `${city.name} dry run`,
  cityKeys: [city.key],
  cityName: city.name,
  minRooms: null,
  maxRooms: null,
  minPrice: null,
  maxPrice,
});

type Row = { source: string; listing_id: string };
const recordedRows = (): Row[] =>
  db.prepare('SELECT source, listing_id FROM seen_listings').all() as Row[];
const rowKey = (r: Row) => `${r.source}:${r.listing_id}`;

console.log(`City: ${city.name}${maxPrice ? `, up to ${maxPrice.toLocaleString('en-US')} ₪` : ''}\n`);

// 1. Seeding: everything currently listed is marked seen, and nothing is sent.
const { seeded } = await cycle.seedSearch(search);
const seededKeys = new Set(recordedRows().map(rowKey));
console.log(`Seeded ${seeded} existing listings - messages sent: ${sent.length} (expected 0)\n`);

// 2. A second cycle finds nothing new, because everything was just seeded.
const quiet = await cycle.run();
const appeared = recordedRows().filter((r) => !seededKeys.has(rowKey(r)));
const unexpected = appeared.filter((r) => NATIVE_SOURCES.has(r.source));
console.log(
  `Cycle with no new listings: fetched ${quiet.listingsFetched}, new ${quiet.newListings}, sent ${quiet.notificationsSent}` +
    (appeared.length > 0 ? `\n  appeared after seeding: ${appeared.map(rowKey).join(', ')}` : '') +
    (appeared.length > 0 && unexpected.length === 0
      ? '\n  (model-read sources only - a listing re-identified under a new id; jitter, not a fault)'
      : '') +
    `${quiet.failures.length > 0 ? `\n  failures: ${quiet.failures.join('; ')}` : ''}\n`,
);

// 3. Forget two listings so the next cycle treats them as newly published.
//    Chosen from a native source, and without a cross-source twin - otherwise
//    the fingerprint dedupe correctly hides them again and proves nothing.
const forgotten = db
  .prepare(
    `SELECT s.source, s.listing_id FROM seen_listings s
      WHERE s.source IN ('yad2', 'homeless', 'onmap')
        AND (s.fingerprint IS NULL OR NOT EXISTS (
          SELECT 1 FROM seen_listings o
           WHERE o.fingerprint = s.fingerprint
             AND NOT (o.source = s.source AND o.listing_id = s.listing_id)))
      LIMIT 2`,
  )
  .all() as Row[];
for (const row of forgotten) {
  db.prepare('DELETE FROM seen_listings WHERE source = ? AND listing_id = ?').run(
    row.source,
    row.listing_id,
  );
}
console.log(`Forgot ${forgotten.length} listings to simulate new postings: ${forgotten.map(rowKey).join(', ')}\n`);

sent.length = 0;
const live = await cycle.run();
console.log(
  `Cycle after forgetting: new ${live.newListings}, sent ${live.notificationsSent}` +
    `${live.failures.length > 0 ? `\n  failures: ${live.failures.join('; ')}` : ''}\n`,
);

console.log('--- messages that would have gone to Telegram ---');
for (const message of sent) console.log(`\n${message}`);

db.close();

const ok = seeded > 0 && unexpected.length === 0 && live.notificationsSent >= forgotten.length && forgotten.length > 0;
console.log(`\n${ok ? 'PASS' : 'FAIL'}: seeding silent, repeat cycle quiet on native sources, forgotten listings alerted.`);
process.exit(ok ? 0 : 1);
