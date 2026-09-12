import { beforeEach, describe, expect, it } from 'vitest';
import { chooseSaveTarget, type SaveDraft } from '../src/bot/addWizard.js';
import type { SavedSearch } from '../src/core/types.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { SearchesRepo } from '../src/db/searches.repo.js';

function saved(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 1,
    chatId: 10,
    name: 's',
    cityKeys: ['modiin'],
    cityName: 'מודיעין מכבים רעות',
    minRooms: 2.5,
    maxRooms: 4,
    minPrice: 5_000,
    maxPrice: 6_500,
    active: true,
    createdAt: '',
    ...overrides,
  };
}

function draft(overrides: Partial<SaveDraft> = {}): SaveDraft {
  return {
    cityKeys: ['modiin'],
    minRooms: 2.5,
    maxRooms: 4,
    minPrice: 5_000,
    maxPrice: 6_500,
    originId: null,
    ...overrides,
  };
}

describe('chooseSaveTarget', () => {
  it('saves a new search when nothing like it exists', () => {
    expect(chooseSaveTarget(draft(), [])).toEqual({ kind: 'new' });
  });

  it('recognises an exact duplicate', () => {
    const existing = saved();
    expect(chooseSaveTarget(draft(), [existing])).toEqual({ kind: 'duplicate', search: existing });
  });

  it('offers the same-bounds search when only the cities differ', () => {
    const existing = saved();
    const target = chooseSaveTarget(draft({ cityKeys: ['modiin', 'rishon'] }), [existing]);
    expect(target).toEqual({ kind: 'same-bounds', search: existing });
  });

  it('city order is not a difference', () => {
    const existing = saved({ cityKeys: ['modiin', 'rishon'] });
    const target = chooseSaveTarget(draft({ cityKeys: ['rishon', 'modiin'] }), [existing]);
    expect(target).toEqual({ kind: 'duplicate', search: existing });
  });

  /**
   * The regression this whole change exists for: narrowing a search means
   * changing its bounds, which is exactly when the bounds lookup finds
   * nothing and a second, unfiltered search used to be created alongside.
   */
  it('offers the search /add opened on when its bounds were edited', () => {
    const existing = saved({ id: 6 });
    const target = chooseSaveTarget(
      draft({ minRooms: 3, maxRooms: null, originId: 6 }),
      [existing],
    );
    expect(target).toEqual({ kind: 'edited', search: existing });
  });

  it('still saves a new search when /add started from a blank slate', () => {
    const existing = saved({ id: 6 });
    const target = chooseSaveTarget(draft({ minRooms: 3, maxRooms: null, originId: null }), [
      existing,
    ]);
    expect(target).toEqual({ kind: 'new' });
  });

  it('ignores an origin that has since been deleted', () => {
    const target = chooseSaveTarget(draft({ minRooms: 3, maxRooms: null, originId: 99 }), []);
    expect(target).toEqual({ kind: 'new' });
  });

  it('prefers an exact bounds match over the origin', () => {
    const origin = saved({ id: 6, minRooms: 2, maxRooms: 4 });
    const twin = saved({ id: 8, cityKeys: ['rishon'] });
    const target = chooseSaveTarget(draft({ cityKeys: ['modiin'], originId: 6 }), [origin, twin]);
    expect(target).toEqual({ kind: 'same-bounds', search: twin });
  });
});

describe('SearchesRepo.setBounds', () => {
  let db: Db;
  let repo: SearchesRepo;
  let id: number;

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new SearchesRepo(db);
    id = repo.create({
      chatId: 10,
      name: 'before',
      cityKeys: ['rishon'],
      cityName: 'ראשון לציון',
      minRooms: 2.5,
      maxRooms: 4,
      minPrice: 5_000,
      maxPrice: 6_500,
      areas: { rishon: ['נעורים'] },
    }).id;
  });

  it('replaces the bounds and keeps the id, areas and history', () => {
    const updated = repo.setBounds(id, {
      minRooms: 3,
      maxRooms: null,
      minPrice: 5_000,
      maxPrice: 6_500,
    });

    expect(updated?.id).toBe(id);
    expect(updated?.minRooms).toBe(3);
    expect(updated?.maxRooms).toBeNull();
    expect(updated?.areas).toEqual({ rishon: ['נעורים'] });
  });
});
