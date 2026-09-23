import { describe, expect, it } from 'vitest';
import { POPULAR_CITY_KEYS, cityKeyboard, offeredCityKeys } from '../src/bot/addWizard.js';
import { findCityByKey } from '../src/core/cities.js';

describe('the /add city picker', () => {
  it('opens on the familiar cities when nothing is chosen yet', () => {
    expect(offeredCityKeys([], [], [])).toEqual(POPULAR_CITY_KEYS);
  });

  it("leads with the chosen cities and the chat's own, without repeats", () => {
    const offered = offeredCityKeys(['kfar-saba'], [], ['kfar-saba', 'modiin']);
    expect(offered.slice(0, 2)).toEqual(['kfar-saba', 'modiin']);
    expect(new Set(offered).size).toBe(offered.length);
    expect(offered).toHaveLength(9);
  });

  it('always shows what was chosen and typed, even past the usual limit', () => {
    const chosen = POPULAR_CITY_KEYS.slice(0, 8);
    const typed = ['kfar-saba', 'raanana', 'shoham'];
    expect(offeredCityKeys(chosen, typed, [])).toEqual([...chosen, ...typed]);
  });

  it('ticks the chosen cities and counts them on the continue button', () => {
    const buttons = cityKeyboard(['modiin', 'rishon'], ['rishon']).inline_keyboard.flat();
    expect(buttons[0]).toMatchObject({ text: findCityByKey('modiin')!.name, callback_data: 'add:city:modiin' });
    expect(buttons[1]).toMatchObject({
      text: `✅ ${findCityByKey('rishon')!.name}`,
      callback_data: 'add:city:rishon',
    });
    expect(buttons.at(-2)).toMatchObject({ text: 'המשך (1) ➡️', callback_data: 'add:cities-done' });
  });

  it('leaves out a key that is not a city', () => {
    // toMatchObject rather than reading .callback_data: grammy's button type is a union,
    // and not every member has that field.
    const buttons = cityKeyboard(['nowhere', 'modiin'], []).inline_keyboard.flat();
    expect(buttons[0]).toMatchObject({ callback_data: 'add:city:modiin' });
  });

  it('offers only real cities as popular', () => {
    for (const key of POPULAR_CITY_KEYS) expect(findCityByKey(key), key).toBeDefined();
  });
});
