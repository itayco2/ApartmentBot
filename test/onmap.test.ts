import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listingSchema } from '../src/core/types.js';
import { parseOnmapListings } from '../src/sources/onmap/onmapNormalize.js';

const payload = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'onmap-rishon.json'), 'utf8'),
);

const listings = parseOnmapListings(payload, 'ראשון לציון');

describe('onmap normalizer', () => {
  it('reads the rows the API returned', () => {
    // The whole point of this fixture: the previous schema parsed zero of them.
    expect(listings.length).toBe(payload.data.length);
  });

  it('produces listings that satisfy the shared Listing schema', () => {
    for (const listing of listings) {
      expect(() => listingSchema.parse(listing)).not.toThrow();
    }
  });

  it('reads square metres out of the nested area object', () => {
    // "area": { "base": 78, "garden": null, "field": null }
    const withSqm = listings.filter((l) => l.sqm !== undefined);
    expect(withSqm.length).toBeGreaterThan(0);
    for (const l of withSqm) expect(l.sqm).toBeGreaterThan(0);
  });

  it('reads both parts of the nested floor object', () => {
    // "floor": { "on_the": 1, "out_of": 4 } -> "קומה 1" plus a building height
    const withFloor = listings.filter((l) => l.floor !== undefined);
    expect(withFloor.length).toBeGreaterThan(0);
    expect(listings.some((l) => l.floorsTotal !== undefined)).toBe(true);

    for (const l of listings) {
      if (l.floorsTotal !== undefined) expect(l.floorsTotal).toBeGreaterThan(0);
    }
  });

  it('still accepts a plain number if the API ever flattens those fields', () => {
    const flattened = {
      data: [
        {
          id: 'flat-1',
          slug: 'x',
          price: 6_000,
          address: { he: { city_name: 'ראשון לציון' } },
          additional_info: { rooms: 3, area: 80, floor: 2 },
        },
      ],
    };

    const [listing] = parseOnmapListings(flattened, 'ראשון לציון');
    expect(listing?.sqm).toBe(80);
    expect(listing?.floor).toBe('קומה 2');
    expect(listing?.floorsTotal).toBeUndefined();
  });

  it('renders ground floor in words rather than "קומה 0"', () => {
    const [listing] = parseOnmapListings(
      { data: [{ id: 'g', price: 5_000, additional_info: { rooms: 3, floor: { on_the: 0, out_of: 4 } } }] },
      'ראשון לציון',
    );
    expect(listing?.floor).toBe('קומת קרקע');
  });

  it('drops per-night prices that the rent-short option mixes in', () => {
    // 480 ₪ for a 3-room flat is a nightly rate, not a monthly rent.
    const [listing] = parseOnmapListings(
      { data: [{ id: 'n', price: 480, additional_info: { rooms: 3 } }] },
      'ראשון לציון',
    );
    expect(listing?.price).toBeNull();
  });

  it('keeps a real monthly rent', () => {
    const [listing] = parseOnmapListings(
      { data: [{ id: 'm', price: 6_500, additional_info: { rooms: 4 } }] },
      'ראשון לציון',
    );
    expect(listing?.price).toBe(6_500);
  });

  it('builds an item url from the slug and falls back to the site root', () => {
    for (const l of listings) {
      expect(l.url).toMatch(/^https:\/\/www\.onmap\.co\.il\//);
    }

    const [noSlug] = parseOnmapListings({ data: [{ id: 'q', price: 6_000 }] }, 'ראשון לציון');
    expect(noSlug?.url).toBe('https://www.onmap.co.il/');
  });

  it('labels the source so a listing can say where it came from', () => {
    for (const l of listings) expect(l.originalSource).toBe('OnMap');
  });

  it('returns nothing for an unexpected payload rather than throwing', () => {
    expect(parseOnmapListings({ nope: true }, 'x')).toEqual([]);
    expect(parseOnmapListings(null, 'x')).toEqual([]);
    expect(parseOnmapListings({ data: 'not an array' }, 'x')).toEqual([]);
  });

  it('skips rows with no usable id instead of inventing one', () => {
    expect(parseOnmapListings({ data: [{ price: 6_000 }] }, 'x')).toEqual([]);
  });
});
