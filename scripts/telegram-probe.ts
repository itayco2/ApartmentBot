/**
 * Checks whether public Telegram channels are worth reading as a source.
 *
 * For each name, fetches https://t.me/s/<name> - the server-rendered preview
 * that needs no login - and prints how many recent posts there are, how many
 * look like rental ads, and how many mention our cities.
 *
 *   npm run telegram-probe -- <channel> [<channel>…]
 */
import * as cheerio from 'cheerio';
import { fetchText } from '../src/util/http.js';

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('Usage: npm run telegram-probe -- <channel> [<channel>…]');
  process.exit(1);
}

const RENTAL = /להשכרה|חדרים|חד['׳]|₪|ש"ח|\bשח\b/;

for (const name of names) {
  const url = `https://t.me/s/${name}`;
  try {
    const html = await fetchText(url, {
      source: 'telegram-probe',
      profile: 'desktop',
      retries: 0,
      delayRange: [800, 1_500],
    });
    const $ = cheerio.load(html);
    const title = $('.tgme_channel_info_header_title, .tgme_page_title').first().text().trim();
    const messages = $('.tgme_widget_message');
    const texts = messages.map((_, m) => $(m).find('.tgme_widget_message_text').text()).get();
    const rental = texts.filter((t) => RENTAL.test(t)).length;
    const modiin = texts.filter((t) => /מודיעין/.test(t)).length;
    const rishon = texts.filter((t) => /ראשון/.test(t)).length;
    const latest = messages.last().find('time').attr('datetime') ?? '-';
    const members = $('.tgme_channel_info_counter').first().text().replace(/\s+/g, ' ').trim();

    if (messages.length === 0 && !title) {
      console.log(`${name.padEnd(30)} → no public channel page`);
      continue;
    }
    console.log(
      `${name.padEnd(30)} → "${title}" ${members} | posts ${messages.length}, ` +
        `rental-like ${rental}, modiin ${modiin}, rishon ${rishon}, latest ${latest.slice(0, 10)}`,
    );
  } catch (error) {
    console.log(`${name.padEnd(30)} → error: ${(error as Error).message.slice(0, 80)}`);
  }
}
