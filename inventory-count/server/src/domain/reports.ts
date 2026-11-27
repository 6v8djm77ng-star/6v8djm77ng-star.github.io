import ExcelJS from 'exceljs';
import type { Db } from '../db/database.js';
import { AppError } from './errors.js';
import type { ItemFilter, ItemRow, ReviewService } from './review.js';
import type { RoundService } from './rounds.js';

export const REPORTS = {
  general: 'דוח ספירה כללי',
  differences: 'דוח הפרשים',
  not_counted: 'פריטים שלא נספרו',
  zero_found: 'יתרת אפס שנמצאה',
  exceptions: 'פריטים חריגים',
  by_user: 'לפי סופר',
  by_zone: 'לפי אזור',
  multi_zone: 'מק"טים ביותר מאזור',
  recounts: 'ספירות חוזרות',
  actions: 'יומן פעולות מלא',
} as const;
export type ReportType = keyof typeof REPORTS;

export interface ReportColumn {
  header: string;
  key: string;
  width: number;
  numeric?: boolean;
}
export interface ReportSection {
  name: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
}
/** Format-neutral report: rendered to Excel on the server and to a printable page (PDF) in the browser. */
export interface ReportTable {
  type: ReportType;
  title: string;
  round: { id: number; name: string; warehouses: string[]; snapshotAt: string; status: string };
  generatedAt: string;
  sections: ReportSection[];
}

const STATE_HE: Record<ItemRow['state'], string> = {
  not_counted: 'טרם נספר',
  counted: 'נספר',
  recount: 'נדרשת ספירה חוזרת',
  approved: 'אושר',
};
const CMP_HE = { higher: 'גבוה מ-SAP', lower: 'נמוך מ-SAP', match: 'תואם' } as const;
const TYPE_HE = { count: 'ספירה', recount: 'ספירה חוזרת', correction: 'תיקון' } as const;

const n = (header: string, key: string, width: number): ReportColumn => ({ header, key, width, numeric: true });
const t = (header: string, key: string, width: number): ReportColumn => ({ header, key, width });

const itemCols: ReportColumn[] = [
  t('מחסן', 'warehouse', 8),
  t('מק"ט', 'itemCode', 16),
  t('תיאור', 'itemName', 36),
  n('יתרת SAP', 'sapQty', 11),
  n('נספר', 'counted', 9),
  n('ספירה חוזרת', 'recounted', 12),
  n('כמות מאושרת', 'approvedQty', 12),
  n('כמות סופית', 'finalQty', 11),
  n('הפרש', 'diff', 9),
  t('השוואה', 'comparisonHe', 13),
  t('סטטוס', 'stateHe', 18),
  t('אזורים', 'zoneNames', 22),
  n('פעולות', 'actions', 8),
];

export class ReportService {
  constructor(
    private db: Db,
    private rounds: RoundService,
    private review: ReviewService,
  ) {}

  table(roundId: number, type: ReportType): ReportTable {
    if (!Object.prototype.hasOwnProperty.call(REPORTS, type)) throw new AppError('NOT_FOUND', 'סוג דוח לא מוכר');
    const round = this.rounds.get(roundId);
    const items = (filter: ItemFilter) =>
      this.review.items(roundId, { filter }).map((i) => ({
        warehouse: i.warehouse,
        itemCode: i.itemCode,
        itemName: i.itemName,
        sapQty: i.sapQty,
        counted: i.counted,
        recounted: i.recounted,
        approvedQty: i.approvedQty,
        finalQty: i.finalQty,
        diff: i.diff,
        comparisonHe: i.comparison ? CMP_HE[i.comparison] : '',
        stateHe: STATE_HE[i.state],
        zoneNames: i.zoneNames,
        actions: i.actions,
      }));

    let sections: ReportSection[];
    switch (type) {
      case 'general': {
        const all = items('all');
        sections = round.warehouses.map((wh) => ({ name: `מחסן ${wh}`, columns: itemCols, rows: all.filter((r) => r.warehouse === wh) }));
        break;
      }
      case 'differences':
        sections = [{ name: REPORTS[type], columns: itemCols, rows: items('diff') }];
        break;
      case 'not_counted':
        sections = [{ name: REPORTS[type], columns: itemCols.slice(0, 4), rows: items('not_counted') }];
        break;
      case 'zero_found':
        sections = [{ name: REPORTS[type], columns: itemCols, rows: items('zero_found') }];
        break;
      case 'multi_zone':
        sections = [{ name: REPORTS[type], columns: itemCols, rows: items('multi_zone') }];
        break;
      case 'recounts':
        sections = [{ name: REPORTS[type], columns: itemCols, rows: items('recount') }];
        break;
      case 'exceptions':
        sections = [
          {
            name: REPORTS[type],
            columns: [
              t('מחסן', 'warehouse', 8),
              t('מק"ט', 'code', 16),
              t('ברקוד', 'barcode', 16),
              t('תיאור', 'description', 36),
              n('כמות', 'qty', 8),
              t('הערות', 'notes', 30),
              t('סופר', 'userName', 16),
              t('אזור', 'zoneName', 16),
              t('דווח', 'createdAt', 18),
              t('תמונה', 'photoHe', 8),
              t('סטטוס', 'statusHe', 12),
              t('ממצא בדיקה', 'reviewNote', 30),
            ],
            rows: (this.review.exceptions(roundId) as Record<string, unknown>[]).map((e) => ({
              warehouse: e.warehouse as string,
              code: (e.code as string) ?? '',
              barcode: (e.barcode as string) ?? '',
              description: e.description as string,
              qty: e.qty as number,
              notes: (e.notes as string) ?? '',
              userName: e.userName as string,
              zoneName: (e.zoneName as string) ?? '',
              createdAt: fmtDate(e.createdAt as string),
              photoHe: e.hasPhoto ? 'יש' : '',
              statusHe: e.reviewStatus === 'resolved' ? 'נבדק' : 'ממתין',
              reviewNote: (e.reviewNote as string) ?? '',
            })),
          },
        ];
        break;
      case 'by_user': {
        const d = this.review.dashboard(roundId);
        sections = [
          {
            name: REPORTS[type],
            columns: [t('סופר', 'displayName', 20), t('מחסן', 'warehouse', 8), t('אזור', 'zoneName', 18), n('פעולות', 'actions', 10), n('פריטים', 'items', 10), t('פעולה אחרונה', 'lastAt', 18)],
            rows: d.byUser.map((u) => {
              const r = u as Record<string, string | number | null>;
              return { ...r, lastAt: fmtDate(r.lastAt as string | null) };
            }),
          },
        ];
        break;
      }
      case 'by_zone': {
        const d = this.review.dashboard(roundId);
        sections = [
          {
            name: REPORTS[type],
            columns: [t('מחסן', 'warehouse', 8), t('אזור', 'zoneName', 20), n('סופרים משובצים', 'counters', 14), n('פעולות', 'actions', 10), n('פריטים', 'items', 10)],
            rows: d.byZone as Record<string, string | number | null>[],
          },
        ];
        break;
      }
      case 'actions': {
        const rows = this.db
          .prepare(
            `SELECT c.created_at, c.warehouse, c.item_code, s.item_name, c.qty, c.type, c.status, c.note, c.cancel_reason,
                    u.display_name AS user_name, z.name AS zone_name
             FROM count_actions c JOIN users u ON u.id=c.user_id
             JOIN snapshot_items s ON s.round_id=c.round_id AND s.warehouse=c.warehouse AND s.item_code=c.item_code
             LEFT JOIN zones z ON z.id=c.zone_id WHERE c.round_id=? ORDER BY c.created_at`,
          )
          .all(roundId) as Record<string, string | number | null>[];
        sections = [
          {
            name: REPORTS[type],
            columns: [
              t('זמן', 'at', 18),
              t('מחסן', 'warehouse', 8),
              t('מק"ט', 'item_code', 16),
              t('תיאור', 'item_name', 34),
              n('כמות', 'qty', 8),
              t('סוג', 'typeHe', 12),
              t('סטטוס', 'statusHe', 10),
              t('סופר', 'user_name', 16),
              t('אזור', 'zone_name', 16),
              t('הערה / סיבת ביטול', 'remark', 30),
            ],
            rows: rows.map((r) => ({
              ...r,
              at: fmtDate(r.created_at as string),
              typeHe: TYPE_HE[r.type as keyof typeof TYPE_HE],
              statusHe: r.status === 'cancelled' ? 'בוטל' : 'נשמר',
              remark: (r.cancel_reason as string) || (r.note as string) || '',
            })),
          },
        ];
        break;
      }
    }
    return {
      type,
      title: REPORTS[type],
      round: { id: round.id, name: round.name, warehouses: round.warehouses, snapshotAt: round.snapshotAt, status: round.status },
      generatedAt: new Date().toISOString(),
      sections,
    };
  }

  async build(roundId: number, type: ReportType): Promise<{ buffer: Buffer; filename: string }> {
    const report = this.table(roundId, type);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Inventory Count';
    wb.created = new Date();
    for (const s of report.sections) {
      const ws = wb.addWorksheet(s.name.replace(/[\\/*?:[\]]/g, '').slice(0, 31), {
        views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
      });
      ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
      s.rows.forEach((r) => ws.addRow(r));
      const head = ws.getRow(1);
      head.font = { bold: true };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECF3' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
    }
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const stamp = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `round-${roundId}-${type}-${stamp}.xlsx` };
  }
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
}
