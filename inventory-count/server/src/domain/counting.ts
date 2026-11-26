import type { Db } from '../db/database.js';
import { audit } from '../db/database.js';
import { AppError } from './errors.js';
import type { RoundService, RoundStatus } from './rounds.js';
import type { User } from './users.js';

export type ActionType = 'count' | 'recount' | 'correction';
export type Comparison = 'higher' | 'lower' | 'match';

/** Item as the counter sees it BEFORE saving: no SAP quantity (spec §7.2). */
export interface BlindItem {
  warehouse: string;
  itemCode: string;
  itemName: string;
  barcodes: string[];
  counted: boolean;
  recountRequested: boolean;
}

export interface CountResult {
  actionId: string;
  type: ActionType;
  warehouse: string;
  itemCode: string;
  itemName: string;
  qty: number;
  sapQty: number;
  totalCounted: number;
  totalRecounted: number;
  comparedQty: number;
  comparison: Comparison;
  createdAt: string;
  duplicate: boolean;
}

const MAX_QTY = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Ctx {
  roundId: number;
  status: RoundStatus;
  warehouse: string;
  zoneId: number | null;
}

export class CountingService {
  constructor(
    private db: Db,
    private rounds: RoundService,
  ) {}

  /** Resolves where this user counts. Counters must be assigned; managers may count any round warehouse. */
  context(user: User, roundId: number, warehouse?: string): Ctx {
    const round = this.rounds.get(roundId);
    if (user.role === 'counter') {
      const a = this.rounds.assignmentFor(user.id);
      if (!a || a.roundId !== roundId) throw new AppError('FORBIDDEN', 'לא שובצת לסבב הזה. פנה למנהל הספירה.');
      if (warehouse && warehouse !== a.warehouse) throw new AppError('FORBIDDEN', 'שובצת למחסן אחר');
      return { roundId, status: round.status, warehouse: a.warehouse, zoneId: a.zoneId };
    }
    const wh = warehouse ?? round.warehouses[0]!;
    if (!round.warehouses.includes(wh)) throw new AppError('VALIDATION', 'המחסן לא שייך לסבב');
    const a = this.rounds.assignmentFor(user.id);
    const zoneId = a && a.roundId === roundId && a.warehouse === wh ? a.zoneId : null;
    return { roundId, status: round.status, warehouse: wh, zoneId };
  }

  /** Exact match by barcode or item code (scanner path). */
  lookup(ctx: Ctx, code: string): BlindItem | null {
    const c = code.trim();
    if (!c) return null;
    const row = this.db
      .prepare(
        `SELECT s.* FROM snapshot_items s
         WHERE s.round_id=? AND s.warehouse=? AND (
           s.item_code = ? COLLATE NOCASE OR
           s.item_code IN (SELECT item_code FROM barcodes WHERE round_id=? AND barcode=?))
         LIMIT 1`,
      )
      .get(ctx.roundId, ctx.warehouse, c, ctx.roundId, c) as SnapRow | undefined;
    return row ? this.blind(ctx, row) : null;
  }

  /**
   * Free-text search by code or description. Empty query = the main list:
   * only items with positive SAP stock (spec §6), uncounted first.
   */
  search(ctx: Ctx, query: string, limit = 40): BlindItem[] {
    const q = query.trim();
    let rows: SnapRow[];
    if (!q) {
      rows = this.db
        .prepare(
          `SELECT s.* FROM snapshot_items s
           WHERE s.round_id=? AND s.warehouse=? AND s.sap_qty > 0
           ORDER BY EXISTS (SELECT 1 FROM count_actions c WHERE c.round_id=s.round_id AND c.warehouse=s.warehouse
                              AND c.item_code=s.item_code AND c.status='saved'),
                    s.item_name
           LIMIT ?`,
        )
        .all(ctx.roundId, ctx.warehouse, limit) as SnapRow[];
    } else {
      const like = `%${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`;
      rows = this.db
        .prepare(
          `SELECT s.* FROM snapshot_items s
           WHERE s.round_id=? AND s.warehouse=? AND (
             s.item_code LIKE ? ESCAPE '\\' OR s.item_name LIKE ? ESCAPE '\\' OR s.barcodes LIKE ? ESCAPE '\\')
           ORDER BY CASE WHEN s.item_code = ? COLLATE NOCASE THEN 0 WHEN s.item_code LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                    s.item_name
           LIMIT ?`,
        )
        .all(ctx.roundId, ctx.warehouse, like, like, like, q, `${q.replace(/[%_\\]/g, (m) => '\\' + m)}%`, limit) as SnapRow[];
    }
    return rows.map((r) => this.blind(ctx, r));
  }

  private blind(ctx: Ctx, r: SnapRow): BlindItem {
    const counted = !!this.db
      .prepare(
        "SELECT 1 FROM count_actions WHERE round_id=? AND warehouse=? AND item_code=? AND status='saved' AND type IN ('count','correction') LIMIT 1",
      )
      .get(ctx.roundId, r.warehouse, r.item_code);
    return {
      warehouse: r.warehouse,
      itemCode: r.item_code,
      itemName: r.item_name,
      barcodes: r.barcodes ? r.barcodes.split(' ') : [],
      counted,
      recountRequested: !!this.openRecount(ctx.roundId, r.warehouse, r.item_code),
    };
  }

  private openRecount(roundId: number, warehouse: string, itemCode: string) {
    return this.db
      .prepare(
        "SELECT id, assigned_to FROM recount_requests WHERE round_id=? AND warehouse=? AND item_code=? AND status='open' ORDER BY id DESC LIMIT 1",
      )
      .get(roundId, warehouse, itemCode) as { id: number; assigned_to: number | null } | undefined;
  }

  /**
   * Records one count action. Idempotent on `id` (generated on the device),
   * so double taps and network retries never create duplicates (spec §8.2).
   */
  record(
    user: User,
    roundId: number,
    input: { id: string; warehouse?: string; itemCode: string; qty: number; correction?: boolean; note?: string },
  ): CountResult {
    if (!UUID.test(input.id)) throw new AppError('VALIDATION', 'מזהה פעולה לא תקין');

    const existing = this.db.prepare('SELECT * FROM count_actions WHERE id=?').get(input.id) as ActionRow | undefined;
    if (existing) {
      if (existing.user_id !== user.id || existing.round_id !== roundId) {
        throw new AppError('CONFLICT', 'מזהה פעולה כבר בשימוש');
      }
      return this.result(existing, true);
    }

    const ctx = this.context(user, roundId, input.warehouse);
    const item = this.db
      .prepare('SELECT * FROM snapshot_items WHERE round_id=? AND warehouse=? AND item_code=?')
      .get(roundId, ctx.warehouse, input.itemCode) as SnapRow | undefined;
    if (!item) throw new AppError('NOT_FOUND', 'הפריט לא קיים ב-SAP במחסן הזה. אפשר לדווח עליו כפריט חריג.');

    const qty = Number(input.qty);
    if (!Number.isInteger(qty)) throw new AppError('VALIDATION', 'הכמות חייבת להיות מספר שלם (יחידות בודדות)');
    let type: ActionType;
    if (input.correction) {
      if (qty === 0 || Math.abs(qty) > MAX_QTY) throw new AppError('VALIDATION', 'תיקון חייב להיות כמות שונה מאפס');
      if (!input.note?.trim()) throw new AppError('VALIDATION', 'בתיקון חובה לכתוב סיבה');
      type = 'correction';
    } else {
      if (qty < 0 || qty > MAX_QTY) throw new AppError('VALIDATION', `הכמות חייבת להיות בין 0 ל-${MAX_QTY.toLocaleString()}`);
      type = 'count';
    }

    const recount = this.openRecount(roundId, ctx.warehouse, input.itemCode);
    if (recount && type === 'count') {
      if (recount.assigned_to && recount.assigned_to !== user.id && user.role !== 'manager') {
        throw new AppError('FORBIDDEN', 'הספירה החוזרת לפריט הזה שויכה לסופר אחר');
      }
      type = 'recount';
    }

    if (ctx.status === 'paused') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב מושהה כרגע. המתינו להודעת המנהל.');
    if (ctx.status === 'closed') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב סגור');
    if (ctx.status === 'review' && type !== 'recount') {
      throw new AppError('ROUND_NOT_ACTIVE', 'הסבב בבקרה. אפשר לספור רק פריטים שסומנו לספירה חוזרת.');
    }

    this.db
      .prepare(
        `INSERT INTO count_actions (id, round_id, warehouse, item_code, zone_id, user_id, qty, type, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(input.id, roundId, ctx.warehouse, input.itemCode, ctx.zoneId, user.id, qty, type, input.note?.trim() || null);
    const row = this.db.prepare('SELECT * FROM count_actions WHERE id=?').get(input.id) as ActionRow;
    return this.result(row, false);
  }

  private totals(roundId: number, warehouse: string, itemCode: string) {
    return this.db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN type IN ('count','correction') THEN qty END),0) AS counted,
                COALESCE(SUM(CASE WHEN type='recount' THEN qty END),0) AS recounted
         FROM count_actions WHERE round_id=? AND warehouse=? AND item_code=? AND status='saved'`,
      )
      .get(roundId, warehouse, itemCode) as { counted: number; recounted: number };
  }

  private result(a: ActionRow, duplicate: boolean): CountResult {
    const item = this.db
      .prepare('SELECT * FROM snapshot_items WHERE round_id=? AND warehouse=? AND item_code=?')
      .get(a.round_id, a.warehouse, a.item_code) as SnapRow;
    const t = this.totals(a.round_id, a.warehouse, a.item_code);
    const compared = a.type === 'recount' ? t.recounted : t.counted;
    return {
      actionId: a.id,
      type: a.type,
      warehouse: a.warehouse,
      itemCode: a.item_code,
      itemName: item.item_name,
      qty: a.qty,
      sapQty: item.sap_qty,
      totalCounted: t.counted,
      totalRecounted: t.recounted,
      comparedQty: compared,
      comparison: compare(compared, item.sap_qty),
      createdAt: a.created_at,
      duplicate,
    };
  }

  /** The counter's own recent actions (spec scenario D: survives logout). */
  myActions(user: User, roundId: number, limit = 100) {
    return this.db
      .prepare(
        `SELECT c.id, c.warehouse, c.item_code AS itemCode, s.item_name AS itemName, c.qty, c.type, c.status,
                c.note, c.cancel_reason AS cancelReason, c.created_at AS createdAt
         FROM count_actions c JOIN snapshot_items s
           ON s.round_id=c.round_id AND s.warehouse=c.warehouse AND s.item_code=c.item_code
         WHERE c.round_id=? AND c.user_id=? ORDER BY c.created_at DESC LIMIT ?`,
      )
      .all(roundId, user.id, limit);
  }

  myStats(user: User, roundId: number) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS actions, COUNT(DISTINCT warehouse || '|' || item_code) AS items,
                COALESCE(SUM(CASE WHEN type<>'correction' THEN qty END),0) AS units
         FROM count_actions WHERE round_id=? AND user_id=? AND status='saved'`,
      )
      .get(roundId, user.id) as { actions: number; items: number; units: number };
  }

  /** Cancels by status change: history is never deleted (spec §8.2). */
  cancel(user: User, actionId: string, reason: string) {
    const a = this.db.prepare('SELECT * FROM count_actions WHERE id=?').get(actionId) as ActionRow | undefined;
    if (!a) throw new AppError('NOT_FOUND', 'הפעולה לא נמצאה');
    if (user.role !== 'manager' && a.user_id !== user.id) throw new AppError('FORBIDDEN', 'אפשר לבטל רק פעולות שלך');
    if (a.status === 'cancelled') throw new AppError('CONFLICT', 'הפעולה כבר בוטלה');
    const round = this.rounds.get(a.round_id);
    if (round.status === 'closed' || (round.status !== 'open' && user.role !== 'manager')) {
      throw new AppError('ROUND_NOT_ACTIVE', 'אי אפשר לבטל פעולות בסבב במצב הנוכחי');
    }
    if (!reason.trim()) throw new AppError('VALIDATION', 'חובה לכתוב סיבת ביטול');
    this.db
      .prepare(
        "UPDATE count_actions SET status='cancelled', cancel_reason=?, cancelled_by=?, cancelled_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      )
      .run(reason.trim(), user.id, actionId);
    audit(this.db, user.id, 'count.cancel', 'count_action', actionId, { reason, qty: a.qty, item: a.item_code });
    return { ok: true };
  }

  /** Item found physically but missing in SAP (spec §9). Idempotent on id. */
  reportException(
    user: User,
    roundId: number,
    input: { id: string; warehouse?: string; code?: string; barcode?: string; description: string; qty: number; notes?: string },
  ) {
    if (!UUID.test(input.id)) throw new AppError('VALIDATION', 'מזהה פעולה לא תקין');
    const existing = this.db.prepare('SELECT id, user_id FROM exception_items WHERE id=?').get(input.id) as
      | { id: string; user_id: number }
      | undefined;
    if (existing) {
      if (existing.user_id !== user.id) throw new AppError('CONFLICT', 'מזהה פעולה כבר בשימוש');
      return { id: existing.id, duplicate: true };
    }
    const ctx = this.context(user, roundId, input.warehouse);
    if (ctx.status !== 'open') throw new AppError('ROUND_NOT_ACTIVE', 'אפשר לדווח פריט חריג רק בסבב פתוח');
    if (!input.description?.trim()) throw new AppError('VALIDATION', 'חובה לתאר את הפריט');
    const qty = Number(input.qty);
    if (!Number.isInteger(qty) || qty <= 0 || qty > MAX_QTY) throw new AppError('VALIDATION', 'כמות לא תקינה');
    this.db
      .prepare(
        `INSERT INTO exception_items (id, round_id, warehouse, zone_id, user_id, code, barcode, description, qty, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.id,
        roundId,
        ctx.warehouse,
        ctx.zoneId,
        user.id,
        input.code?.trim() || null,
        input.barcode?.trim() || null,
        input.description.trim(),
        qty,
        input.notes?.trim() || null,
      );
    return { id: input.id, duplicate: false };
  }
}

export function compare(counted: number, sap: number): Comparison {
  return counted > sap ? 'higher' : counted < sap ? 'lower' : 'match';
}

interface SnapRow {
  round_id: number;
  warehouse: string;
  item_code: string;
  item_name: string;
  barcodes: string;
  sap_qty: number;
}

interface ActionRow {
  id: string;
  round_id: number;
  warehouse: string;
  item_code: string;
  zone_id: number | null;
  user_id: number;
  qty: number;
  type: ActionType;
  status: 'saved' | 'cancelled';
  note: string | null;
  created_at: string;
}
