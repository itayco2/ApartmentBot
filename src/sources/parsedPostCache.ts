/**
 * Remembers which posts the model has already judged, for a while.
 *
 * A post judged "not a rental" never reaches the database, so without this it
 * would be sent to the model again on every fetch - and group feeds show the
 * same recent posts for days. In-memory on purpose: a restart re-parsing a
 * few dozen posts once is cheap; a table that must be pruned is not.
 */
export class ParsedPostCache {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  has(source: string, id: string): boolean {
    const expiresAt = this.seen.get(key(source, id));
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.now()) {
      this.seen.delete(key(source, id));
      return false;
    }
    return true;
  }

  add(source: string, id: string): void {
    this.seen.set(key(source, id), this.now() + this.ttlMs);
  }
}

function key(source: string, id: string): string {
  return `${source}:${id}`;
}
