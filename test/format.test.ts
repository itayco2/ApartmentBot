import { describe, expect, it } from 'vitest';
import { describeSearchScope, escapeHtml, formatListing, listingKeyboard, newestFirst, pickPhoto, priceDropHeader, searchTitle } from '../src/bot/format.js';
import type { Listing, SavedSearch } from '../src/core/types.js';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    source: 'yad2',
    sourceId: 'a1',
    url: 'https://www.yad2.co.il/realestate/item/a1',
    price: 6_200,
    rooms: 4,
    city: 'מודיעין מכבים רעות',
    amenities: [],
    imageUrls: [],
    ...overrides,
  };
}

/** The 📍 line, without its marker. */
function placeLine(text: string): string | undefined {
  return text
    .split('\n')
    .find((line) => line.startsWith('📍'))
    ?.replace('📍 ', '');
}

describe('listing message: where it is', () => {
  it('names the city even when a street and neighbourhood are known', () => {
    // One search can span several cities, so the city is never implied.
    const text = formatListing(listing({ address: 'הרצל 5', neighborhood: 'בוכמן' }));
    expect(placeLine(text)).toBe('הרצל 5, בוכמן · מודיעין מכבים רעות');
  });

  it('tells two cities apart in the same batch', () => {
    const modiin = formatListing(listing({ neighborhood: 'בוכמן' }));
    const rishon = formatListing(
      listing({ city: 'ראשון לציון', neighborhood: 'רביבים', sourceId: 'b2' }),
    );

    expect(placeLine(modiin)).toContain('מודיעין מכבים רעות');
    expect(placeLine(rishon)).toContain('ראשון לציון');
  });

  it('falls back to the city alone when nothing more specific is known', () => {
    expect(placeLine(formatListing(listing()))).toBe('מודיעין מכבים רעות');
  });

  it('does not repeat the city when a source uses it as the neighbourhood', () => {
    const text = formatListing(listing({ neighborhood: 'מודיעין מכבים רעות' }));
    expect(placeLine(text)).toBe('מודיעין מכבים רעות');
  });

  it('does not repeat an address that equals the neighbourhood', () => {
    const text = formatListing(listing({ address: 'בוכמן', neighborhood: 'בוכמן' }));
    expect(placeLine(text)).toBe('בוכמן · מודיעין מכבים רעות');
  });

  it('escapes html in place names rather than breaking the message', () => {
    const text = formatListing(listing({ address: '<b>x</b> 5', city: 'A & B' }));
    expect(placeLine(text)).toBe('&lt;b&gt;x&lt;/b&gt; 5 · A &amp; B');
  });
});

describe('listing message: the rest', () => {
  it('leads with the price, because it decides whether to read on', () => {
    expect(formatListing(listing()).split('\n')[0]).toBe('💰 <b>6,200 ₪</b> לחודש');
  });

  it('says so plainly when a source published no price', () => {
    expect(formatListing(listing({ price: null })).split('\n')[0]).toBe('💰 מחיר לא צוין');
  });

  it('renders the floor with the building height when both are known', () => {
    const text = formatListing(listing({ floor: 'קומה 2', floorsTotal: 6 }));
    expect(text).toContain('קומה 2 מתוך 6');
  });

  it('marks broker and by-owner listings differently', () => {
    expect(formatListing(listing({ isBroker: true }))).toContain('תיווך');
    expect(formatListing(listing({ isBroker: false }))).toContain('ללא תיווך');
  });

  it('credits the underlying board rather than the aggregator', () => {
    const text = formatListing(listing({ source: 'realta', originalSource: 'קבוצת פייסבוק' }));
    expect(text).toContain('קבוצת פייסבוק');
    expect(text).not.toContain('Realta');
  });

  it('stays inside the telegram caption limit even with a long description', () => {
    const text = formatListing(listing({ description: 'א'.repeat(5_000) }));
    expect(text.length).toBeLessThanOrEqual(1_024);
  });
});

describe('helpers', () => {
  it('escapes only the characters telegram html mode cares about', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('offers a photo only when it is an https url telegram can fetch', () => {
    expect(pickPhoto(listing({ imageUrls: ['https://img/x.jpg'] }))).toBe('https://img/x.jpg');
    expect(pickPhoto(listing({ imageUrls: ['http://img/x.jpg'] }))).toBeUndefined();
    expect(pickPhoto(listing())).toBeUndefined();
  });
});

describe('newest first', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 8, n));

  it('orders dated listings newest first and puts undated ones last', () => {
    const ordered = newestFirst([
      listing({ sourceId: 'old', postedAt: day(1) }),
      listing({ sourceId: 'undated' }),
      listing({ sourceId: 'new', postedAt: day(7) }),
      listing({ sourceId: 'mid', postedAt: day(4) }),
    ]);
    expect(ordered.map((l) => l.sourceId)).toEqual(['new', 'mid', 'old', 'undated']);
  });

  it('keeps the original order among undated listings and does not mutate its input', () => {
    const input = [listing({ sourceId: 'a' }), listing({ sourceId: 'b' })];
    const ordered = newestFirst(input);
    expect(ordered.map((l) => l.sourceId)).toEqual(['a', 'b']);
    expect(ordered).not.toBe(input);
  });
});

describe('price drop header', () => {
  const band: SavedSearch = {
    id: 1, chatId: 1, name: 's', cityKeys: ['modiin'], cityName: 'מודיעין מכבים רעות',
    minRooms: null, maxRooms: null, minPrice: null, maxPrice: 6_000, active: true, createdAt: '',
  };

  it('says a drop is still a near miss when the new price is still outside the band', () => {
    // 6,500 → 6,200 against a 6,000 cap: cheaper, but still over. A plain
    // "price drop" here reads as if the flat now fits.
    const header = priceDropHeader(listing({ price: 6_200 }), 6_500, band);
    expect(header).toContain('ירידת מחיר');
    expect(header).toContain('כמעט מתאים');
    expect(header).toContain('מעל המקסימום');
  });

  it('celebrates a drop that brings a near miss into the band', () => {
    const header = priceDropHeader(listing({ price: 5_900 }), 6_500, band);
    expect(header).toContain('עכשיו בטווח');
    expect(header).not.toContain('כמעט מתאים');
  });

  it('is a plain drop when the listing was in the band all along', () => {
    const header = priceDropHeader(listing({ price: 5_500 }), 5_900, band);
    expect(header).toContain('ירידת מחיר');
    expect(header).toContain('5,900');
    expect(header).not.toContain('עכשיו בטווח');
    expect(header).not.toContain('כמעט');
  });

  it('works without a search to compare against', () => {
    expect(priceDropHeader(listing({ price: 5_500 }), 5_900)).toContain('−400');
  });
});

describe('listing keyboard', () => {
  it('always opens the ad, and adds a map when there is a street', () => {
    const buttons = listingKeyboard(listing({ address: 'עמק איילון 4', city: 'מודיעין מכבים רעות' })).inline_keyboard.flat();
    expect(buttons[0]).toMatchObject({ text: 'פתח מודעה ↗', url: 'https://www.yad2.co.il/realestate/item/a1' });
    const map = buttons.find((b) => b.text.includes('מפה'));
    expect(map).toBeDefined();
    expect((map as { url: string }).url).toContain('https://maps.google.com/?q=');
    expect(decodeURIComponent((map as { url: string }).url)).toContain('עמק איילון 4');
    expect(decodeURIComponent((map as { url: string }).url)).toContain('מודיעין');
  });

  it('offers WhatsApp when the post carried a phone number', () => {
    const buttons = listingKeyboard(listing({ phone: '054-1234567' })).inline_keyboard.flat();
    const wa = buttons.find((b) => b.text.includes('WhatsApp')) as { url: string } | undefined;
    expect(wa?.url).toMatch(/^https:\/\/wa\.me\/972541234567\?text=/);
  });

  it('shows neither extra when the listing has no address and no phone', () => {
    expect(listingKeyboard(listing()).inline_keyboard.flat()).toHaveLength(1);
  });
});

describe('entry date in the message', () => {
  it('shows the move-in date as written', () => {
    expect(formatListing(listing({ entryText: 'מיידי' }))).toContain('📅 כניסה: מיידי');
    expect(formatListing(listing({ entryDate: new Date(2026, 9, 1) }))).toContain('📅 כניסה: 1.10.2026');
  });

  it('shows the phone on its own line', () => {
    expect(formatListing(listing({ phone: '054-1234567' }))).toContain('📞 054-1234567');
  });
});

describe('search title', () => {
  it('escapes user-typed keywords, since every screen that shows it is HTML', () => {
    const search: SavedSearch = {
      id: 1, chatId: 1, name: 's', cityKeys: ['modiin'], cityName: 'מודיעין מכבים רעות',
      minRooms: null, maxRooms: null, minPrice: null, maxPrice: 6_000,
      requirements: { keywords: ['<b>נוף</b>'] }, active: true, createdAt: '',
    };
    const title = searchTitle(search);
    expect(title).toContain('&lt;b&gt;נוף&lt;/b&gt;');
    expect(title).not.toContain('<b>');
    expect(title).toContain('עד 6,000 ₪');
  });
});

describe('describeSearchScope', () => {
  function saved(overrides: Partial<SavedSearch> = {}): SavedSearch {
    return {
      id: 1,
      chatId: 1,
      name: 's',
      cityKeys: ['modiin', 'rishon'],
      cityName: 'מודיעין מכבים רעות, ראשון לציון',
      minRooms: null,
      maxRooms: null,
      minPrice: null,
      maxPrice: null,
      active: true,
      createdAt: '',
      ...overrides,
    };
  }

  /**
   * The whole point: a search covering a city end to end must not look the
   * same in /list as one narrowed to three streets. Reading "כל העיר" is how
   * the owner spots the leftover search that is drowning out a filtered one.
   */
  it('says so out loud when a city is searched whole', () => {
    expect(describeSearchScope(saved())).toBe(
      'מודיעין מכבים רעות: כל העיר · ראשון לציון: כל העיר',
    );
  });

  it('names the chosen streets, per city', () => {
    const scope = describeSearchScope(saved({ areas: { rishon: ['נעורים', 'צפון ראשון'] } }));
    expect(scope).toBe('מודיעין מכבים רעות: כל העיר · ראשון לציון: נעורים, צפון ראשון');
  });

  it('skips a city key no longer known', () => {
    expect(describeSearchScope(saved({ cityKeys: ['modiin', 'atlantis'] }))).toBe(
      'מודיעין מכבים רעות: כל העיר',
    );
  });
});
