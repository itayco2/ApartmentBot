import { z } from 'zod';

/**
 * Field shapes shared by every model-output schema.
 *
 * Missing and null must mean the same thing: the model omits a key it has
 * nothing to say about, and a strict schema once rejected a whole page over
 * one absent id. An impossible number likewise means "unknown", not "reject"
 * - a single `rooms: 0` once discarded every listing on a page.
 */
export const nullableString = z.string().nullish().transform((v) => v ?? null);

export const positiveOrNull = z
  .number()
  .nullish()
  .transform((v) => (v && v > 0 ? v : null));

export const positiveIntOrNull = z
  .number()
  .nullish()
  .transform((v) => (v && v > 0 ? Math.round(v) : null));

export const stringList = z
  .array(z.string())
  .nullish()
  .transform((v) => v ?? []);

export const nullableBoolean = z
  .boolean()
  .nullish()
  .transform((v) => v ?? null);
