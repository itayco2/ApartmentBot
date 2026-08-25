import { describe, expect, it } from 'vitest';
import { compareToMarket, describeComparison } from '../src/core/marketStats.js';
import type { Listing } from '../src/core/types.js';

function flat(price: number | null, rooms: number | null = 3, city = 'מודיעין מכבים רעות'): Listing {
  return {
    source: 'yad2',
    sourceId: `${price}-${rooms}-${Math.random()}`,
    url: 'https://example.com/x',
    price,
    rooms,
    city,
    amenities: [],
    imageUrls: [],
  };
}

// Six 3-room flats: median is 6,500.
const market = [flat(5_000), flat(6_000), flat(6_400), flat(6_600), flat(7_500), flat(8_000)];

describe('market comparison', () => {
  it('measures a listing against the median for its size', () => {
    const result = compareToMarket(flat(5_200), market);
    expect(result?.medianPrice).toBe(6_500);
    expect(result?.percentDifference).toBe(-20);
    expect(result?.sampleSize).toBe(6);
  });

  it('says where a listing ranks among its peers', () => {
    expect(compareToMarket(flat(5_200), market)?.rankFromCheapest).toBe(2);
    expect(compareToMarket(flat(9_000), market)?.rankFromCheapest).toBe(7);
  });

  it('treats a 3 and a 3.5 as competing for the same tenant', () => {
    // Half a room either way is the same slice of the market.
    expect(compareToMarket(flat(6_000, 3.5), market)?.sampleSize).toBe(6);
    expect(compareToMarket(flat(6_000, 5), market)).toBeNull();
  });

  it('does not compare across cities', () => {
    expect(compareToMarket(flat(6_000, 3, 'תל אביב יפו'), market)).toBeNull();
  });

  it('refuses to draw a conclusion from too few peers', () => {
    // A "median" of two listings is noise, not a benchmark.
    expect(compareToMarket(flat(6_000), [flat(5_000), flat(7_000)])).toBeNull();
  });

  it('needs a price and a room count to compare at all', () => {
    expect(compareToMarket(flat(null), market)).toBeNull();
    expect(compareToMarket(flat(6_000, null), market)).toBeNull();
  });

  it('ignores peers with no price', () => {
    const withGaps = [...market, flat(null), flat(null)];
    expect(compareToMarket(flat(5_200), withGaps)?.sampleSize).toBe(6);
  });
});

describe('comparison wording', () => {
  const say = (price: number) => describeComparison(compareToMarket(flat(price), market)!);

  it('calls out a genuine bargain', () => {
    expect(say(5_000)).toContain('זול');
    expect(say(5_000)).toContain('%');
  });

  it('mentions a modest saving more quietly', () => {
    expect(say(6_000)).toContain('מתחת לחציון');
  });

  it('stays silent when a listing is simply average', () => {
    // "3% above the median" is noise and would dilute the real signals.
    expect(say(6_600)).toBeNull();
  });

  it('warns when a listing is well over the going rate', () => {
    expect(say(8_500)).toContain('יקר');
  });
});
