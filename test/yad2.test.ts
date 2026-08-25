import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { listingSchema, type Listing } from '../src/core/types.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { ListingsRepo } from '../src/db/listings.repo.js';
import { SearchesRepo } from '../src/db/searches.repo.js';
import {
  dateFromImageUrl,
  parseYad2Body,
  parseYad2Markers,
} from '../src/sources/yad2/yad2Normalize.js';

const payload = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures', 'yad2-modiin.json'), 'utf8'),
);

const listings = parseYad2Markers(payload, 'מודיעין מכבים רעות');

describe('yad2 normalizer', () => {
  it('reads the map feed, which returns the whole city in one call', () => {
    expect(listings.length).toBeGreaterThan(50);
  });

  it('produces listings that satisfy the shared Listing schema', () => {
    for (const listing of listings) {
      expect(() => listingSchema.parse(listing)).not.toThrow();
    }
  });

  it('drops storage units, parking and business premises', () => {
    // The rental feed mixes these in; a מחסן at 1,100 ₪ is not somewhere to live.
    for (const listing of listings) {
      expect(listing.propertyType ?? '').not.toMatch(/מחסן|חניה|משרד|חנות/);
    }
  });

  it('builds a working item url from the listing token', () => {
    for (const listing of listings) {
      expect(listing.url).toMatch(/^https:\/\/www\.yad2\.co\.il\/realestate\/item\/\w+$/);
    }
  });

  it('marks agency listings as broker and by-owner ones as private', () => {
    const flagged = listings.filter((l) => l.isBroker !== undefined);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.some((l) => l.isBroker === false)).toBe(true);
  });

  it('renders ground floor in words rather than "קומה 0"', () => {
    for (const listing of listings) {
      expect(listing.floor).not.toBe('קומה 0');
    }
  });

  it('only returns listings in the requested city', () => {
    for (const listing of listings) {
      expect(listing.city).toBe('מודיעין מכבים רעות');
    }
  });

  it('ignores sponsored blocks that sit alongside the real markers', () => {
    // yad1Markers / grayMarkers / agencyPromotions are paid placements.
    const ids = new Set(listings.map((l) => l.sourceId));
    expect(ids.size).toBe(listings.length);
  });

  it('recovers a posting date from the photo url, since the API has no date field', () => {
    // Yad2 stores images under a path ending in an upload timestamp:
    // .../y2_1pa_010595_20260816161412.jpeg -> 2026-08-16 16:14:12
    const parsed = dateFromImageUrl(
      'https://img.yad2.co.il/Pic/202608/16/2_6/o/y2_1pa_010595_20260816161412.jpeg?c=6',
    );
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(7);
    expect(parsed?.getDate()).toBe(16);
  });

  it('rejects urls with no timestamp, and nonsense stamps', () => {
    expect(dateFromImageUrl('https://img.yad2.co.il/Pic/nopic.jpg')).toBeUndefined();
    expect(dateFromImageUrl(null)).toBeUndefined();
    expect(dateFromImageUrl('https://x/_19990101000000.jpg')).toBeUndefined();
  });

  it('dates most of the real feed, which is what makes the 30-day rule work here', () => {
    const dated = listings.filter((l) => l.postedAt instanceof Date);
    expect(dated.length).toBeGreaterThan(listings.length / 2);
    for (const l of dated) {
      expect(l.postedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    }
  });

  it('returns nothing for an unexpected payload rather than throwing', () => {
    expect(parseYad2Markers({ nope: true }, 'x')).toEqual([]);
    expect(parseYad2Markers(null, 'x')).toEqual([]);
  });
});

describe('price drops', () => {
  let db: Db;
  let repo: ListingsRepo;
  let searchId: number;

  const listing = (price: number): Listing => ({
    source: 'yad2',
    sourceId: 'abc123',
    url: 'https://www.yad2.co.il/realestate/item/abc123',
    price,
    rooms: 3,
    city: 'מודיעין מכבים רעות',
    amenities: [],
    imageUrls: [],
  });

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new ListingsRepo(db);
    searchId = new SearchesRepo(db).create({
      chatId: 1,
      name: 't',
      cityKeys: ['modiin'],
      cityName: 'מודיעין מכבים רעות',
      minRooms: null,
      maxRooms: null,
      minPrice: null,
      maxPrice: null,
    }).id;
  });

  it('reports a listing that got cheaper', () => {
    repo.seedAsSeen([listing(7_000)], searchId, 1);

    const drops = repo.findPriceDrops([listing(6_500)], 1);
    expect(drops).toHaveLength(1);
    expect(drops[0]?.previousPrice).toBe(7_000);
    expect(drops[0]?.listing.price).toBe(6_500);
  });

  it('does not report the same drop twice', () => {
    repo.seedAsSeen([listing(7_000)], searchId, 1);

    expect(repo.findPriceDrops([listing(6_500)], 1)).toHaveLength(1);
    expect(repo.findPriceDrops([listing(6_500)], 1)).toHaveLength(0);
  });

  it('ignores price rises', () => {
    repo.seedAsSeen([listing(6_000)], searchId, 1);
    expect(repo.findPriceDrops([listing(6_800)], 1)).toHaveLength(0);
  });

  it('ignores listings it has never seen before', () => {
    // Those are new listings, and are alerted through the normal path.
    expect(repo.findPriceDrops([listing(6_000)], 1)).toHaveLength(0);
  });

  it('ignores listings with no price on either side', () => {
    repo.seedAsSeen([{ ...listing(6_000), price: null }], searchId, 1);
    expect(repo.findPriceDrops([listing(5_000)], 1)).toHaveLength(0);
    expect(repo.findPriceDrops([{ ...listing(6_000), price: null }], 1)).toHaveLength(0);
  });

  it('reports a further drop after the first one', () => {
    repo.seedAsSeen([listing(7_000)], searchId, 1);

    expect(repo.findPriceDrops([listing(6_500)], 1)).toHaveLength(1);
    const second = repo.findPriceDrops([listing(6_000)], 1);
    expect(second).toHaveLength(1);
    expect(second[0]?.previousPrice).toBe(6_500);
  });
});

describe('yad2 body parsing', () => {
  it('throws on a non-JSON body so the failure reaches health tracking', () => {
    // A challenge page is HTTP 200 with an HTML body. Returning [] here made
    // the largest source go dark with nothing but a warning in the log.
    expect(() => parseYad2Body('<head><title>Radware Bot Manager Captcha</title>', 'x')).toThrow(
      /non-JSON/,
    );
  });

  it('parses a JSON body into the same listings as the marker parser', () => {
    expect(parseYad2Body(JSON.stringify(payload), 'מודיעין מכבים רעות')).toHaveLength(listings.length);
  });
});
