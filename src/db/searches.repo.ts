import type { SavedSearch, SearchRequirements } from '../core/types.js';
import type { Db } from './database.js';

interface SearchRow {
  id: number;
  chat_id: number | null;
  city_keys: string | null;
  name: string;
  city_key: string;
  city_name: string;
  min_rooms: number | null;
  max_rooms: number | null;
  min_price: number | null;
  max_price: number | null;
  areas: string | null;
  requirements: string | null;
  active: number;
  created_at: string;
}

export interface NewSearch {
  chatId: number;
  name: string;
  /** One or more cities; the first is kept in city_key for older readers. */
  cityKeys: string[];
  cityName: string;
  minRooms: number | null;
  maxRooms: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  /** City key -> chosen streets and neighbourhoods. Absent means whole city. */
  areas?: Record<string, string[]>;
  requirements?: SearchRequirements;
}

export class SearchesRepo {
  constructor(private readonly db: Db) {}

  create(search: NewSearch): SavedSearch {
    const result = this.db
      .prepare(
        `INSERT INTO saved_searches
           (chat_id, name, city_key, city_keys, city_name, min_rooms, max_rooms, min_price, max_price, areas, requirements)
         VALUES (@chatId, @name, @cityKey, @cityKeys, @cityName, @minRooms, @maxRooms, @minPrice, @maxPrice, @areas, @requirements)`,
      )
      .run({
        ...search,
        cityKey: search.cityKeys[0],
        cityKeys: JSON.stringify(search.cityKeys),
        areas: serializeAreas(search.areas),
        requirements: serializeRequirements(search.requirements),
      });

    return this.getById(Number(result.lastInsertRowid))!;
  }

  /** Replaces the requirements; undefined or all-empty clears them. */
  setRequirements(id: number, requirements: SearchRequirements | undefined): SavedSearch | undefined {
    this.db
      .prepare('UPDATE saved_searches SET requirements = ? WHERE id = ?')
      .run(serializeRequirements(requirements), id);
    return this.getById(id);
  }

  getById(id: number): SavedSearch | undefined {
    const row = this.db.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id) as
      | SearchRow
      | undefined;
    return row ? toSearch(row) : undefined;
  }

  /** Every search, or only one chat's when a chat id is given. */
  list(chatId?: number): SavedSearch[] {
    const rows = (
      chatId === undefined
        ? this.db.prepare('SELECT * FROM saved_searches ORDER BY id').all()
        : this.db.prepare('SELECT * FROM saved_searches WHERE chat_id = ? ORDER BY id').all(chatId)
    ) as SearchRow[];
    return rows.map(toSearch);
  }

  listActive(): SavedSearch[] {
    return this.list().filter((s) => s.active);
  }

  /** True when this chat may see or change the search. */
  belongsTo(id: number, chatId: number): boolean {
    return this.getById(id)?.chatId === chatId;
  }

  setActive(id: number, active: boolean): void {
    this.db.prepare('UPDATE saved_searches SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
  }

  /**
   * An existing search of this chat with the same room and price bounds.
   *
   * The wizard offers to update this one's cities instead of saving a near
   * duplicate: "Modi'in, 3–4 rooms, up to 6,500" and "Modi'in and Rishon,
   * 3–4 rooms, up to 6,500" are almost always one intent typed twice, and
   * /add previously had no way to say so.
   */
  findByBounds(chatId: number, bounds: SearchBounds): SavedSearch | undefined {
    return this.list(chatId).find(
      (s) =>
        s.minRooms === bounds.minRooms &&
        s.maxRooms === bounds.maxRooms &&
        s.minPrice === bounds.minPrice &&
        s.maxPrice === bounds.maxPrice,
    );
  }

  /**
   * Replaces the room and price bounds, keeping everything else.
   *
   * Narrowing a search is nearly always a change of bounds, and until this
   * existed the wizard had no way to apply one: "update the existing search"
   * could only move its cities. So editing 2.5–4 rooms down to 3+ fell
   * through to creating a *second* search, and the original - with no street
   * filter - kept alerting on the whole city. Because seen-ness is keyed per
   * chat, the looser of the two claimed every listing first and the narrowed
   * one never got to reject anything.
   */
  setBounds(id: number, bounds: SearchBounds): SavedSearch | undefined {
    this.db
      .prepare(
        `UPDATE saved_searches
            SET min_rooms = @minRooms, max_rooms = @maxRooms,
                min_price = @minPrice, max_price = @maxPrice
          WHERE id = @id`,
      )
      .run({ ...bounds, id });

    return this.getById(id);
  }

  /**
   * Replaces the cities a search covers.
   *
   * The row keeps its id, so everything already recorded against it stays
   * valid and the listings this chat has been alerted about are untouched.
   */
  setCities(
    id: number,
    cityKeys: string[],
    cityName: string,
    name: string,
    areas?: Record<string, string[]>,
  ): SavedSearch | undefined {
    if (cityKeys.length === 0) return this.getById(id);

    // Areas are keyed by city, so dropping a city must drop its streets too -
    // otherwise an invisible filter for a city no longer searched lingers in
    // the row and reappears if that city is added back.
    const kept = areas
      ? Object.fromEntries(Object.entries(areas).filter(([key]) => cityKeys.includes(key)))
      : undefined;

    this.db
      .prepare(
        `UPDATE saved_searches
            SET city_key = ?, city_keys = ?, city_name = ?, name = ?, areas = ?
          WHERE id = ?`,
      )
      .run(cityKeys[0], JSON.stringify(cityKeys), cityName, name, serializeAreas(kept), id);

    return this.getById(id);
  }
}

/**
 * Reads requirements tolerantly, like areas: anything unreadable is treated
 * as "none", and empty lists are dropped so the field is absent, not `{}`.
 */
function parseRequirements(row: SearchRow): SearchRequirements | undefined {
  if (!row.requirements) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(row.requirements);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;

  const list = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const names = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
    return names.length > 0 ? names : undefined;
  };

  const requirements: SearchRequirements = {
    ...(list(source.amenities) ? { amenities: list(source.amenities) } : {}),
    ...(source.brokers === 'private-only' ? { brokers: 'private-only' as const } : {}),
    ...(typeof source.minSqm === 'number' && source.minSqm > 0 ? { minSqm: source.minSqm } : {}),
    ...(list(source.propertyTypes) ? { propertyTypes: list(source.propertyTypes) } : {}),
    ...(list(source.keywords) ? { keywords: list(source.keywords) } : {}),
  };
  return Object.keys(requirements).length > 0 ? requirements : undefined;
}

/** Stores nothing rather than "{}" when nothing is required. */
function serializeRequirements(requirements: SearchRequirements | undefined): string | null {
  if (!requirements) return null;
  const kept: SearchRequirements = {
    ...(requirements.amenities?.length ? { amenities: requirements.amenities } : {}),
    ...(requirements.brokers === 'private-only' ? { brokers: 'private-only' as const } : {}),
    ...(requirements.minSqm ? { minSqm: requirements.minSqm } : {}),
    ...(requirements.propertyTypes?.length ? { propertyTypes: requirements.propertyTypes } : {}),
    ...(requirements.keywords?.length ? { keywords: requirements.keywords } : {}),
  };
  return Object.keys(kept).length > 0 ? JSON.stringify(kept) : null;
}

/** Stores nothing rather than "{}" when no city is restricted. */
function serializeAreas(areas: Record<string, string[]> | undefined): string | null {
  if (!areas) return null;
  const filled = Object.entries(areas).filter(([, names]) => names.length > 0);
  return filled.length > 0 ? JSON.stringify(Object.fromEntries(filled)) : null;
}

/** The filters that make two searches "the same search, different places". */
export type SearchBounds = Pick<
  NewSearch,
  'minRooms' | 'maxRooms' | 'minPrice' | 'maxPrice'
>;

/**
 * Reads the per-city area lists, tolerating anything unexpected.
 *
 * Returns undefined when nothing is restricted, which every row written
 * before this column existed means. Empty lists are dropped so an "all
 * streets" city never looks like a filter that matches nothing.
 */
function parseAreas(row: SearchRow): Record<string, string[]> | undefined {
  if (!row.areas) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.areas);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;

  const areas: Record<string, string[]> = {};
  for (const [cityKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const names = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    if (names.length > 0) areas[cityKey] = names;
  }

  return Object.keys(areas).length > 0 ? areas : undefined;
}

/** Falls back to the single-city column for rows written before multi-city. */
function parseCityKeys(row: SearchRow): string[] {
  if (row.city_keys) {
    try {
      const parsed = JSON.parse(row.city_keys);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
    } catch {
      // fall through to the legacy column
    }
  }
  return [row.city_key];
}

function toSearch(row: SearchRow): SavedSearch {
  return {
    id: row.id,
    // Searches created before the bot supported more than one person have no
    // chat id; they belong to the owner, who is resolved at notification time.
    chatId: row.chat_id ?? 0,
    name: row.name,
    cityKeys: parseCityKeys(row),
    cityName: row.city_name,
    minRooms: row.min_rooms,
    maxRooms: row.max_rooms,
    minPrice: row.min_price,
    maxPrice: row.max_price,
    ...(parseAreas(row) ? { areas: parseAreas(row) } : {}),
    ...(parseRequirements(row) ? { requirements: parseRequirements(row) } : {}),
    active: row.active === 1,
    createdAt: row.created_at,
  };
}
