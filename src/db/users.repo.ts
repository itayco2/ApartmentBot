import { randomBytes } from 'node:crypto';
import type { Db } from './database.js';

export interface BotUser {
  chatId: number;
  name: string | null;
  isOwner: boolean;
  joinedAt: string;
}

/**
 * Who is allowed to use the bot.
 *
 * The owner is whoever set it up; everyone else joins by opening a one-time
 * invite link. Anyone not in this table is ignored without a reply, so the bot
 * never advertises itself to strangers who guess its name.
 */
export class UsersRepo {
  constructor(private readonly db: Db) {}

  isAllowed(chatId: number): boolean {
    return this.db.prepare('SELECT 1 FROM users WHERE chat_id = ?').get(chatId) !== undefined;
  }

  get(chatId: number): BotUser | undefined {
    const row = this.db.prepare('SELECT * FROM users WHERE chat_id = ?').get(chatId) as
      | { chat_id: number; name: string | null; is_owner: number; joined_at: string }
      | undefined;
    return row
      ? { chatId: row.chat_id, name: row.name, isOwner: row.is_owner === 1, joinedAt: row.joined_at }
      : undefined;
  }

  add(chatId: number, name: string | null, isOwner = false): void {
    this.db
      .prepare(
        `INSERT INTO users (chat_id, name, is_owner) VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET name = COALESCE(excluded.name, users.name)`,
      )
      .run(chatId, name, isOwner ? 1 : 0);
  }

  remove(chatId: number): void {
    this.db.prepare('DELETE FROM users WHERE chat_id = ? AND is_owner = 0').run(chatId);
  }

  list(): BotUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY joined_at').all() as Array<{
      chat_id: number;
      name: string | null;
      is_owner: number;
      joined_at: string;
    }>;
    return rows.map((r) => ({
      chatId: r.chat_id,
      name: r.name,
      isOwner: r.is_owner === 1,
      joinedAt: r.joined_at,
    }));
  }

  owner(): BotUser | undefined {
    return this.list().find((u) => u.isOwner);
  }

  /** Creates a single-use code for a Telegram deep link. */
  createInvite(): string {
    // Telegram deep-link payloads allow only these characters.
    const code = randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    this.db.prepare('INSERT INTO invites (code) VALUES (?)').run(code);
    return code;
  }

  /** Consumes a code, returning false if it is unknown or already used. */
  redeemInvite(code: string, chatId: number, name: string | null): boolean {
    const row = this.db.prepare('SELECT used_by FROM invites WHERE code = ?').get(code) as
      | { used_by: number | null }
      | undefined;
    if (!row || row.used_by !== null) return false;

    this.db.transaction(() => {
      this.db
        .prepare("UPDATE invites SET used_by = ?, used_at = datetime('now') WHERE code = ?")
        .run(chatId, code);
      this.add(chatId, name);
    })();
    return true;
  }

  pendingInvites(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM invites WHERE used_by IS NULL').get() as {
      n: number;
    };
    return row.n;
  }
}
