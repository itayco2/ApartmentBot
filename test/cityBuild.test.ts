import { describe, expect, it } from 'vitest';
import {
  buildGeneratedEntries,
  cityKeyFor,
  parseGovLocalities,
  pickYad2City,
  renderGeneratedModule,
  type GovLocality,
} from '../src/core/cityBuild.js';

const locality = (code: number, name: string, englishName = ''): GovLocality => ({ code, name, englishName });

describe('reading the data.gov.il locality list', () => {
  it('trims names and codes and drops rows without them', () => {
    const rows = parseGovLocalities([
      { סמל_ישוב: ' 168 ', שם_ישוב: 'כפר יונה ', שם_ישוב_לועזי: 'KEFAR YONA ' },
      { סמל_ישוב: '0', שם_ישוב: 'לא רשום', שם_ישוב_לועזי: '' },
      { סמל_ישוב: '5000', שם_ישוב: '   ', שם_ישוב_לועזי: 'X' },
      { nothing: true },
    ]);
    expect(rows).toEqual([{ code: 168, name: 'כפר יונה', englishName: 'KEFAR YONA' }]);
  });
});

describe('matching a locality to Yad2', () => {
  const response = {
    cities: [
      { fullTitleText: 'כפר יונה', cityId: '168', regionId: '1' },
      { fullTitleText: 'כפר יונה ב', cityId: '9999', regionId: '1' },
    ],
  };

  it('prefers the entry whose Yad2 id is the official locality code', () => {
    expect(pickYad2City(locality(168, 'כפר יונה'), response)).toEqual({
      cityId: 168,
      regionId: 1,
      title: 'כפר יונה',
    });
  });

  it('falls back to the name when the code does not appear', () => {
    const answer = { cities: [{ fullTitleText: 'תל אביב יפו', cityId: '5000', regionId: '3' }] };
    expect(pickYad2City(locality(1, 'תל אביב - יפו'), answer)?.cityId).toBe(5000);
  });

  it('returns nothing when Yad2 does not know the place as a city', () => {
    expect(pickYad2City(locality(3777, 'סנסנה'), { cities: [] })).toBeUndefined();
    expect(pickYad2City(locality(3777, 'סנסנה'), { hoods: [] })).toBeUndefined();
    expect(pickYad2City(locality(3777, 'סנסנה'), null)).toBeUndefined();
  });
});

describe('city keys', () => {
  it('slugs the official English name', () => {
    expect(cityKeyFor(locality(168, 'כפר יונה', 'KEFAR YONA'))).toBe('kefar-yona');
    expect(cityKeyFor(locality(1, 'x', "MODI'IN ILLIT"))).toBe('modi-in-illit');
    expect(cityKeyFor(locality(1, 'x', ' TEL AVIV - YAFO '))).toBe('tel-aviv-yafo');
  });

  it('falls back to the code when there is no English name', () => {
    expect(cityKeyFor(locality(3777, 'סנסנה', ''))).toBe('city-3777');
  });
});

describe('building registry entries', () => {
  it('sorts by code, names each city as Yad2 does, and keeps a genuinely different official spelling as an alias', () => {
    // "תל אביב - יפו" and "תל אביב יפו" normalize to the same string, so no alias is needed;
    // "נוף הגליל" is a different string from Yad2's title, so it is kept.
    const entries = buildGeneratedEntries([
      { locality: locality(5000, 'תל אביב - יפו', 'TEL AVIV - YAFO'), match: { cityId: 5000, regionId: 3, title: 'תל אביב יפו' } },
      { locality: locality(1061, 'נוף הגליל', 'NOF HAGALIL'), match: { cityId: 1061, regionId: 5, title: 'נוף הגליל (נצרת עילית)' } },
    ]);
    expect(entries).toEqual([
      { key: 'nof-hagalil', name: 'נוף הגליל (נצרת עילית)', aliases: ['נוף הגליל'], yad2CityCode: 1061, yad2RegionCode: 5 },
      { key: 'tel-aviv-yafo', name: 'תל אביב יפו', aliases: [], yad2CityCode: 5000, yad2RegionCode: 3 },
    ]);
  });

  it('appends the code when two places share a key', () => {
    const entries = buildGeneratedEntries([
      { locality: locality(10, 'א', 'SAME'), match: { cityId: 10, regionId: 1, title: 'א' } },
      { locality: locality(20, 'ב', 'SAME'), match: { cityId: 20, regionId: 1, title: 'ב' } },
    ]);
    expect(entries.map((e) => e.key)).toEqual(['same', 'same-20']);
  });

  it('keeps one entry when two rows resolve to the same Yad2 city', () => {
    const entries = buildGeneratedEntries([
      { locality: locality(10, 'א', 'ONE'), match: { cityId: 10, regionId: 1, title: 'א' } },
      { locality: locality(11, 'א2', 'TWO'), match: { cityId: 10, regionId: 1, title: 'א' } },
    ]);
    expect(entries).toHaveLength(1);
  });

  it('keeps the key a city was published with, even if its English name changed', () => {
    // Saved searches store the key: a renamed key would leave them pointing at nothing.
    const entries = buildGeneratedEntries(
      [{ locality: locality(168, 'כפר יונה', 'KFAR YONA'), match: { cityId: 168, regionId: 1, title: 'כפר יונה' } }],
      new Map([[168, 'kefar-yona']]),
    );
    expect(entries[0]?.key).toBe('kefar-yona');
  });

  it('never gives a new place a key another city already has', () => {
    // Otherwise existing searches would quietly start watching a different town.
    const entries = buildGeneratedEntries(
      [
        { locality: locality(5, 'חדש', 'KEFAR YONA'), match: { cityId: 5, regionId: 1, title: 'חדש' } },
        { locality: locality(168, 'כפר יונה', 'KEFAR YONA'), match: { cityId: 168, regionId: 1, title: 'כפר יונה' } },
      ],
      new Map([[168, 'kefar-yona']]),
    );
    expect(entries.map((e) => [e.yad2CityCode, e.key])).toEqual([
      [5, 'kefar-yona-5'],
      [168, 'kefar-yona'],
    ]);
  });

  it('keeps one entry when two Yad2 cities carry the same name', () => {
    const entries = buildGeneratedEntries([
      { locality: locality(10, 'שם', 'ONE'), match: { cityId: 10, regionId: 1, title: 'שם' } },
      { locality: locality(20, 'שם', 'TWO'), match: { cityId: 20, regionId: 1, title: 'שם' } },
    ]);
    expect(entries.map((e) => e.yad2CityCode)).toEqual([10]);
  });
});

describe('rendering the generated module', () => {
  it('writes one typed entry per line with a do-not-edit header', () => {
    const text = renderGeneratedModule(
      [{ key: 'kefar-yona', name: 'כפר יונה', aliases: [], yad2CityCode: 168, yad2RegionCode: 1 }],
      '2026-09-23',
    );
    expect(text).toContain('Do not edit by hand');
    expect(text).toContain("import type { CityEntry } from './types.js';");
    expect(text).toContain(
      '  { key: "kefar-yona", name: "כפר יונה", aliases: [], yad2CityCode: 168, yad2RegionCode: 1 },',
    );
    expect(text.endsWith('];\n')).toBe(true);
  });
});
