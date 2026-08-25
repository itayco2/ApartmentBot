import { beforeEach, describe, expect, it } from 'vitest';
import type { Listing, SavedSearch } from '../src/core/types.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { ListingsRepo } from '../src/db/listings.repo.js';
import { SearchesRepo } from '../src/db/searches.repo.js';

const CHAT = 111;
const OTHER_CHAT = 222;

function listing(id: string, overrides: Partial<Listing> = {}): Listing {
  return {
    source: 'homeless',
    sourceId: id,
    url: `https://example.com/${id}`,
    price: 6_000,
    rooms: 3,
    city: 'מודיעין מכבים רעות',
    amenities: [],
    imageUrls: [],
    ...overrides,
  };
}

function makeSearch(searches: SearchesRepo, chatId: number, name: string): SavedSearch {
  return searches.create({
    chatId,
    name,
    cityKeys: ['modiin'],
    cityName: 'מודיעין מכבים רעות',
    minRooms: null,
    maxRooms: null,
    minPrice: null,
    maxPrice: null,
  });
}

describe('listing dedupe and seeding', () => {
  let db: Db;
  let listings: ListingsRepo;
  let search: SavedSearch;

  beforeEach(() => {
    db = openDatabase(':memory:');
    listings = new ListingsRepo(db);
    search = makeSearch(new SearchesRepo(db), CHAT, 'test');
  });

  it('treats every listing as new the first time it is seen', () => {
    const unseen = listings.selectUnseen([listing('a'), listing('b')], CHAT);
    expect(unseen.map((l) => l.sourceId)).toEqual(['a', 'b']);
  });

  it('does not report a listing twice once it has been recorded', () => {
    listings.recordPending([listing('a')], search.id, CHAT);
    const unseen = listings.selectUnseen([listing('a'), listing('b')], CHAT);
    expect(unseen.map((l) => l.sourceId)).toEqual(['b']);
  });

  it('keeps listings from different sources apart even with the same id', () => {
    listings.recordPending([listing('shared', { source: 'homeless' })], search.id, CHAT);
    expect(listings.selectUnseen([listing('shared', { source: 'madlan' })], CHAT)).toHaveLength(1);
  });

  it('seeds existing listings as already notified so day one is silent', () => {
    expect(listings.seedAsSeen([listing('a'), listing('b')], search.id, CHAT)).toBe(2);
    expect(listings.pending()).toHaveLength(0);
    expect(listings.selectUnseen([listing('a')], CHAT)).toHaveLength(0);
  });

  it('queues newly recorded listings until they are marked notified', () => {
    listings.recordPending([listing('a'), listing('b')], search.id, CHAT);
    expect(listings.pending()).toHaveLength(2);

    listings.markNotified('homeless', 'a', CHAT);
    const remaining = listings.pending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.listing.sourceId).toBe('b');
  });

  it('round-trips the whole listing through the queue', () => {
    const original = listing('a', { neighborhood: 'בוכמן', sqm: 85 });
    listings.recordPending([original], search.id, CHAT);

    const queued = listings.pending()[0];
    expect(queued?.listing).toMatchObject({ sourceId: 'a', neighborhood: 'בוכמן', sqm: 85 });
    expect(queued?.searchId).toBe(search.id);
    expect(queued?.chatId).toBe(CHAT);
  });

  it('ignores a repeated insert of the same listing', () => {
    listings.recordPending([listing('a')], search.id, CHAT);
    expect(listings.recordPending([listing('a')], search.id, CHAT)).toBe(0);
    expect(listings.total()).toBe(1);
  });

  it('does not alert the same flat twice when two boards both carry it', () => {
    const onYad2 = listing('y1', { source: 'yad2', sqm: 85 });
    const onRealta = listing('r1', { source: 'realta', sqm: 85 });

    listings.recordPending([onYad2], search.id, CHAT);
    expect(listings.selectUnseen([onRealta], CHAT)).toHaveLength(0);
  });

  it('collapses cross-source duplicates that arrive in the same fetch', () => {
    const both = [
      listing('y2', { source: 'yad2', price: 5_500, sqm: 70 }),
      listing('r2', { source: 'realta', price: 5_500, sqm: 70 }),
    ];
    expect(listings.selectUnseen(both, CHAT)).toHaveLength(1);
  });

  it('keeps genuinely different flats that share a price', () => {
    listings.recordPending([listing('a', { sqm: 85 })], search.id, CHAT);
    expect(listings.selectUnseen([listing('b', { source: 'realta', sqm: 110 })], CHAT)).toHaveLength(1);
  });

  it('falls back to id-only dedupe when a listing is too vague to fingerprint', () => {
    listings.recordPending([listing('v1', { price: null, rooms: null })], search.id, CHAT);
    const otherVague = listing('v2', { source: 'realta', price: null, rooms: null });
    expect(listings.selectUnseen([otherVague], CHAT)).toHaveLength(1);
  });

  it('reports which sources this chat has already recorded', () => {
    expect(listings.knownSources(CHAT).size).toBe(0);

    listings.recordPending([listing('a', { source: 'yad2' })], search.id, CHAT);
    listings.seedAsSeen([listing('b', { source: 'realta' })], search.id, CHAT);

    expect([...listings.knownSources(CHAT)].sort()).toEqual(['realta', 'yad2']);
  });

  it('stops queueing alerts for a search that has been deleted', () => {
    // The queue outlives the search: a batch collected minutes before the
    // search was removed used to keep arriving afterwards, advertising cities
    // the owner had just deleted.
    const searches = new SearchesRepo(db);
    const doomed = makeSearch(searches, CHAT, 'doomed');

    listings.recordPending([listing('a')], doomed.id, CHAT);
    expect(listings.pending()).toHaveLength(1);

    searches.remove(doomed.id);
    expect(listings.pending()).toHaveLength(0);
  });

  it('still delivers rows recorded before searches had ids', () => {
    // Legacy rows carry no search_id and are still owed to the owner.
    db.prepare(
      `INSERT INTO seen_listings (chat_id, source, listing_id, search_id, payload)
       VALUES (?, 'homeless', 'legacy', NULL, ?)`,
    ).run(CHAT, JSON.stringify(listing('legacy')));

    expect(listings.pending().map((p) => p.listing.sourceId)).toContain('legacy');
  });

  it('discards a search’s queue without forgetting the listings were seen', () => {
    listings.recordPending([listing('a'), listing('b')], search.id, CHAT);

    expect(listings.discardPending(search.id)).toBe(2);
    expect(listings.pending()).toHaveLength(0);
    // Marked seen, not deleted: re-adding that city seeds quietly rather than
    // replaying the whole back catalogue as new.
    expect(listings.selectUnseen([listing('a')], CHAT)).toHaveLength(0);
    expect(listings.wasNotified('homeless', 'a', CHAT)).toBe(true);
  });

  it('discarding an empty queue is harmless', () => {
    expect(listings.discardPending(search.id)).toBe(0);
  });

  it('handles an empty batch without touching the database', () => {
    expect(listings.selectUnseen([], CHAT)).toEqual([]);
    expect(listings.recordPending([], search.id, CHAT)).toBe(0);
  });
});

describe('one person’s alerts do not consume another’s', () => {
  let db: Db;
  let listings: ListingsRepo;
  let mine: SavedSearch;
  let theirs: SavedSearch;

  beforeEach(() => {
    db = openDatabase(':memory:');
    listings = new ListingsRepo(db);
    const searches = new SearchesRepo(db);
    mine = makeSearch(searches, CHAT, 'mine');
    theirs = makeSearch(searches, OTHER_CHAT, 'theirs');
  });

  it('still alerts the second person about a flat the first already saw', () => {
    // The key used to be (source, listing_id) with no chat, so whoever polled
    // first claimed a listing and the second user silently got almost nothing.
    listings.recordPending([listing('a')], mine.id, CHAT);
    expect(listings.selectUnseen([listing('a')], OTHER_CHAT)).toHaveLength(1);
  });

  it('keeps each person’s notified state separate', () => {
    listings.recordPending([listing('a')], mine.id, CHAT);
    listings.recordPending([listing('a')], theirs.id, OTHER_CHAT);
    listings.markNotified('homeless', 'a', CHAT);

    expect(listings.wasNotified('homeless', 'a', CHAT)).toBe(true);
    expect(listings.wasNotified('homeless', 'a', OTHER_CHAT)).toBe(false);
  });

  it('queues the same flat separately for each person', () => {
    listings.recordPending([listing('a')], mine.id, CHAT);
    listings.recordPending([listing('a')], theirs.id, OTHER_CHAT);

    const pending = listings.pending();
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.chatId).sort()).toEqual([CHAT, OTHER_CHAT]);
  });

  it('does not let one person’s sources count as another’s first sighting', () => {
    // Otherwise the second user's first cycle would treat every source as
    // already known and alert its entire back catalogue.
    listings.recordPending([listing('a', { source: 'yad2' })], mine.id, CHAT);
    expect(listings.knownSources(OTHER_CHAT).size).toBe(0);
  });

  it('tracks price drops per person', () => {
    listings.seedAsSeen([listing('a', { price: 7_000 })], mine.id, CHAT);

    expect(listings.findPriceDrops([listing('a', { price: 6_500 })], CHAT)).toHaveLength(1);
    // The other person never saw the original price, so there is nothing to report.
    expect(listings.findPriceDrops([listing('a', { price: 6_500 })], OTHER_CHAT)).toHaveLength(0);
  });

  it('counts each person’s listings separately', () => {
    listings.recordPending([listing('a'), listing('b')], mine.id, CHAT);
    listings.recordPending([listing('a')], theirs.id, OTHER_CHAT);

    expect(listings.total(CHAT)).toBe(2);
    expect(listings.total(OTHER_CHAT)).toBe(1);
    expect(listings.total()).toBe(3);
  });
});

describe('saved searches', () => {
  let db: Db;
  let searches: SearchesRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    searches = new SearchesRepo(db);
  });

  it('stores and returns the bounds the wizard collected', () => {
    const created = searches.create({
      chatId: CHAT,
      name: 'מודיעין · 3+ חד׳ · עד 6,500 ₪',
      cityKeys: ['modiin'],
      cityName: 'מודיעין מכבים רעות',
      minRooms: 3,
      maxRooms: null,
      minPrice: null,
      maxPrice: 6_500,
    });

    expect(created).toMatchObject({ minRooms: 3, maxRooms: null, maxPrice: 6_500, active: true });
    expect(searches.getById(created.id)).toMatchObject({ cityKeys: ['modiin'] });
  });

  it('finds an existing search with the same rooms and budget', () => {
    // What stops /add stacking a near-duplicate every time a city is added.
    const first = searches.create({
      chatId: CHAT,
      name: 'modiin',
      cityKeys: ['modiin'],
      cityName: 'מודיעין מכבים רעות',
      minRooms: 3,
      maxRooms: 4,
      minPrice: 5_000,
      maxPrice: 6_500,
    });

    const bounds = { minRooms: 3, maxRooms: 4, minPrice: 5_000, maxPrice: 6_500 };
    expect(searches.findByBounds(CHAT, bounds)?.id).toBe(first.id);

    // A different budget is a different search, not the same one.
    expect(searches.findByBounds(CHAT, { ...bounds, maxPrice: 8_000 })).toBeUndefined();
    // And one person's search is never offered to another.
    expect(searches.findByBounds(OTHER_CHAT, bounds)).toBeUndefined();
  });

  it('repoints a search at new cities without changing its id', () => {
    const created = makeSearch(searches, CHAT, 'x');

    const updated = searches.setCities(
      created.id,
      ['modiin', 'rishon'],
      'מודיעין מכבים רעות, ראשון לציון',
      'שניים ביחד',
    );

    expect(updated?.id).toBe(created.id);
    expect(updated?.cityKeys).toEqual(['modiin', 'rishon']);
    expect(updated?.name).toBe('שניים ביחד');
    expect(searches.list(CHAT)).toHaveLength(1);
  });

  it('refuses to leave a search with no city at all', () => {
    const created = makeSearch(searches, CHAT, 'x');
    expect(searches.setCities(created.id, [], '', 'empty')?.cityKeys).toEqual(['modiin']);
  });

  it('excludes paused searches from the active list', () => {
    const created = makeSearch(searches, CHAT, 'x');

    searches.setActive(created.id, false);
    expect(searches.listActive()).toHaveLength(0);
    expect(searches.list()).toHaveLength(1);

    searches.setActive(created.id, true);
    expect(searches.listActive()).toHaveLength(1);
  });
});

describe('fingerprint: the same flat seen from two boards', () => {
  let db: Db;
  let listings: ListingsRepo;
  let search: SavedSearch;

  beforeEach(() => {
    db = openDatabase(':memory:');
    listings = new ListingsRepo(db);
    search = makeSearch(new SearchesRepo(db), CHAT, 'fp');
  });

  /**
   * The live failure: yad2 published נהר הירדן 24 at 170 sqm and realta the
   * same flat as נהר הירדן with no size at all. The discriminator was chosen
   * per listing - size when known, street otherwise - so the two sides never
   * produced the same key and the flat was sent twice.
   */
  it('collapses a flat one board sizes and the other does not', () => {
    listings.recordPending(
      [listing('y', { source: 'yad2', address: 'נהר הירדן 24', sqm: 170 })],
      search.id,
      CHAT,
    );
    const onRealta = listing('r', { source: 'realta', address: 'נהר הירדן' });

    expect(listings.selectUnseen([onRealta], CHAT)).toHaveLength(0);
  });

  it('ignores the house number, which boards report inconsistently', () => {
    listings.recordPending([listing('a', { address: 'רוטשילד 64' })], search.id, CHAT);
    const sameStreet = listing('b', { source: 'onmap', address: 'רחוב רוטשילד' });

    expect(listings.selectUnseen([sameStreet], CHAT)).toHaveLength(0);
  });

  it('keeps flats on one street apart when the price or the rooms differ', () => {
    listings.recordPending([listing('a', { address: 'רוטשילד 5' })], search.id, CHAT);

    expect(
      listings.selectUnseen([listing('b', { source: 'realta', address: 'רוטשילד 12', price: 6_500 })], CHAT),
    ).toHaveLength(1);
    expect(
      listings.selectUnseen([listing('c', { source: 'realta', address: 'רוטשילד 12', rooms: 4 })], CHAT),
    ).toHaveLength(1);
  });

  it('still uses the size when no street is published', () => {
    listings.recordPending([listing('a', { sqm: 85 })], search.id, CHAT);

    expect(listings.selectUnseen([listing('b', { source: 'realta', sqm: 85 })], CHAT)).toHaveLength(0);
    expect(listings.selectUnseen([listing('c', { source: 'realta', sqm: 110 })], CHAT)).toHaveLength(1);
  });
});
