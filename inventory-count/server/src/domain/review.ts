import type { Db } from '../db/database.js';
import { audit } from '../db/database.js';
import { AppError } from './errors.js';
import { compare, type Comparison } from './counting.js';
import type { RoundService } from './rounds.js';
import type { User } from './users.js';

export type ItemState = 'not_counted' | 'counted' | 'recount' | 'approved';

export interface ItemRow {
  warehouse: string;
  itemCode: string;
  itemName: string;
  sapQty: number;
  counted: number | null;
  recounted: number | null;
  approvedQty: number | null;
  finalQty: number | null;
  diff: number | null;
  comparison: Comparison | null;
  state: ItemState;
  actions: number;
  counters: number;
  zones: number;
  zoneNames: string;
  lastAt: string | null;
  openRecount: boolean;
}

export type ItemFilter = 'all' | 'diff' | 'not_counted' | 'zero_found' | 'multi_zone' | 'recount' | 'approved';

export class ReviewService {
  constructor(
    private db: Db,
    private rounds: RoundService,
  ) {}

  items(roundId: number, opts: { filter?: ItemFilter; warehouse?: string; q?: string } = {}): ItemRow[] {
    this.rounds.get(roundId);
    const rows = this.db
      .prepare(
        `WITH agg AS (
           SELECT c.warehouse, c.item_code,
             SUM(CASE WHEN c.type IN ('count','correction') THEN c.qty END) AS counted,
             SUM(CASE WHEN c.type='recount' THEN c.qty END) AS recounted,
             COUNT(*) AS actions,
             COUNT(DISTINCT c.user_id) AS counters,
             COUNT(DISTINCT c.zone_id) AS zones,
             GROUP_CONCAT(DISTINCT z.name) AS zone_names,
             MAX(c.created_at) AS last_at
           FROM count_actions c LEFT JOIN zones z ON z.id=c.zone_id
           WHERE c.round_id=? AND c.status='saved'
           GROUP BY c.warehouse, c.item_code)
         SELECT s.warehouse, s.item_code, s.item_name, s.sap_qty,
                agg.counted, agg.recounted, COALESCE(agg.actions,0) AS actions, COALESCE(agg.counters,0) AS counters,
                COALESCE(agg.zones,0) AS zones, COALESCE(agg.zone_names,'') AS zone_names, agg.last_at,
                ap.approved_qty,
                EXISTS (SELECT 1 FROM recount_requests r WHERE r.round_id=s.round_id AND r.warehouse=s.warehouse
                          AND r.item_code=s.item_code AND r.status='open') AS open_recount
         FROM snapshot_items s
         LEFT JOIN agg ON agg.warehouse=s.warehouse AND agg.item_code=s.item_code
         LEFT JOIN approvals ap ON ap.round_id=s.round_id AND ap.warehouse=s.warehouse AND ap.item_code=s.item_code
         WHERE s.round_id=? ${opts.warehouse ? 'AND s.warehouse=?' : ''}
         ORDER BY s.warehouse, s.item_name`,
      )
      .all(...[roundId, roundId, ...(opts.warehouse ? [opts.warehouse] : [])]) as Raw[];

    let items = rows
      .filter((r) => r.sap_qty !== 0 || r.counted !== null || r.recounted !== null || r.approved_qty !== null)
      .map(toItem);
    const q = opts.q?.trim().toLowerCase();
    if (q) items = items.filter((i) => i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q));
    switch (opts.filter ?? 'all') {
      case 'diff':
        return items.filter((i) => i.diff !== null && i.diff !== 0);
      case 'not_counted':
        return items.filter((i) => i.state === 'not_counted');
      case 'zero_found':
        return items.filter((i) => i.sapQty === 0 && (i.finalQty ?? 0) > 0);
      case 'multi_zone':
        return items.filter((i) => i.zones > 1);
      case 'recount':
        return items.filter((i) => i.openRecount || i.recounted !== null);
      case 'approved':
        return items.filter((i) => i.approvedQty !== null);
      default:
        return items;
    }
  }

  dashboard(roundId: number) {
    const round = this.rounds.get(roundId);
    const items = this.items(roundId);
    const byWh = round.warehouses.map((wh) => {
      const list = items.filter((i) => i.warehouse === wh);
      const expected = list.filter((i) => i.sapQty > 0);
      const done = expected.filter((i) => i.state !== 'not_counted').length;
      return {
        warehouse: wh,
        expected: expected.length,
        counted: done,
        progress: expected.length ? done / expected.length : 0,
        withDiff: list.filter((i) => i.diff !== null && i.diff !== 0).length,
      };
    });
    const expected = byWh.reduce((s, w) => s + w.expected, 0);
    const counted = byWh.reduce((s, w) => s + w.counted, 0);
    const exceptionsPending = (
      this.db
        .prepare("SELECT COUNT(*) n FROM exception_items WHERE round_id=? AND review_status='pending'")
        .get(roundId) as { n: number }
    ).n;
    const byUser = this.db
      .prepare(
        `SELECT u.id AS userId, u.display_name AS displayName, z.name AS zoneName, z.warehouse,
                COUNT(c.id) AS actions, COUNT(DISTINCT c.warehouse || '|' || c.item_code) AS items, MAX(c.created_at) AS lastAt
         FROM users u
         LEFT JOIN assignments a ON a.user_id=u.id AND a.round_id=?
         LEFT JOIN zones z ON z.id=a.zone_id
         LEFT JOIN count_actions c ON c.user_id=u.id AND c.round_id=? AND c.status='saved'
         WHERE a.user_id IS NOT NULL OR c.id IS NOT NULL
         GROUP BY u.id ORDER BY actions DESC`,
      )
      .all(roundId, roundId);
    const byZone = this.db
      .prepare(
        `SELECT z.id AS zoneId, z.name AS zoneName, z.warehouse,
                COUNT(c.id) AS actions, COUNT(DISTINCT c.item_code) AS items,
                (SELECT COUNT(*) FROM assignments a WHERE a.zone_id=z.id) AS counters
         FROM zones z LEFT JOIN count_actions c ON c.zone_id=z.id AND c.status='saved'
         WHERE z.round_id=? GROUP BY z.id ORDER BY z.warehouse, z.name`,
      )
      .all(roundId);
    return {
      round,
      totals: {
        expected,
        counted,
        notCounted: expected - counted,
        progress: expected ? counted / expected : 0,
        withDiff: items.filter((i) => i.diff !== null && i.diff !== 0).length,
        zeroFound: items.filter((i) => i.sapQty === 0 && (i.finalQty ?? 0) > 0).length,
        multiZone: items.filter((i) => i.zones > 1).length,
        openRecounts: items.filter((i) => i.openRecount).length,
        exceptionsPending,
        approved: items.filter((i) => i.approvedQty !== null).length,
      },
      byWarehouse: byWh,
      byUser,
      byZone,
      recent: this.recent(roundId, 15),
    };
  }

  recent(roundId: number, limit: number) {
    return this.db
      .prepare(
        `SELECT c.id, c.warehouse, c.item_code AS itemCode, s.item_name AS itemName, c.qty, c.type, c.status,
                u.display_name AS userName, z.name AS zoneName, c.created_at AS createdAt
         FROM count_actions c
         JOIN users u ON u.id=c.user_id
         JOIN snapshot_items s ON s.round_id=c.round_id AND s.warehouse=c.warehouse AND s.item_code=c.item_code
         LEFT JOIN zones z ON z.id=c.zone_id
         WHERE c.round_id=? ORDER BY c.created_at DESC LIMIT ?`,
      )
      .all(roundId, limit);
  }

  itemHistory(roundId: number, warehouse: string, itemCode: string) {
    const item = this.items(roundId, { warehouse }).find((i) => i.itemCode === itemCode);
    const snap = this.db
      .prepare('SELECT item_name, sap_qty, barcodes FROM snapshot_items WHERE round_id=? AND warehouse=? AND item_code=?')
      .get(roundId, warehouse, itemCode) as { item_name: string; sap_qty: number; barcodes: string } | undefined;
    if (!snap) throw new AppError('NOT_FOUND', 'הפריט לא קיים בסבב');
    const actions = this.db
      .prepare(
        `SELECT c.id, c.qty, c.type, c.status, c.note, c.cancel_reason AS cancelReason, c.created_at AS createdAt,
                u.display_name AS userName, z.name AS zoneName, cu.display_name AS cancelledBy
         FROM count_actions c JOIN users u ON u.id=c.user_id
         LEFT JOIN zones z ON z.id=c.zone_id LEFT JOIN users cu ON cu.id=c.cancelled_by
         WHERE c.round_id=? AND c.warehouse=? AND c.item_code=? ORDER BY c.created_at`,
      )
      .all(roundId, warehouse, itemCode);
    const recounts = this.db
      .prepare(
        `SELECT r.id, r.note, r.status, r.created_at AS createdAt, cu.display_name AS createdBy, au.display_name AS assignedTo
         FROM recount_requests r JOIN users cu ON cu.id=r.created_by LEFT JOIN users au ON au.id=r.assigned_to
         WHERE r.round_id=? AND r.warehouse=? AND r.item_code=? ORDER BY r.id`,
      )
      .all(roundId, warehouse, itemCode);
    const approval = this.db
      .prepare(
        `SELECT a.approved_qty AS approvedQty, a.note, a.approved_at AS approvedAt, u.display_name AS approvedBy
         FROM approvals a JOIN users u ON u.id=a.approved_by WHERE a.round_id=? AND a.warehouse=? AND a.item_code=?`,
      )
      .get(roundId, warehouse, itemCode);
    return {
      warehouse,
      itemCode,
      itemName: snap.item_name,
      barcodes: snap.barcodes ? snap.barcodes.split(' ') : [],
      sapQty: snap.sap_qty,
      summary: item ?? null,
      actions,
      recounts,
      approval: approval ?? null,
    };
  }

  requestRecount(actor: User, roundId: number, input: { warehouse: string; itemCode: string; assignedTo?: number | null; note?: string }) {
    const round = this.rounds.get(roundId);
    if (round.status === 'closed') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב סגור');
    this.assertItem(roundId, input.warehouse, input.itemCode);
    const open = this.db
      .prepare("SELECT 1 FROM recount_requests WHERE round_id=? AND warehouse=? AND item_code=? AND status='open'")
      .get(roundId, input.warehouse, input.itemCode);
    if (open) throw new AppError('CONFLICT', 'כבר יש בקשה פתוחה לספירה חוזרת של הפריט');
    this.db
      .prepare('INSERT INTO recount_requests (round_id, warehouse, item_code, assigned_to, note, created_by) VALUES (?,?,?,?,?,?)')
      .run(roundId, input.warehouse, input.itemCode, input.assignedTo ?? null, input.note?.trim() || null, actor.id);
    audit(this.db, actor.id, 'recount.request', 'round', roundId, input);
    return this.itemHistory(roundId, input.warehouse, input.itemCode);
  }

  /** Manager's final decision for an item. Closes any open recount request. */
  approve(actor: User, roundId: number, input: { warehouse: string; itemCode: string; qty: number; note?: string }) {
    const round = this.rounds.get(roundId);
    if (round.status === 'closed') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב סגור. יש להחזיר אותו לבקרה כדי לשנות אישורים.');
    this.assertItem(roundId, input.warehouse, input.itemCode);
    const qty = Number(input.qty);
    if (!Number.isInteger(qty) || qty < 0) throw new AppError('VALIDATION', 'כמות מאושרת חייבת להיות מספר שלם, 0 ומעלה');
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO approvals (round_id, warehouse, item_code, approved_qty, note, approved_by) VALUES (?,?,?,?,?,?)
           ON CONFLICT(round_id, warehouse, item_code) DO UPDATE SET approved_qty=excluded.approved_qty, note=excluded.note,
             approved_by=excluded.approved_by, approved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
        )
        .run(roundId, input.warehouse, input.itemCode, qty, input.note?.trim() || null, actor.id);
      this.db
        .prepare("UPDATE recount_requests SET status='done' WHERE round_id=? AND warehouse=? AND item_code=? AND status='open'")
        .run(roundId, input.warehouse, input.itemCode);
      audit(this.db, actor.id, 'item.approve', 'round', roundId, input);
    })();
    return this.itemHistory(roundId, input.warehouse, input.itemCode);
  }

  revokeApproval(actor: User, roundId: number, warehouse: string, itemCode: string) {
    const round = this.rounds.get(roundId);
    if (round.status === 'closed') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב סגור');
    this.db.prepare('DELETE FROM approvals WHERE round_id=? AND warehouse=? AND item_code=?').run(roundId, warehouse, itemCode);
    audit(this.db, actor.id, 'item.approve_revoke', 'round', roundId, { warehouse, itemCode });
    return this.itemHistory(roundId, warehouse, itemCode);
  }

  exceptions(roundId: number) {
    return this.db
      .prepare(
        `SELECT e.id, e.warehouse, e.code, e.barcode, e.description, e.qty, e.notes, e.review_status AS reviewStatus,
                e.review_note AS reviewNote, e.created_at AS createdAt, u.display_name AS userName, z.name AS zoneName,
                ru.display_name AS reviewedBy, e.reviewed_at AS reviewedAt,
                EXISTS (SELECT 1 FROM exception_photos p WHERE p.exception_id=e.id) AS hasPhoto
         FROM exception_items e JOIN users u ON u.id=e.user_id LEFT JOIN zones z ON z.id=e.zone_id
         LEFT JOIN users ru ON ru.id=e.reviewed_by
         WHERE e.round_id=? ORDER BY e.review_status DESC, e.created_at DESC`,
      )
      .all(roundId);
  }

  exceptionPhoto(roundId: number, id: string) {
    const row = this.db
      .prepare(
        `SELECT p.mime, p.data FROM exception_photos p JOIN exception_items e ON e.id=p.exception_id
         WHERE p.exception_id=? AND e.round_id=?`,
      )
      .get(id, roundId) as { mime: string; data: Buffer } | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'לפריט הזה אין תמונה');
    return row;
  }

  resolveException(actor: User, roundId: number, id: string, note: string) {
    if (!note.trim()) throw new AppError('VALIDATION', 'יש לכתוב מה נמצא בבדיקה');
    const info = this.db
      .prepare(
        `UPDATE exception_items SET review_status='resolved', review_note=?, reviewed_by=?,
           reviewed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND round_id=?`,
      )
      .run(note.trim(), actor.id, id, roundId);
    if (!info.changes) throw new AppError('NOT_FOUND', 'הפריט החריג לא נמצא');
    audit(this.db, actor.id, 'exception.resolve', 'exception', id, { note });
    return { ok: true };
  }

  private assertItem(roundId: number, warehouse: string, itemCode: string) {
    const ok = this.db
      .prepare('SELECT 1 FROM snapshot_items WHERE round_id=? AND warehouse=? AND item_code=?')
      .get(roundId, warehouse, itemCode);
    if (!ok) throw new AppError('NOT_FOUND', 'הפריט לא קיים בסבב');
  }
}

interface Raw {
  warehouse: string;
  item_code: string;
  item_name: string;
  sap_qty: number;
  counted: number | null;
  recounted: number | null;
  actions: number;
  counters: number;
  zones: number;
  zone_names: string;
  last_at: string | null;
  approved_qty: number | null;
  open_recount: number;
}

function toItem(r: Raw): ItemRow {
  const finalQty = r.approved_qty ?? r.counted ?? null;
  const state: ItemState =
    r.approved_qty !== null ? 'approved' : r.open_recount ? 'recount' : r.counted !== null ? 'counted' : 'not_counted';
  return {
    warehouse: r.warehouse,
    itemCode: r.item_code,
    itemName: r.item_name,
    sapQty: r.sap_qty,
    counted: r.counted,
    recounted: r.recounted,
    approvedQty: r.approved_qty,
    finalQty,
    diff: finalQty === null ? null : finalQty - r.sap_qty,
    comparison: finalQty === null ? null : compare(finalQty, r.sap_qty),
    state,
    actions: r.actions,
    counters: r.counters,
    zones: r.zones,
    zoneNames: r.zone_names,
    lastAt: r.last_at,
    openRecount: !!r.open_recount,
  };
}
