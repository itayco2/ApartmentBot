import { describe, expect, it } from 'vitest';
import { CURATED_CITIES, mentionsCity, mergeCities, searchCities } from '../src/core/cities.js';
import type { CityEntry } from '../src/core/types.js';

describe('finding a city by typing', () => {
  it('puts an exact name ahead of everything else', () => {
    expect(searchCities('חולון')[0]?.key).toBe('holon');
  });

  it('ranks a prefix match above a match in the middle of a name', () => {
    // "גן" is inside רמת גן, but no city starts with it; "רמת" starts one.
    expect(searchCities('רמת')[0]?.key).toBe('ramat-gan');
  });

  it('resolves the short everyday name of a curated city', () => {
    expect(searchCities('מודיעין')[0]?.key).toBe('modiin');
  });
});

describe('spotting a city in a sentence', () => {
  it('finds a city written with a Hebrew prefix letter', () => {
    expect(mentionsCity('3 חדרים במודיעין עד 6500')).toBe(true);
    expect(mentionsCity('מחפש ברמת גן, 3 חדרים')).toBe(true);
    expect(mentionsCity('ולרמת גן')).toBe(true);
  });

  it('finds a city named on its own', () => {
    expect(mentionsCity('רמת גן')).toBe(true);
  });

  it('ignores ordinary words and chatter', () => {
    for (const text of ['לא', 'כן', 'תודה רבה', 'היי מה קורה', '']) {
      expect(mentionsCity(text), text).toBe(false);
    }
  });

  it('does not accept a longer word that merely ends in a city name', () => {
    // Only ב/ל/מ/ה/ש/כ, optionally after ו, may stand in front of a name.
    expect(mentionsCity('שלומודיעין')).toBe(false);
  });

  it('keeps the curated list intact', () => {
    expect(CURATED_CITIES).toHaveLength(17);
  });
});

describe('merging generated and curated cities', () => {
  const curated: CityEntry[] = [
    { key: 'tel-aviv', name: 'תל אביב יפו', aliases: ['תל אביב'], realtaSlug: 'tel-aviv-yafo', yad2CityCode: 5000, yad2RegionCode: 3 },
  ];
  const generated: CityEntry[] = [
    { key: 'tel-aviv-yafo', name: 'תל אביב יפו', aliases: ['תל אביב - יפו'], yad2CityCode: 5000, yad2RegionCode: 3 },
    { key: 'kefar-yona', name: 'כפר יונה', aliases: [], yad2CityCode: 168, yad2RegionCode: 1 },
    { key: 'ashdod', name: 'אשדוד', aliases: ['תל אביב'], yad2CityCode: 70, yad2RegionCode: 2 },
  ];
  const merged = mergeCities(generated, curated);

  it('lets a curated entry win for its city, keeping its key and slugs', () => {
    expect(merged[0]).toMatchObject({ key: 'tel-aviv', realtaSlug: 'tel-aviv-yafo', yad2CityCode: 5000 });
    expect(merged.filter((c) => c.yad2CityCode === 5000)).toHaveLength(1);
  });

  it('lists curated cities first, then the rest alphabetically', () => {
    expect(merged.map((c) => c.key)).toEqual(['tel-aviv', 'ashdod', 'kefar-yona']);
  });

  it('gives each spelling to one city only', () => {
    // "תל אביב" belongs to the curated Tel Aviv; Ashdod must not answer to it.
    expect(merged.find((c) => c.key === 'ashdod')?.aliases).toEqual([]);
  });

  it('renames a generated key a curated city already uses', () => {
    const clash = mergeCities(
      [{ key: 'tel-aviv', name: 'מקום אחר', aliases: [], yad2CityCode: 9, yad2RegionCode: 1 }],
      curated,
    );
    expect(clash.map((c) => c.key)).toEqual(['tel-aviv', 'tel-aviv-9']);
  });
});
