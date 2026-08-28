import { logger } from '../logger.js';
import { fetchText } from '../util/http.js';
import { normalizePlace } from './cities.js';

const AUTOCOMPLETE = 'https://gw.yad2.co.il/address-autocomplete/realestate/v2';

/** A street or neighbourhood offered to the owner as a button. */
export interface PlaceSuggestion {
  /** Bare name, as it will be stored and matched - no city suffix. */
  name: string;
  kind: 'street' | 'hood';
}

/**
 * Looks a place up in Yad2's address index.
 *
 * Typed free text is the only workable way to choose from several hundred
 * streets, but typing is also where Hebrew names get mistyped. Resolving the
 * text against a real index and offering the matches as buttons keeps the
 * convenience of typing without the typos.
 *
 * Returns an empty list when nothing matches or the lookup fails; the caller
 * offers to use the raw text instead, so a lookup failure never blocks the
 * wizard.
 */
export async function lookupPlaces(text: string, cityName: string): Promise<PlaceSuggestion[]> {
  const query = text.trim();
  if (query.length < 2) return [];

  let payload: unknown;
  try {
    const body = await fetchText(`${AUTOCOMPLETE}?text=${encodeURIComponent(`${query} ${cityName}`)}`, {
      source: 'yad2',
      profile: 'desktop',
      timeoutMs: 10_000,
      retries: 1,
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://www.yad2.co.il',
        Referer: 'https://www.yad2.co.il/',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
      },
    });
    payload = JSON.parse(body);
  } catch (error) {
    logger.warn({ err: error, query }, 'address lookup failed');
    return [];
  }

  // Yad2 answers with entries from other cities when a name is ambiguous
  // ("בוכמן" returns a street in Jerusalem), so anything outside the city
  // being edited is dropped rather than shown as a plausible-looking option.
  // Declared before titlesOf runs, which reads it.
  const city = normalizePlace(cityName);

  const source = payload as { hoods?: unknown; streets?: unknown };
  const suggestions: PlaceSuggestion[] = [
    ...titlesOf(source.hoods).map((name) => ({ name, kind: 'hood' as const })),
    ...titlesOf(source.streets).map((name) => ({ name, kind: 'street' as const })),
  ];

  const seen = new Set<string>();
  return suggestions
    .filter((s) => {
      const key = normalizePlace(s.name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);

  function titlesOf(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const names: string[] = [];
    for (const entry of raw) {
      const title = (entry as { fullTitleText?: unknown })?.fullTitleText;
      if (typeof title !== 'string') continue;

      // "רוטשילד, ראשון לציון" - the name is everything before the city.
      const parts = title.split(',').map((p) => p.trim());
      const last = parts.at(-1) ?? '';
      if (normalizePlace(last) !== city) continue;

      const name = parts.slice(0, -1).join(', ').trim();
      if (name) names.push(name);
    }
    return names;
  }
}
