import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { SearchesRepo } from '../src/db/searches.repo.js';

describe('search requirements persistence', () => {
  let db: Db;
  let searches: SearchesRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    searches = new SearchesRepo(db);
  });

  const base = {
    chatId: 1,
    name: 't',
    cityKeys: ['modiin'],
    cityName: 'מודיעין מכבים רעות',
    minRooms: null,
    maxRooms: null,
    minPrice: null,
    maxPrice: null,
  };

  it('round-trips requirements through the database', () => {
    const created = searches.create({
      ...base,
      requirements: { amenities: ['חניה', 'מעלית'], brokers: 'private-only', minSqm: 80, keywords: ['נוף'] },
    });
    expect(searches.getById(created.id)?.requirements).toEqual({
      amenities: ['חניה', 'מעלית'],
      brokers: 'private-only',
      minSqm: 80,
      keywords: ['נוף'],
    });
  });

  it('leaves the field absent when nothing was required', () => {
    const created = searches.create(base);
    expect(searches.getById(created.id)?.requirements).toBeUndefined();
    const empty = searches.create({ ...base, requirements: { amenities: [] } });
    expect(searches.getById(empty.id)?.requirements).toBeUndefined();
  });

  it('updates requirements on an existing search', () => {
    const created = searches.create(base);
    searches.setRequirements(created.id, { brokers: 'private-only' });
    expect(searches.getById(created.id)?.requirements).toEqual({ brokers: 'private-only' });
    searches.setRequirements(created.id, undefined);
    expect(searches.getById(created.id)?.requirements).toBeUndefined();
  });

  it('survives a corrupt stored value', () => {
    const created = searches.create(base);
    db.prepare('UPDATE saved_searches SET requirements = ? WHERE id = ?').run('{not json', created.id);
    expect(searches.getById(created.id)?.requirements).toBeUndefined();
  });
});
