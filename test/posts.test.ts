import { describe, expect, it } from 'vitest';
import { POSTS_PER_CALL, buildPostsPrompt, parseExtractedPosts } from '../src/llm/extractPosts.js';
import { ParsedPostCache } from '../src/sources/parsedPostCache.js';

describe('batch post extraction', () => {
  const ids = ['p1', 'p2', 'p3'];

  it('maps each result back to its post by index', () => {
    const parsed = parseExtractedPosts(
      {
        posts: [
          { index: 0, isRentalListing: true, price: 5500, rooms: 3, amenities: [] },
          { index: 2, isRentalListing: false, isWantedPost: true, amenities: [] },
        ],
      },
      ids,
    );
    expect(parsed.get('p1')?.price).toBe(5500);
    expect(parsed.get('p2')).toBeUndefined();
    expect(parsed.get('p3')?.isWantedPost).toBe(true);
  });

  it('validates each post independently, so one bad entry does not lose the batch', () => {
    const parsed = parseExtractedPosts(
      {
        posts: [
          { index: 0, isRentalListing: true, price: 5500, amenities: [] },
          'garbage',
          { index: 1, isRentalListing: 'yes', amenities: [] },
          { index: 2, isRentalListing: true, rooms: 0, price: -5, amenities: [] },
        ],
      },
      ids,
    );
    expect([...parsed.keys()]).toEqual(['p1', 'p3']);
    // Impossible numbers mean "unknown", not "throw the post away".
    expect(parsed.get('p3')?.rooms).toBeNull();
    expect(parsed.get('p3')?.price).toBeNull();
  });

  it('treats a missing key the same as null', () => {
    // A strict schema once dropped a whole post over one absent key.
    const parsed = parseExtractedPosts({ posts: [{ index: 0, isRentalListing: true }] }, ids);
    expect(parsed.get('p1')?.sqm).toBeNull();
    expect(parsed.get('p1')?.amenities).toEqual([]);
    expect(parsed.get('p1')?.isBroker).toBeNull();
  });

  it('ignores an index that points outside the batch', () => {
    const parsed = parseExtractedPosts({ posts: [{ index: 7, isRentalListing: true }] }, ids);
    expect(parsed.size).toBe(0);
  });

  it('returns nothing for a malformed response', () => {
    expect(parseExtractedPosts(null, ids).size).toBe(0);
    expect(parseExtractedPosts({ posts: 'nope' }, ids).size).toBe(0);
  });

  it('numbers the posts in the prompt so the model can refer back to them', () => {
    const prompt = buildPostsPrompt('מודיעין', ['דירת 3 חדרים 5500', 'מחפשת דירה']);
    expect(prompt).toContain('[0]');
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('מודיעין');
    expect(prompt.indexOf('דירת 3 חדרים')).toBeLessThan(prompt.indexOf('מחפשת דירה'));
  });

  it('keeps batches small enough to answer inside the call timeout', () => {
    expect(POSTS_PER_CALL).toBeGreaterThanOrEqual(5);
    expect(POSTS_PER_CALL).toBeLessThanOrEqual(15);
  });
});

describe('recently-parsed post cache', () => {
  it('remembers a post for the ttl and forgets it afterwards', () => {
    // Posts the model already judged as "not a rental" never reach the
    // database, so without this they would be re-parsed every fetch.
    let now = 1_000_000;
    const cache = new ParsedPostCache(60_000, () => now);

    expect(cache.has('facebook', 'a')).toBe(false);
    cache.add('facebook', 'a');
    expect(cache.has('facebook', 'a')).toBe(true);

    now += 59_000;
    expect(cache.has('facebook', 'a')).toBe(true);
    now += 2_000;
    expect(cache.has('facebook', 'a')).toBe(false);
  });

  it('keeps sources apart', () => {
    const cache = new ParsedPostCache(60_000, () => 0);
    cache.add('facebook', 'a');
    expect(cache.has('telegram', 'a')).toBe(false);
  });
});
