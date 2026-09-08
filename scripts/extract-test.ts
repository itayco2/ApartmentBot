/**
 * Proves the model-extraction path end to end against a live page.
 *
 *   npm run extract-test -- <url> [cityKey]
 *
 * Fetches the page, reduces it to text, asks Gemini for listings, and prints
 * what came back - no database, no Telegram.
 */
import { findCityByKey } from '../src/core/cities.js';
import { extractListingsFromHtml, htmlToText } from '../src/llm/extractListings.js';
import { fetchText } from '../src/util/http.js';

const url = process.argv[2] ?? 'https://www.janglo.net/real-estate-rentals/modiin';
const city = findCityByKey(process.argv[3] ?? 'modiin')!;

console.log(`Fetching ${url}\n`);
const html = await fetchText(url, { source: 'extract-test', profile: 'desktop' });
const text = htmlToText(html);
console.log(`page: ${html.length} bytes html -> ${text.length} chars text\n`);

const started = Date.now();
const listings = await extractListingsFromHtml(html, city.name, 'extract-test');
console.log(`extracted ${listings.length} listings in ${Date.now() - started}ms\n`);

for (const l of listings.slice(0, 10)) {
  const price = l.price === null ? 'no price' : `${l.price.toLocaleString('en-US')} ₪`;
  console.log(
    `  ${price} · ${l.rooms ?? '?'} rooms · ${l.sqm ?? '?'} sqm · ` +
      `${l.neighborhood ?? l.city ?? '?'}${l.street ? `, ${l.street}` : ''}` +
      `${l.isBroker === true ? ' · תיווך' : ''}`,
  );
  if (l.url) console.log(`     ${l.url}`);
}
if (listings.length > 10) console.log(`  … and ${listings.length - 10} more`);

process.exit(0);
