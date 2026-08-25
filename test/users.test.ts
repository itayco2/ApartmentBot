import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { SearchesRepo } from '../src/db/searches.repo.js';
import { UsersRepo } from '../src/db/users.repo.js';

describe('access and invites', () => {
  let db: Db;
  let users: UsersRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    users = new UsersRepo(db);
  });

  it('lets nobody in until an owner is registered', () => {
    expect(users.isAllowed(111)).toBe(false);
    expect(users.owner()).toBeUndefined();
  });

  it('admits a guest who opens a valid invite link', () => {
    users.add(111, 'Owner', true);
    const code = users.createInvite();

    expect(users.redeemInvite(code, 222, 'Guest')).toBe(true);
    expect(users.isAllowed(222)).toBe(true);
  });

  it('burns an invite after one use', () => {
    users.add(111, 'Owner', true);
    const code = users.createInvite();

    expect(users.redeemInvite(code, 222, 'Guest')).toBe(true);
    // A forwarded link must not let a third person in.
    expect(users.redeemInvite(code, 333, 'Stranger')).toBe(false);
    expect(users.isAllowed(333)).toBe(false);
  });

  it('rejects a made-up code', () => {
    users.add(111, 'Owner', true);
    expect(users.redeemInvite('not-a-real-code', 222, 'Stranger')).toBe(false);
    expect(users.isAllowed(222)).toBe(false);
  });

  it('recognises exactly one owner', () => {
    users.add(111, 'Owner', true);
    users.add(222, 'Guest');

    expect(users.owner()?.chatId).toBe(111);
    expect(users.get(222)?.isOwner).toBe(false);
  });

  it('will not remove the owner', () => {
    users.add(111, 'Owner', true);
    users.remove(111);
    expect(users.isAllowed(111)).toBe(true);
  });

  it('counts invites that have not been used', () => {
    users.add(111, 'Owner', true);
    users.createInvite();
    const code = users.createInvite();

    expect(users.pendingInvites()).toBe(2);
    users.redeemInvite(code, 222, 'Guest');
    expect(users.pendingInvites()).toBe(1);
  });
});

describe('per-user searches', () => {
  let db: Db;
  let searches: SearchesRepo;

  const make = (chatId: number, name: string) =>
    searches.create({
      chatId,
      name,
      cityKeys: ['modiin'],
      cityName: 'מודיעין מכבים רעות',
      minRooms: null,
      maxRooms: null,
      minPrice: null,
      maxPrice: null,
    });

  beforeEach(() => {
    db = openDatabase(':memory:');
    searches = new SearchesRepo(db);
  });

  it('shows each person only their own searches', () => {
    make(111, 'mine');
    make(222, 'theirs');

    expect(searches.list(111).map((s) => s.name)).toEqual(['mine']);
    expect(searches.list(222).map((s) => s.name)).toEqual(['theirs']);
  });

  it('still polls everyone’s searches together', () => {
    make(111, 'mine');
    make(222, 'theirs');
    // One sweep serves every user; alerts are routed per search afterwards.
    expect(searches.listActive()).toHaveLength(2);
  });

  it('remembers who each search belongs to, so alerts go to the right chat', () => {
    const mine = make(111, 'mine');
    expect(searches.getById(mine.id)?.chatId).toBe(111);
  });

  it('stops one person editing another’s search', () => {
    const theirs = make(222, 'theirs');
    expect(searches.belongsTo(theirs.id, 111)).toBe(false);
    expect(searches.belongsTo(theirs.id, 222)).toBe(true);
  });
});
