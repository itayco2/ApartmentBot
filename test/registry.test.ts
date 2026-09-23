import { describe, expect, it } from 'vitest';
import {
  CITIES,
  CURATED_CITIES,
  findCityByKey,
  listingCityMatches,
  mentionsCity,
  normalizeCityName,
  searchCities,
} from '../src/core/cities.js';
import { GENERATED_CITIES } from '../src/core/cities.generated.js';

describe('the city registry', () => {
  it('covers the country, not a handful of cities', () => {
    expect(CITIES.length).toBeGreaterThan(200);
  });

  it('reproduced the Yad2 codes of every hand-verified city', () => {
    // The curated pairs were read from Yad2 by hand and have been live for weeks. A
    // generator that disagrees with any of them is wrong about the rest too.
    for (const curated of CURATED_CITIES) {
      const generated = GENERATED_CITIES.find((g) => g.yad2CityCode === curated.yad2CityCode);
      expect(generated?.yad2RegionCode, curated.key).toBe(curated.yad2RegionCode);
    }
  });

  it('has unique keys that are safe in callback data', () => {
    const keys = CITIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toMatch(/^[a-z0-9-]+$/);
      // Telegram limits callback data to 64 bytes, and the wizard sends add:city:<key>.
      expect(Buffer.byteLength(`add:city:${key}`)).toBeLessThanOrEqual(64);
    }
  });

  it('has one entry per Yad2 city', () => {
    const codes = CITIES.map((c) => c.yad2CityCode).filter((c) => c !== undefined);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('keeps every curated key with its codes, because saved searches store the key', () => {
    for (const curated of CURATED_CITIES) {
      const city = findCityByKey(curated.key);
      expect(city?.yad2CityCode, curated.key).toBe(curated.yad2CityCode);
      expect(city?.yad2RegionCode, curated.key).toBe(curated.yad2RegionCode);
    }
  });

  it('gives every spelling to exactly one city', () => {
    const owners = new Map<string, string>();
    for (const city of CITIES) {
      for (const spelling of [city.name, ...city.aliases].map(normalizeCityName)) {
        const owner = owners.get(spelling);
        expect(owner === undefined || owner === city.key, `${spelling}: ${owner} and ${city.key}`).toBe(true);
        owners.set(spelling, city.key);
      }
    }
  });

  it('finds a small town by typing its name', () => {
    expect(searchCities('כפר יונה')[0]?.yad2CityCode).toBe(168);
    expect(mentionsCity('דירה בכפר יונה')).toBe(true);
  });

  it('still ranks the familiar city first for a prefix many towns share', () => {
    expect(searchCities('רמת')[0]?.key).toBe('ramat-gan');
  });

  it("keeps Modi'in Illit a different town from Modi'in", () => {
    expect(searchCities('מודיעין עילית')[0]?.key).not.toBe('modiin');
    expect(listingCityMatches(findCityByKey('modiin')!, 'מודיעין עילית')).toBe(false);
  });
});
