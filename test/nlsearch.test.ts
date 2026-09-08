import { describe, expect, it } from 'vitest';
import { applyDraftToExisting, looksLikeSearchRequest, parseSearchRequestJson } from '../src/llm/parseSearchRequest.js';
import type { SavedSearch } from '../src/core/types.js';

describe('free-text search request', () => {
  it('turns the model’s reading into a draft with resolved cities', () => {
    const draft = parseSearchRequestJson({
      cities: ['מודיעין', 'ראשון לציון'],
      minRooms: 3,
      maxRooms: null,
      minPrice: null,
      maxPrice: 6500,
      areas: [{ city: 'ראשון לציון', names: ['צפון ראשון'] }],
      amenities: ['חניה'],
      privateOnly: true,
      minSqm: null,
      keywords: [],
      unclear: [],
    });
    expect(draft?.cityKeys).toEqual(['modiin', 'rishon']);
    expect(draft?.minRooms).toBe(3);
    expect(draft?.maxPrice).toBe(6500);
    expect(draft?.areas).toEqual({ rishon: ['צפון ראשון'] });
    expect(draft?.requirements).toEqual({ amenities: ['חניה'], brokers: 'private-only' });
    expect(draft?.unresolved).toEqual([]);
  });

  it('keeps an unknown city as unresolved text rather than dropping it silently', () => {
    const draft = parseSearchRequestJson({ cities: ['מודיעין', 'עיר שלא קיימת'], unclear: ['בלי מדרגות'] });
    expect(draft?.cityKeys).toEqual(['modiin']);
    expect(draft?.unresolved).toEqual(['עיר שלא קיימת', 'בלי מדרגות']);
  });

  it('treats a missing key the same as null and ignores impossible numbers', () => {
    const draft = parseSearchRequestJson({ cities: ['מודיעין'], maxPrice: -5, minRooms: 0 });
    expect(draft?.maxPrice).toBeNull();
    expect(draft?.minRooms).toBeNull();
    expect(draft?.requirements).toBeUndefined();
  });

  it('returns null when no city could be resolved or the reply is unreadable', () => {
    expect(parseSearchRequestJson({ cities: [] })).toBeNull();
    expect(parseSearchRequestJson(null)).toBeNull();
    expect(parseSearchRequestJson('nope')).toBeNull();
  });
});

describe('deciding whether a message is a search request', () => {
  it('recognises a city name, or rooms and a budget', () => {
    expect(looksLikeSearchRequest('3 חדרים במודיעין עד 6500')).toBe(true);
    expect(looksLikeSearchRequest('רמת גן')).toBe(true);
    expect(looksLikeSearchRequest('מחפש 4 חד׳ עד 7000 שקל')).toBe(true);
  });

  it('does not send chit-chat to the model', () => {
    expect(looksLikeSearchRequest('היי מה קורה')).toBe(false);
    expect(looksLikeSearchRequest('תודה!')).toBe(false);
    expect(looksLikeSearchRequest('')).toBe(false);
  });
});

describe('draft hygiene', () => {
  it('drops a keyword that merely repeats an area name', () => {
    // The model tends to put "צפון העיר" in both places; as a keyword it would
    // silently require the phrase to appear in every ad.
    const draft = parseSearchRequestJson({
      cities: ['ראשון לציון'],
      areas: [{ city: 'ראשון לציון', names: ['צפון העיר'] }],
      keywords: ['צפון העיר', 'נוף'],
    });
    expect(draft?.requirements?.keywords).toEqual(['נוף']);
    expect(draft?.areas).toEqual({ rishon: ['צפון העיר'] });
  });
});

describe('a draft on top of an existing search', () => {
  const existing: SavedSearch = {
    id: 3, chatId: 1, name: 'x', cityKeys: ['modiin'], cityName: 'מודיעין מכבים רעות',
    minRooms: 3, maxRooms: 4, minPrice: null, maxPrice: 6_500,
    areas: { modiin: ['משואה'] }, requirements: { brokers: 'private-only' },
    active: true, createdAt: '',
  };
  const base = { minRooms: null, maxRooms: null, minPrice: null, maxPrice: null, areas: {}, unresolved: [] };

  it('treats "also Rishon" - a city with no bounds - as adding to what is already saved', () => {
    // "/add is far more often 'and Rishon too' than 'forget everything'", and
    // the model is told not to invent bounds the message did not state.
    const merged = applyDraftToExisting({ ...base, cityKeys: ['rishon'] }, existing);
    expect(merged.cityKeys).toEqual(['modiin', 'rishon']);
    expect(merged.minRooms).toBe(3);
    expect(merged.maxPrice).toBe(6_500);
    expect(merged.areas).toEqual({ modiin: ['משואה'] });
    expect(merged.requirements).toEqual({ brokers: 'private-only' });
  });

  it('takes a request with its own bounds as a search in its own right', () => {
    const merged = applyDraftToExisting({ ...base, cityKeys: ['rishon'], maxPrice: 7_000 }, existing);
    expect(merged.cityKeys).toEqual(['rishon']);
    expect(merged.minRooms).toBeNull();
    expect(merged.requirements).toBeUndefined();
  });

  it('is the draft itself when nothing is saved yet', () => {
    const draft = { ...base, cityKeys: ['rishon'] };
    expect(applyDraftToExisting(draft, undefined)).toEqual(draft);
  });
});
