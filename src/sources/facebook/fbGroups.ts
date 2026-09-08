import type { CityEntry } from '../../core/types.js';

/**
 * Facebook groups to read, per city key.
 *
 * These are groups the owner is already a member of - the bot cannot see a
 * private group otherwise, and joining one is a human decision. Values are the
 * slug or numeric id from the group URL:
 * facebook.com/groups/<slug-or-id>/
 *
 * More groups cost little: only posts nobody has judged yet reach the model,
 * so a group that repeats the same twenty posts for a week costs one call.
 */
export const FACEBOOK_GROUPS: Record<string, string[]> = {
  modiin: [
    'apartmentsmodiin', // דירות להשכרה ומכירה במודיעין ללא תיווך
    'modeiin.housing', // דירות להשכרה ומכירה במודיעין
    'diramodiin', // דירות להשכרה במודיעין
    'nadlan.modiin', // נדל"ן מודיעין
  ],
  // Rishon LeZion groups go here once the owner has joined them - the big city
  // groups, the "ללא תיווך" ones, and any neighbourhood group. Until then the
  // source simply does not run for Rishon.
  rishon: [],
};

export function groupsForCity(city: CityEntry): string[] {
  return FACEBOOK_GROUPS[city.key] ?? [];
}
