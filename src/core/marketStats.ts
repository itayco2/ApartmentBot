import type { Listing } from './types.js';

/** How a listing compares with similar flats on the market right now. */
export interface MarketComparison {
  /** Typical rent for this size in this city. */
  medianPrice: number;
  /** Negative means cheaper than typical. */
  percentDifference: number;
  /** How many listings the comparison is based on. */
  sampleSize: number;
  /** 1 = cheapest of its kind currently listed. */
  rankFromCheapest: number;
}

/** Below this a median is noise rather than a benchmark. */
const MIN_SAMPLE = 4;

/**
 * Compares a listing against others of the same size in the same city.
 *
 * The point is to answer the question a price alone cannot: is 6,300 ₪ a good
 * deal here, or the going rate? Rooms are matched within half a room, since
 * a 3 and a 3.5 compete for the same tenant.
 */
export function compareToMarket(listing: Listing, market: Listing[]): MarketComparison | null {
  if (listing.price === null || listing.rooms === null) return null;

  const peers = market.filter(
    (other) =>
      other.price !== null &&
      other.rooms !== null &&
      Math.abs(other.rooms - listing.rooms!) <= 0.5 &&
      sameCity(other.city, listing.city),
  );
  if (peers.length < MIN_SAMPLE) return null;

  const prices = peers.map((p) => p.price!).sort((a, b) => a - b);
  const median = medianOf(prices);
  if (median <= 0) return null;

  return {
    medianPrice: Math.round(median),
    percentDifference: Math.round(((listing.price - median) / median) * 100),
    sampleSize: peers.length,
    rankFromCheapest: prices.filter((p) => p < listing.price!).length + 1,
  };
}

function medianOf(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function sameCity(a: string, b: string): boolean {
  const normalize = (t: string) => t.replace(/[-־–—]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalize(a) === normalize(b);
}

/**
 * One line of plain Hebrew, or null when the difference is too small to be
 * worth a line. Saying "3% above average" is noise; saying "18% below" is the
 * reason to open the listing.
 */
export function describeComparison(comparison: MarketComparison): string | null {
  const { percentDifference: diff, medianPrice, sampleSize, rankFromCheapest } = comparison;
  const median = medianPrice.toLocaleString('en-US');

  if (diff <= -15) {
    return `🔥 זול ב-${Math.abs(diff)}% מהחציון באזור (${median} ₪ ל-${sampleSize} דירות דומות)`;
  }
  if (diff <= -5) {
    return `📉 מתחת לחציון ב-${Math.abs(diff)}% (חציון ${median} ₪)`;
  }
  if (rankFromCheapest <= 3 && sampleSize >= 6) {
    return `✨ מהזולות באזור - מקום ${rankFromCheapest} מתוך ${sampleSize} דירות דומות`;
  }
  if (diff >= 20) {
    return `📈 יקר ב-${diff}% מהחציון באזור (${median} ₪)`;
  }
  return null;
}
