import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findCityByKey } from '../src/core/cities.js';
import type { SavedSearch } from '../src/core/types.js';
import type { ParsedPost } from '../src/llm/extractPosts.js';
import { channelsForCity } from '../src/sources/telegram/channels.js';
import { createTelegramAdapter, toListing } from '../src/sources/telegram/telegramAdapter.js';
import { parseChannelPage } from '../src/sources/telegram/telegramParse.js';

const fixture = readFileSync(join(import.meta.dirname, 'fixtures', 'telegram-channel.html'), 'utf8');
const rishon = findCityByKey('rishon')!;

describe('telegram channel parser', () => {
  const page = parseChannelPage(fixture, 'nester_rent_rishonlezion');

  it('reads the channel title', () => {
    expect(page.title).toBe('ראשון לציון דירות להשכרה ללא תיווך');
  });

  it('extracts every post with its id, permalink and time', () => {
    expect(page.posts).toHaveLength(4);
    const first = page.posts[0]!;
    expect(first.id).toBe('nester_rent_rishonlezion/30089');
    expect(first.url).toBe('https://t.me/nester_rent_rishonlezion/30089');
    expect(first.postedAt?.toISOString()).toBe('2026-09-08T04:28:44.000Z');
  });

  it('keeps the post text as readable prose', () => {
    const text = page.posts[0]!.text;
    expect(text).toContain('נאות שקמה');
    expect(text).toContain('3,500');
    expect(text).not.toContain('<');
  });

  it('takes the first photo as an https url', () => {
    expect(page.posts[0]!.photo).toMatch(/^https:\/\/cdn\d*\.telesco\.pe\//);
  });

  it('returns nothing for a page with no posts rather than throwing', () => {
    expect(parseChannelPage('<html><body>nope</body></html>', 'x').posts).toEqual([]);
  });
});

describe('telegram channel configuration', () => {
  it('knows the Rishon channel and none for Modi’in', () => {
    expect(channelsForCity(rishon).map((c) => c.name)).toContain('nester_rent_rishonlezion');
    expect(channelsForCity(findCityByKey('modiin')!)).toEqual([]);
  });
});

describe('telegram adapter', () => {
  const adapter = createTelegramAdapter({ find: () => undefined });

  it('stays off without a Gemini key', () => {
    // The test environment has no key; free-text posts cannot be read without one.
    expect(adapter.supports({} as SavedSearch, rishon)).toBe(false);
  });

  it('reads channels on its own schedule rather than every cycle', () => {
    expect(adapter.cadenceMinutes).toBeGreaterThanOrEqual(15);
  });

  const post = {
    id: 'nester_rent_rishonlezion/30089',
    url: 'https://t.me/nester_rent_rishonlezion/30089',
    text: 'דירת 3 חדרים בנווה חוף 5,500 ש"ח לפרטים 054-1234567',
    postedAt: new Date('2026-09-08T04:28:44Z'),
    photo: 'https://cdn4.telesco.pe/file/abc.jpg',
  };
  const parsed = (overrides: Partial<ParsedPost> = {}): ParsedPost => ({
    index: 0,
    isRentalListing: true,
    isWantedPost: false,
    price: 5_500,
    rooms: 3,
    sqm: null,
    city: null,
    neighborhood: 'נווה חוף',
    street: null,
    floor: null,
    propertyType: null,
    amenities: [],
    isBroker: false,
    entryDateText: null,
    summary: 'דירת 3 חדרים בנווה חוף',
    ...overrides,
  });

  it('turns a parsed rental post into a listing that names the channel', () => {
    const listing = toListing(post, parsed(), 'ראשון לציון דירות להשכרה ללא תיווך', rishon);
    expect(listing).toMatchObject({
      source: 'telegram',
      sourceId: 'nester_rent_rishonlezion/30089',
      url: 'https://t.me/nester_rent_rishonlezion/30089',
      price: 5_500,
      rooms: 3,
      city: 'ראשון לציון',
      neighborhood: 'נווה חוף',
      imageUrls: ['https://cdn4.telesco.pe/file/abc.jpg'],
      originalSource: 'טלגרם · ראשון לציון דירות להשכרה ללא תיווך',
    });
    expect(listing?.postedAt?.toISOString()).toBe('2026-09-08T04:28:44.000Z');
    // The phone never left the machine; it comes back as the WhatsApp number.
    expect(listing?.phone).toBe('054-1234567');
    expect(listing?.description).toBe('דירת 3 חדרים בנווה חוף');
  });

  it('carries the move-in date both as written and as a date', () => {
    const listing = toListing(post, parsed({ entryDateText: 'מיידי' }), 't', rishon);
    expect(listing?.entryText).toBe('מיידי');
    expect(listing?.entryDate).toBeInstanceOf(Date);
  });

  it('drops wanted posts and posts about another city', () => {
    expect(toListing(post, parsed({ isWantedPost: true }), 't', rishon)).toBeNull();
    expect(toListing(post, parsed({ isRentalListing: false }), 't', rishon)).toBeNull();
    expect(toListing(post, parsed({ city: 'חולון' }), 't', rishon)).toBeNull();
  });
});
