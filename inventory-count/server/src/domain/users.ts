import type { Db } from '../db/database.js';
import { audit } from '../db/database.js';
import { hashPin, newToken, sha256, verifyPin } from '../auth/password.js';
import { AppError } from './errors.js';

export type Role = 'counter' | 'manager';
export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
}

const SESSION_HOURS = 14;
const MAX_FAILS = 5;
const LOCK_MS = 5 * 60 * 1000;

interface Row {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  active: number;
  pin_hash: string;
}
const toUser = (r: Row): User => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  active: !!r.active,
});

export class UserService {
  private fails = new Map<string, { count: number; until: number }>();
  constructor(private db: Db) {}

  async ensureBootstrapAdmin(username: string, pin: string | undefined) {
    const n = (this.db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
    if (n > 0) return false;
    if (!pin || !/^\d{4,8}$/.test(pin)) {
      throw new Error('No users exist: set BOOTSTRAP_ADMIN_PIN (4-8 digits) to create the first manager');
    }
    await this.create(null, { username, displayName: 'מנהל מערכת', role: 'manager', pin });
    return true;
  }

  list(): User[] {
    return (this.db.prepare('SELECT * FROM users ORDER BY active DESC, display_name').all() as Row[]).map(toUser);
  }

  get(id: number): User {
    const r = this.db.prepare('SELECT * FROM users WHERE id=?').get(id) as Row | undefined;
    if (!r) throw new AppError('NOT_FOUND', 'המשתמש לא נמצא');
    return toUser(r);
  }

  async create(actor: number | null, input: { username: string; displayName: string; role: Role; pin: string }) {
    validatePin(input.pin);
    const username = input.username.trim();
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(username)) {
      throw new AppError('VALIDATION', 'שם משתמש: 2–32 תווים באנגלית, ספרות, נקודה, מקף או קו תחתון');
    }
    if (!input.displayName.trim()) throw new AppError('VALIDATION', 'חסר שם לתצוגה');
    const exists = this.db.prepare('SELECT 1 FROM users WHERE username=?').get(username);
    if (exists) throw new AppError('CONFLICT', 'שם המשתמש כבר קיים');
    const info = this.db
      .prepare('INSERT INTO users (username, display_name, role, pin_hash) VALUES (?,?,?,?)')
      .run(username, input.displayName.trim(), input.role, await hashPin(input.pin));
    const id = Number(info.lastInsertRowid);
    audit(this.db, actor, 'user.create', 'user', id, { username, role: input.role });
    return this.get(id);
  }

  async update(
    actor: number,
    id: number,
    input: { displayName?: string; role?: Role; active?: boolean; pin?: string },
  ) {
    const u = this.get(id);
    if (id === actor && (input.active === false || (input.role && input.role !== 'manager'))) {
      throw new AppError('VALIDATION', 'אי אפשר להשבית את המשתמש שלך או להוריד לו הרשאה');
    }
    if (input.pin !== undefined) validatePin(input.pin);
    this.db
      .prepare('UPDATE users SET display_name=?, role=?, active=?, pin_hash=COALESCE(?, pin_hash) WHERE id=?')
      .run(
        input.displayName?.trim() || u.displayName,
        input.role ?? u.role,
        input.active === undefined ? (u.active ? 1 : 0) : input.active ? 1 : 0,
        input.pin ? await hashPin(input.pin) : null,
        id,
      );
    if (input.active === false || input.pin) this.revokeSessions(id);
    audit(this.db, actor, 'user.update', 'user', id, { ...input, pin: input.pin ? '***' : undefined });
    return this.get(id);
  }

  private revokeSessions(userId: number) {
    this.db.prepare("UPDATE sessions SET expires_at='1970-01-01T00:00:00.000Z' WHERE user_id=?").run(userId);
  }

  async login(username: string, pin: string) {
    const key = username.trim().toLowerCase();
    const f = this.fails.get(key);
    if (f && f.count >= MAX_FAILS && Date.now() < f.until) {
      throw new AppError('RATE_LIMITED', 'יותר מדי ניסיונות כושלים. נסו שוב בעוד 5 דקות.');
    }
    const r = this.db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username.trim()) as
      | Row
      | undefined;
    const ok = r ? await verifyPin(pin, r.pin_hash) : false;
    if (!r || !ok) {
      const base = f && Date.now() < f.until ? f.count : 0;
      this.fails.set(key, { count: base + 1, until: Date.now() + LOCK_MS });
      throw new AppError('UNAUTHORIZED', 'שם משתמש או קוד שגויים');
    }
    this.fails.delete(key);
    const { token, hash } = newToken();
    const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(hash, r.id, expires);
    audit(this.db, r.id, 'auth.login', 'user', r.id);
    return { token, user: toUser(r), expires };
  }

  userForToken(token: string | undefined): User | null {
    if (!token) return null;
    const r = this.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
         WHERE s.token_hash=? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND u.active=1`,
      )
      .get(sha256(token)) as Row | undefined;
    return r ? toUser(r) : null;
  }

  logout(token: string | undefined) {
    if (!token) return;
    this.db.prepare("UPDATE sessions SET expires_at='1970-01-01T00:00:00.000Z' WHERE token_hash=?").run(sha256(token));
  }
}

function validatePin(pin: string) {
  if (!/^\d{4,8}$/.test(pin)) throw new AppError('VALIDATION', 'הקוד חייב להיות 4 עד 8 ספרות');
}
