import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listingSchema } from '../src/core/types.js';
import { parseRealtaListings } from '../src/sources/realta/realtaNormalize.js';

const payload = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'realta-modiin.json'), 'utf8'),
);

const listings = parseRealtaListings(payload, 'מודיעין מכבים רעות');

describe('realta normalizer', () => {
  it('reads every property in the page', () => {
    expect(listings.length).toBe(payload.properties.length);
  });

  it('produces listings that satisfy the shared Listing schema', () => {
    for (const listing of listings) {
      expect(() => listingSchema.parse(listing)).not.toThrow();
    }
  });

  it('records which underlying board each listing came from', () => {
    const sources = new Set(listings.map((l) => l.originalSource));
    // The whole point of the aggregator: boards we cannot reach directly.
    expect(sources.size).toBeGreaterThan(1);
    expect([...sources]).toContain('יד2');
  });

  it('builds an absolute listing url', () => {
    for (const listing of listings) {
      expect(listing.url).toMatch(/^https:\/\/realta\.co\.il\/he\//);
    }
  });

  it('translates amenity codes into Hebrew labels', () => {
    const withAmenities = listings.find((l) => l.amenities.length > 0);
    expect(withAmenities).toBeDefined();
    // Codes such as PARKING must never reach the message text.
    for (const listing of listings) {
      for (const amenity of listing.amenities) {
        expect(amenity).not.toMatch(/^[A-Z_]+$/);
      }
    }
  });

  it('keeps prices and room counts as numbers, or null when absent', () => {
    for (const listing of listings) {
      expect(listing.price === null || typeof listing.price === 'number').toBe(true);
      expect(listing.rooms === null || typeof listing.rooms === 'number').toBe(true);
    }
  });

  it('reads the publish date so listing age can be shown', () => {
    const dated = listings.filter((l) => l.postedAt instanceof Date);
    expect(dated.length).toBeGreaterThan(0);
    for (const listing of dated) {
      expect(Number.isNaN(listing.postedAt!.getTime())).toBe(false);
    }
  });

  it('renders ground floor in words rather than as "קומה 0"', () => {
    for (const listing of listings) {
      expect(listing.floor).not.toBe('קומה 0');
    }
  });

  it('skips malformed entries instead of throwing', () => {
    const mixed = { properties: [{ nonsense: true }, ...payload.properties.slice(0, 2)] };
    expect(parseRealtaListings(mixed, 'x').length).toBe(2);
  });

  it('returns nothing for an unexpected payload shape', () => {
    expect(parseRealtaListings({ unexpected: 1 }, 'x')).toEqual([]);
    expect(parseRealtaListings(null, 'x')).toEqual([]);
  });
});
