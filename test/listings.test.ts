import { beforeEach, describe, expect, it } from 'vitest';
import type { Listing } from '../src/core/types.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { ListingsRepo } from '../src/db/listings.repo.js';
import { SearchesRepo } from '../src/db/searches.repo.js';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    source: 'yad2',
    sourceId: 'a',
    url: 'https://x/a',
    price: 6_000,
    rooms: 3,
    city: 'מודיעין מכבים רעות',
    amenities: [],
    imageUrls: [],
    ...overrides,
  };
}

describe('match kind on recorded listings', () => {
  let db: Db;
  let repo: ListingsRepo;
  let searchId: number;

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

  it('remembers that a queued listing was only a near miss', () => {
    // The alert must say "כמעט מתאים" when it finally goes out, which may be
    // cycles later than when it was recorded.
    repo.recordPending([listing({ sourceId: 'near' }), listing({ sourceId: 'exact' })], searchId, 1, (l) =>
      l.sourceId === 'near' ? 'near' : 'exact',
    );

    const kinds = new Map(repo.pending().map((p) => [p.listing.sourceId, p.matchKind]));
    expect(kinds.get('near')).toBe('near');
    expect(kinds.get('exact')).toBe('exact');
  });

  it('treats a listing recorded without a kind as an exact match', () => {
    // Rows written before the column existed have NULL there.
    repo.recordPending([listing()], searchId, 1);
    expect(repo.pending()[0]?.matchKind).toBe('exact');
  });

  it('records the kind when seeding silently too', () => {
    repo.seedAsSeen([listing()], searchId, 1, () => 'near');
    const row = db
      .prepare('SELECT match_kind FROM seen_listings WHERE listing_id = ?')
      .get('a') as { match_kind: string | null };
    expect(row.match_kind).toBe('near');
  });
});
