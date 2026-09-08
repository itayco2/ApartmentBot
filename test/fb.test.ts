import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { findCityByKey } from '../src/core/cities.js';
import { SessionExpiredError } from '../src/core/types.js';
import type { SavedSearch } from '../src/core/types.js';
import { createFacebookAdapter } from '../src/sources/facebook/fbAdapter.js';
import { groupsForCity } from '../src/sources/facebook/fbGroups.js';
import { buildAdapters } from '../src/sources/index.js';

const search = {} as SavedSearch;
const nobodyKnown = { find: () => undefined };

describe('facebook configuration', () => {
  it('is off by default, whatever profile directory exists', () => {
    // A profile directory is not proof of a session; only the flag is.
    expect(config.facebookEnabled).toBe(false);
  });

  it('has a group list per city, with Modi’in preset', () => {
    expect(groupsForCity(findCityByKey('modiin')!).length).toBeGreaterThan(0);
    expect(groupsForCity(findCityByKey('haifa')!)).toEqual([]);
  });

  it('builds an adapter that stays off without a key and a session', () => {
    const adapter = createFacebookAdapter(nobodyKnown);
    expect(adapter.name).toBe('facebook');
    expect(adapter.supports(search, findCityByKey('modiin')!)).toBe(false);
  });
});

describe('adapter registry', () => {
  it('registers every source once, facebook last', () => {
    const names = buildAdapters(nobodyKnown).map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names[0]).toBe('yad2');
    expect(names.at(-1)).toBe('facebook');
  });
});

describe('session expiry', () => {
  it('carries the source and the way to recover', () => {
    const error = new SessionExpiredError('facebook', 'npm run fb-login');
    expect(error.source).toBe('facebook');
    expect(error.message).toContain('npm run fb-login');
    expect(error).toBeInstanceOf(Error);
  });
});
