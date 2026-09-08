import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { htmlToText, parseExtracted } from '../src/llm/extractListings.js';
import {
  createGenericAdapter,
  looksCommercial,
  plausiblePrice,
} from '../src/sources/generic/genericAdapter.js';
import { findCityByKey } from '../src/core/cities.js';
import type { CityEntry, SavedSearch } from '../src/core/types.js';

const search = {} as SavedSearch;
const modiin = findCityByKey('modiin')!;

const site = {
  name: 'testsite',
  displayName: 'אתר בדיקה',
  baseUrl: 'https://example.co.il',
  urlsFor: () => ['https://example.co.il/rent/modiin'],
};

describe('page text reduction', () => {
  it('drops scripts and styles, which are most of a listing page', () => {
    const html = `<html><head><style>.a{color:red}</style></head>
      <body><script>var x=1;</script><div>דירה 3 חדרים 6,000 ₪</div></body></html>`;
    const text = htmlToText(html);

    expect(text).toContain('דירה 3 חדרים 6,000 ₪');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x');
  });

  it('separates adjacent text nodes so numbers do not run together', () => {
    // Without a separator "6,000 ₪" and "3 חד׳" would merge into one number.
    const text = htmlToText('<div><span>6,000 ₪</span><span>3 חד׳</span></div>');
    expect(text).not.toContain('₪3');
  });

  it('keeps listing links, because they carry the id used for dedupe', () => {
    const text = htmlToText('<a href="/listing/123">דירה במודיעין</a>');
    expect(text).toContain('/listing/123');
  });

  it('keeps listing links but drops navigation', () => {
    // Handing over a whole nav bar invited one listing per link: a source once
    // returned 79,000 characters of unparseable output for twelve flats.
    const html = `
      <a href="/properties/single/?id=425551">דירה</a>
      <a href="/rent/viewad,741197.aspx">דירה</a>
      <a href="/code/nadlan/details/?modaaNum=4909089">דירה</a>
      <a href="/about">אודות</a>
      <a href="/contact">צור קשר</a>
      <a href="mailto:x@y.com">מייל</a>
      <a href="#top">למעלה</a>`;
    const text = htmlToText(html);

    expect(text).toContain('id=425551');
    expect(text).toContain('viewad,741197');
    expect(text).toContain('modaaNum=4909089');
    expect(text).not.toContain('/about');
    expect(text).not.toContain('mailto:');
  });

  it('narrows to a content selector when one is given', () => {
    const html = '<body><div class="ads">פרסומת</div><div id="results">דירה להשכרה</div></body>';
    const text = htmlToText(html, '#results');

    expect(text).toContain('דירה להשכרה');
    expect(text).not.toContain('פרסומת');
  });

  it('caps very large pages so one call stays affordable', () => {
    const huge = `<body>${'<p>דירה להשכרה במודיעין</p>'.repeat(4_000)}</body>`;
    expect(htmlToText(huge).length).toBeLessThanOrEqual(60_000);
  });

  it('survives a page with no body content', () => {
    expect(() => htmlToText('<html></html>')).not.toThrow();
  });
});

describe('generic adapter', () => {
  const adapter = createGenericAdapter(site, 48);

  it('stays switched off without a Gemini key', () => {
    // Model-extracted sources are useless without the model, so they opt out
    // rather than failing every cycle.
    expect(adapter.supports(search, modiin)).toBe(false);
  });

  it('opts out for a city the site does not cover', () => {
    const scoped = createGenericAdapter({ ...site, cityKeys: ['tel-aviv'] }, 48);
    expect(scoped.supports(search, modiin)).toBe(false);
  });

  it('does not even fetch when there is no model to read the page with', async () => {
    // Returns immediately: no network request is made, so this cannot hang.
    await expect(adapter.fetchListings(search, modiin)).resolves.toEqual([]);
  });
});

describe('commercial-listing guard', () => {
  it('rejects genuine business premises', () => {
    expect(looksCommercial({ propertyType: 'מחסן', description: null })).toBe(true);
    expect(looksCommercial({ propertyType: null, description: 'קליניקה להשכרה' })).toBe(true);
    expect(
      looksCommercial({ propertyType: null, description: 'For Rent - Commercial real estate' }),
    ).toBe(true);
  });

  it('does not reject a flat because the copy mentions a transaction', () => {
    // "עסקה" contains "עסק"; a bare stem here silently discarded a whole source.
    expect(looksCommercial({ propertyType: 'דירה', description: 'עסקה מצוינת, כניסה מיידית' })).toBe(
      false,
    );
    expect(looksCommercial({ propertyType: 'דירה', description: 'דירה עם מחסן וחניה' })).toBe(false);
  });

  it('leaves ordinary residential listings alone', () => {
    expect(looksCommercial({ propertyType: 'דירת גן', description: 'דירה משופצת' })).toBe(false);
    expect(looksCommercial({ propertyType: null, description: null })).toBe(false);
  });
});

describe('price plausibility guard', () => {
  it('rejects the misread price seen live on a real page', () => {
    // JAnglo extraction produced "750 ₪" for a 4.5 room flat.
    expect(plausiblePrice(750, 4.5)).toBeNull();
  });

  it('keeps ordinary rents', () => {
    expect(plausiblePrice(6_000, 3)).toBe(6_000);
    expect(plausiblePrice(15_500, 4.5)).toBe(15_500);
  });

  it('keeps a cheap single room, which is genuinely possible', () => {
    expect(plausiblePrice(1_200, 1)).toBe(1_200);
  });

  it('rejects values that cannot be a monthly rent at all', () => {
    expect(plausiblePrice(12, 3)).toBeNull();
    expect(plausiblePrice(950_000, 3)).toBeNull();
  });

  it('passes through an absent price unchanged', () => {
    expect(plausiblePrice(null, 3)).toBeNull();
  });
});

describe('city entry', () => {
  it('knows the Realta slug for Modi’in, without which the aggregator is skipped', () => {
    const city: CityEntry = modiin;
    expect(city.realtaSlug).toBe('modiin-maccabim-reut');
  });
});

describe('extraction validation', () => {
  it('keeps the rest of a page when one listing has an impossible number', () => {
    // A single `rooms: 0` from the model once discarded every listing on the
    // komo page. Impossible numbers become "unknown"; the listing survives.
    const parsed = parseExtracted({
      listings: [
        { externalId: 'a', price: 6000, rooms: 3, amenities: [] },
        { externalId: 'b', price: 7000, rooms: 0, amenities: [] },
        { externalId: 'c', price: 0, rooms: 4, amenities: [] },
      ],
    });
    expect(parsed.map((l) => l.externalId)).toEqual(['a', 'b', 'c']);
    expect(parsed[1]?.rooms).toBeNull();
    expect(parsed[2]?.price).toBeNull();
  });

  it('drops an unreadable entry without losing the page', () => {
    const parsed = parseExtracted({
      listings: [{ externalId: 'a', amenities: [] }, 'garbage', null, { externalId: 42 }],
    });
    expect(parsed.map((l) => l.externalId)).toEqual(['a']);
  });

  it('treats a missing key the same as null', () => {
    const [only] = parseExtracted({ listings: [{ externalId: 'a' }] });
    expect(only?.price).toBeNull();
    expect(only?.amenities).toEqual([]);
  });

  it('returns nothing for a response with no listings', () => {
    expect(parseExtracted({})).toEqual([]);
    expect(parseExtracted(null)).toEqual([]);
    expect(parseExtracted({ listings: 'nope' })).toEqual([]);
  });
});
