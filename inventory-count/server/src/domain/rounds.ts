import type { Db } from '../db/database.js';
import { audit } from '../db/database.js';
import type { SapGateway } from '../sap/types.js';
import { AppError } from './errors.js';
import type { User } from './users.js';

export type RoundStatus = 'open' | 'paused' | 'review' | 'closed';

export interface Round {
  id: number;
  name: string;
  status: RoundStatus;
  warehouses: string[];
  snapshotAt: string;
  snapshotTransNum: number;
  createdAt: string;
  createdBy: string;
  closedAt: string | null;
  sapDocEntry: number | null;
  sapDocNum: number | null;
  sapSentAt: string | null;
}

export interface Zone {
  id: number;
  warehouse: string;
  name: string;
}

export interface Assignment {
  userId: number;
  displayName: string;
  zoneId: number;
  zoneName: string;
  warehouse: string;
}

const TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  open: ['paused', 'review'],
  paused: ['open'],
  review: ['open', 'closed'],
  closed: ['review'],
};

interface RoundRow {
  id: number;
  name: string;
  status: RoundStatus;
  snapshot_at: string;
  snapshot_trans_num: number;
  created_at: string;
  created_by_name: string;
  closed_at: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: number | null;
  sap_sent_at: string | null;
}

export class RoundService {
  constructor(
    private db: Db,
    private sap: SapGateway,
    private allowedWarehouses: { code: string; name: string }[],
  ) {}

  warehouses() {
    return this.allowedWarehouses;
  }

  list(): Round[] {
    const rows = this.db
      .prepare(
        `SELECT r.*, u.display_name AS created_by_name FROM rounds r JOIN users u ON u.id=r.created_by
         ORDER BY CASE r.status WHEN 'closed' THEN 1 ELSE 0 END, r.id DESC`,
      )
      .all() as RoundRow[];
    return rows.map((r) => this.toRound(r));
  }

  get(id: number): Round {
    const r = this.db
      .prepare('SELECT r.*, u.display_name AS created_by_name FROM rounds r JOIN users u ON u.id=r.created_by WHERE r.id=?')
      .get(id) as RoundRow | undefined;
    if (!r) throw new AppError('NOT_FOUND', 'סבב הספירה לא נמצא');
    return this.toRound(r);
  }

  private toRound(r: RoundRow): Round {
    const warehouses = (
      this.db.prepare('SELECT warehouse FROM round_warehouses WHERE round_id=? ORDER BY warehouse').all(r.id) as {
        warehouse: string;
      }[]
    ).map((w) => w.warehouse);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      warehouses,
      snapshotAt: r.snapshot_at,
      snapshotTransNum: r.snapshot_trans_num,
      createdAt: r.created_at,
      createdBy: r.created_by_name,
      closedAt: r.closed_at,
      sapDocEntry: r.sap_doc_entry,
      sapDocNum: r.sap_doc_num,
      sapSentAt: r.sap_sent_at,
    };
  }

  async create(actor: User, input: { name: string; warehouses: string[]; zones: { warehouse: string; name: string }[] }) {
    const name = input.name.trim();
    if (!name) throw new AppError('VALIDATION', 'חסר שם לסבב');
    const allowed = new Set(this.allowedWarehouses.map((w) => w.code));
    const warehouses = [...new Set(input.warehouses)];
    if (warehouses.length === 0 || warehouses.some((w) => !allowed.has(w))) {
      throw new AppError('VALIDATION', 'יש לבחור מחסן מתוך המחסנים המוגדרים');
    }
    const busy = this.db
      .prepare(
        `SELECT rw.warehouse, r.name FROM round_warehouses rw JOIN rounds r ON r.id=rw.round_id
         WHERE r.status <> 'closed' AND rw.warehouse IN (${warehouses.map(() => '?').join(',')})`,
      )
      .get(...warehouses) as { warehouse: string; name: string } | undefined;
    if (busy) {
      throw new AppError('CONFLICT', `במחסן ${busy.warehouse} כבר יש סבב פעיל ("${busy.name}"). יש לסגור אותו קודם.`);
    }

    let snapshot;
    try {
      snapshot = await this.sap.loadSnapshot(warehouses);
    } catch (e) {
      throw new AppError('SAP_ERROR', 'לא הצלחנו לקרוא את המלאי מ-SAP. הסבב לא נפתח.', String(e));
    }
    if (snapshot.rows.length === 0) throw new AppError('SAP_ERROR', 'SAP החזיר רשימת פריטים ריקה למחסנים שנבחרו');

    const snapshotAt = new Date().toISOString();
    const roundId = this.db.transaction(() => {
      const info = this.db
        .prepare('INSERT INTO rounds (name, status, snapshot_trans_num, snapshot_at, created_by) VALUES (?,?,?,?,?)')
        .run(name, 'open', snapshot.lastTransNum, snapshotAt, actor.id);
      const id = Number(info.lastInsertRowid);
      const insW = this.db.prepare('INSERT INTO round_warehouses (round_id, warehouse) VALUES (?,?)');
      warehouses.forEach((w) => insW.run(id, w));
      const insS = this.db.prepare(
        'INSERT OR REPLACE INTO snapshot_items (round_id, warehouse, item_code, item_name, barcodes, sap_qty) VALUES (?,?,?,?,?,?)',
      );
      const insB = this.db.prepare('INSERT OR IGNORE INTO barcodes (round_id, barcode, item_code) VALUES (?,?,?)');
      for (const r of snapshot.rows) {
        insS.run(id, r.warehouse, r.itemCode, r.itemName, r.barcodes.join(' '), r.onHand);
        r.barcodes.forEach((b) => insB.run(id, b, r.itemCode));
      }
      const insZ = this.db.prepare('INSERT OR IGNORE INTO zones (round_id, warehouse, name) VALUES (?,?,?)');
      for (const z of input.zones) {
        if (!warehouses.includes(z.warehouse) || !z.name.trim()) continue;
        insZ.run(id, z.warehouse, z.name.trim());
      }
      audit(this.db, actor.id, 'round.create', 'round', id, {
        warehouses,
        items: snapshot.rows.length,
        transNum: snapshot.lastTransNum,
      });
      return id;
    })();
    return this.get(roundId);
  }

  zones(roundId: number): Zone[] {
    return this.db
      .prepare('SELECT id, warehouse, name FROM zones WHERE round_id=? ORDER BY warehouse, name')
      .all(roundId) as Zone[];
  }

  addZone(actor: User, roundId: number, warehouse: string, name: string) {
    const round = this.get(roundId);
    if (round.status === 'closed') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב סגור');
    if (!round.warehouses.includes(warehouse)) throw new AppError('VALIDATION', 'המחסן לא שייך לסבב');
    if (!name.trim()) throw new AppError('VALIDATION', 'חסר שם לאזור');
    try {
      const info = this.db
        .prepare('INSERT INTO zones (round_id, warehouse, name) VALUES (?,?,?)')
        .run(roundId, warehouse, name.trim());
      audit(this.db, actor.id, 'zone.create', 'round', roundId, { warehouse, name });
      return { id: Number(info.lastInsertRowid), warehouse, name: name.trim() };
    } catch {
      throw new AppError('CONFLICT', 'כבר קיים אזור בשם הזה במחסן');
    }
  }

  assignments(roundId: number): Assignment[] {
    return this.db
      .prepare(
        `SELECT a.user_id AS userId, u.display_name AS displayName, z.id AS zoneId, z.name AS zoneName, z.warehouse
         FROM assignments a JOIN users u ON u.id=a.user_id JOIN zones z ON z.id=a.zone_id
         WHERE a.round_id=? ORDER BY u.display_name`,
      )
      .all(roundId) as Assignment[];
  }

  assign(actor: User, roundId: number, userId: number, zoneId: number | null) {
    const round = this.get(roundId);
    if (round.status === 'closed') throw new AppError('ROUND_NOT_ACTIVE', 'הסבב סגור');
    const user = this.db.prepare('SELECT active FROM users WHERE id=?').get(userId) as { active: number } | undefined;
    if (!user?.active) throw new AppError('VALIDATION', 'המשתמש לא קיים או לא פעיל');
    if (zoneId === null) {
      this.db.prepare('DELETE FROM assignments WHERE round_id=? AND user_id=?').run(roundId, userId);
    } else {
      const zone = this.db.prepare('SELECT id FROM zones WHERE id=? AND round_id=?').get(zoneId, roundId);
      if (!zone) throw new AppError('VALIDATION', 'האזור לא שייך לסבב');
      this.db
        .prepare(
          `INSERT INTO assignments (round_id, user_id, zone_id) VALUES (?,?,?)
           ON CONFLICT(round_id, user_id) DO UPDATE SET zone_id=excluded.zone_id`,
        )
        .run(roundId, userId, zoneId);
    }
    audit(this.db, actor.id, 'round.assign', 'round', roundId, { userId, zoneId });
    return this.assignments(roundId);
  }

  /** The active round + zone a counter works in. */
  assignmentFor(userId: number) {
    return this.db
      .prepare(
        `SELECT r.id AS roundId, r.name AS roundName, r.status, z.id AS zoneId, z.name AS zoneName, z.warehouse
         FROM assignments a JOIN rounds r ON r.id=a.round_id JOIN zones z ON z.id=a.zone_id
         WHERE a.user_id=? AND r.status <> 'closed' ORDER BY r.id DESC LIMIT 1`,
      )
      .get(userId) as
      | { roundId: number; roundName: string; status: RoundStatus; zoneId: number; zoneName: string; warehouse: string }
      | undefined;
  }

  async freezeCheck(roundId: number) {
    const round = this.get(roundId);
    let movements;
    try {
      movements = await this.sap.getMovementsSince(round.warehouses, round.snapshotTransNum);
    } catch (e) {
      throw new AppError('SAP_ERROR', 'בדיקת ההקפאה מול SAP נכשלה', String(e));
    }
    const nameOf = this.db.prepare(
      'SELECT item_name FROM snapshot_items WHERE round_id=? AND item_code=? LIMIT 1',
    );
    return {
      checkedAt: new Date().toISOString(),
      clean: movements.length === 0,
      movements: movements.map((m) => ({
        ...m,
        itemName: (nameOf.get(roundId, m.itemCode) as { item_name: string } | undefined)?.item_name ?? '',
      })),
    };
  }

  async setStatus(actor: User, roundId: number, next: RoundStatus, opts: { acknowledgeMovements?: boolean; note?: string } = {}) {
    const round = this.get(roundId);
    if (!TRANSITIONS[round.status].includes(next)) {
      throw new AppError('VALIDATION', `אי אפשר לעבור מסטטוס "${STATUS_HE[round.status]}" ל"${STATUS_HE[next]}"`);
    }
    if (round.status === 'closed' && round.sapSentAt) {
      throw new AppError('CONFLICT', 'הסבב כבר נשלח ל-SAP ולא ניתן לפתוח אותו מחדש');
    }
    let freeze: Awaited<ReturnType<RoundService['freezeCheck']>> | undefined;
    if (next === 'closed') {
      freeze = await this.freezeCheck(roundId);
      if (!freeze.clean && !opts.acknowledgeMovements) {
        throw new AppError(
          'FREEZE_VIOLATION',
          `נמצאו ${freeze.movements.length} תנועות מלאי ב-SAP מאז פתיחת הסבב. יש לבדוק אותן לפני הסגירה.`,
          freeze,
        );
      }
    }
    this.db
      .prepare(
        `UPDATE rounds SET status=?,
           closed_at = CASE WHEN ?='closed' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE NULL END,
           closed_by = CASE WHEN ?='closed' THEN ? ELSE NULL END
         WHERE id=?`,
      )
      .run(next, next, next, actor.id, roundId);
    audit(this.db, actor.id, 'round.status', 'round', roundId, {
      from: round.status,
      to: next,
      note: opts.note,
      movementsAcknowledged: freeze && !freeze.clean ? freeze.movements.length : undefined,
    });
    return this.get(roundId);
  }

  /** Lines that would be written to the SAP Inventory Counting document. */
  sapLines(roundId: number) {
    return this.db
      .prepare(
        `SELECT s.warehouse, s.item_code AS itemCode, s.sap_qty AS sapQty,
                COALESCE(a.approved_qty, c.counted) AS countedQty
         FROM snapshot_items s
         LEFT JOIN (SELECT warehouse, item_code, SUM(qty) AS counted
                    FROM count_actions WHERE round_id=? AND status='saved' AND type IN ('count','correction')
                    GROUP BY warehouse, item_code) c
           ON c.warehouse=s.warehouse AND c.item_code=s.item_code
         LEFT JOIN approvals a ON a.round_id=s.round_id AND a.warehouse=s.warehouse AND a.item_code=s.item_code
         WHERE s.round_id=? AND (a.approved_qty IS NOT NULL OR c.counted IS NOT NULL)
         ORDER BY s.warehouse, s.item_code`,
      )
      .all(roundId, roundId) as { warehouse: string; itemCode: string; sapQty: number; countedQty: number }[];
  }

  sendPreview(roundId: number) {
    const lines = this.sapLines(roundId);
    const uncounted = (
      this.db
        .prepare(
          `SELECT COUNT(*) n FROM snapshot_items s
           WHERE s.round_id=? AND s.sap_qty > 0
             AND NOT EXISTS (SELECT 1 FROM count_actions c WHERE c.round_id=s.round_id AND c.warehouse=s.warehouse
                             AND c.item_code=s.item_code AND c.status='saved' AND c.type IN ('count','correction'))
             AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.round_id=s.round_id AND a.warehouse=s.warehouse AND a.item_code=s.item_code)`,
        )
        .get(roundId) as { n: number }
    ).n;
    const negative = lines.filter((l) => l.countedQty < 0).length;
    return { lines: lines.length, uncountedWithStock: uncounted, negative };
  }

  async sendToSap(actor: User, roundId: number) {
    const round = this.get(roundId);
    if (round.status !== 'closed') throw new AppError('VALIDATION', 'אפשר לשלוח ל-SAP רק סבב סגור');
    if (round.sapSentAt) throw new AppError('CONFLICT', `הסבב כבר נשלח ל-SAP (מסמך ${round.sapDocNum})`);
    const lines = this.sapLines(roundId);
    if (lines.length === 0) throw new AppError('VALIDATION', 'אין פריטים שנספרו לשליחה');
    if (lines.some((l) => l.countedQty < 0)) {
      throw new AppError('VALIDATION', 'יש פריטים עם כמות שלילית אחרי תיקונים. יש לאשר להם כמות סופית לפני השליחה.');
    }
    let doc;
    try {
      doc = await this.sap.createInventoryCounting({
        reference: `ספירה #${round.id} ${round.name}`.slice(0, 250),
        countDate: new Date().toISOString().slice(0, 10),
        lines: lines.map((l) => ({ itemCode: l.itemCode, warehouse: l.warehouse, countedQty: l.countedQty })),
      });
    } catch (e) {
      audit(this.db, actor.id, 'round.sap_send_failed', 'round', roundId, { error: String(e) });
      throw new AppError('SAP_ERROR', 'יצירת מסמך ספירת המלאי ב-SAP נכשלה. שום דבר לא השתנה ב-SAP.', String(e));
    }
    this.db
      .prepare(
        "UPDATE rounds SET sap_doc_entry=?, sap_doc_num=?, sap_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      )
      .run(doc.docEntry, doc.docNum, roundId);
    audit(this.db, actor.id, 'round.sap_sent', 'round', roundId, { ...doc, lines: lines.length });
    return { ...doc, lines: lines.length };
  }
}

export const STATUS_HE: Record<RoundStatus, string> = {
  open: 'פתוח',
  paused: 'מושהה',
  review: 'בבקרה',
  closed: 'סגור',
};
