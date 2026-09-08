import { describe, expect, it } from 'vitest';
import { isGeminiConfigured, redactPhones } from '../src/llm/gemini.js';
import { createFacebookAdapter } from '../src/sources/facebook/fbAdapter.js';
import { findCityByKey } from '../src/core/cities.js';
import type { SavedSearch } from '../src/core/types.js';

// No store behind it: every post would be read afresh.
const facebookAdapter = createFacebookAdapter({ find: () => undefined });

const search = {} as SavedSearch;

describe('phone redaction', () => {
  it('removes Israeli mobile numbers before text is sent to the model', () => {
    const { redacted, phones } = redactPhones('לפרטים נוספים דני 054-1111111 תודה');
    expect(redacted).toBe('לפרטים נוספים דני [טלפון] תודה');
    expect(phones).toEqual(['054-1111111']);
  });

  it('handles numbers written without a separator, and several at once', () => {
    const { redacted, phones } = redactPhones('משה 0542222222 או רונית 054-3333333');
    expect(phones).toEqual(['0542222222', '054-3333333']);
    expect(redacted).not.toMatch(/\d{7}/);
  });

  it('recognises the +972 form', () => {
    expect(redactPhones('call +972-54-1111111').phones).toHaveLength(1);
  });

  it('leaves prices and sizes alone', () => {
    // 5,500 and 55 must survive - they are the fields we actually want.
    const { redacted } = redactPhones('55 מ"ר 2 חדרים מחיר 5,500₪');
    expect(redacted).toBe('55 מ"ר 2 חדרים מחיר 5,500₪');
  });

  it('returns the text unchanged when there is no number', () => {
    expect(redactPhones('דירה יפה במודיעין').phones).toEqual([]);
  });
});

describe('facebook adapter activation', () => {
  it('stays switched off until a Gemini key is configured', () => {
    const modiin = findCityByKey('modiin')!;
    // The test environment has no key, so the source must opt out rather than
    // fail every cycle.
    expect(isGeminiConfigured()).toBe(false);
    expect(facebookAdapter.supports(search, modiin)).toBe(false);
  });

  it('stays switched off for a city with no groups configured', () => {
    const haifa = findCityByKey('haifa')!;
    expect(facebookAdapter.supports(search, haifa)).toBe(false);
  });

  it('reads groups far less often than the web sources', () => {
    // Reading groups is the riskiest thing the bot does; it must never run
    // every cycle, however short the poll interval becomes.
    expect(facebookAdapter.cadenceMinutes).toBeGreaterThanOrEqual(30);
  });
});
