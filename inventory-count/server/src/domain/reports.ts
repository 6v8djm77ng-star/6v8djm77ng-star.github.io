import ExcelJS from 'exceljs';
import type { Db } from '../db/database.js';
import { AppError } from './errors.js';
import type { ReviewService, ItemRow, ItemFilter } from './review.js';
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

type Col = { header: string; key: string; width: number; numFmt?: string };

const STATE_HE: Record<ItemRow['state'], string> = {
  not_counted: 'טרם נספר',
  counted: 'נספר',
  recount: 'נדרשת ספירה חוזרת',
  approved: 'אושר',
};
const CMP_HE = { higher: 'גבוה מ-SAP', lower: 'נמוך מ-SAP', match: 'תואם' } as const;
const TYPE_HE = { count: 'ספירה', recount: 'ספירה חוזרת', correction: 'תיקון' } as const;

const itemCols: Col[] = [
  { header: 'מחסן', key: 'warehouse', width: 8 },
  { header: 'מק"ט', key: 'itemCode', width: 16 },
  { header: 'תיאור', key: 'itemName', width: 36 },
  { header: 'יתרת SAP', key: 'sapQty', width: 11 },
  { header: 'נספר', key: 'counted', width: 9 },
  { header: 'ספירה חוזרת', key: 'recounted', width: 12 },
  { header: 'כמות מאושרת', key: 'approvedQty', width: 12 },
  { header: 'כמות סופית', key: 'finalQty', width: 11 },
  { header: 'הפרש', key: 'diff', width: 9 },
  { header: 'השוואה', key: 'comparisonHe', width: 13 },
  { header: 'סטטוס', key: 'stateHe', width: 18 },
  { header: 'אזורים', key: 'zoneNames', width: 22 },
  { header: 'פעולות', key: 'actions', width: 8 },
];

export class ReportService {
  constructor(
    private db: Db,
    private rounds: RoundService,
    private review: ReviewService,
  ) {}

  async build(roundId: number, type: ReportType): Promise<{ buffer: Buffer; filename: string }> {
    if (!(type in REPORTS)) throw new AppError('NOT_FOUND', 'סוג דוח לא מוכר');
    const round = this.rounds.get(roundId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Inventory Count';
    wb.created = new Date();

    const itemRows = (filter: ItemFilter) =>
      this.review.items(roundId, { filter }).map((i) => ({
        ...i,
        comparisonHe: i.comparison ? CMP_HE[i.comparison] : '',
        stateHe: STATE_HE[i.state],
      }));

    switch (type) {
      case 'general':
        for (const wh of round.warehouses) {
          sheet(wb, `מחסן ${wh}`, itemCols, itemRows('all').filter((r) => r.warehouse === wh));
        }
        break;
      case 'differences':
        sheet(wb, REPORTS[type], itemCols, itemRows('diff'));
        break;
      case 'not_counted':
        sheet(wb, REPORTS[type], itemCols.slice(0, 4), itemRows('not_counted'));
        break;
      case 'zero_found':
        sheet(wb, REPORTS[type], itemCols, itemRows('zero_found'));
        break;
      case 'multi_zone':
        sheet(wb, REPORTS[type], itemCols, itemRows('multi_zone'));
        break;
      case 'recounts':
        sheet(wb, REPORTS[type], itemCols, itemRows('recount'));
        break;
      case 'exceptions':
        sheet(
          wb,
          REPORTS[type],
          [
            { header: 'מחסן', key: 'warehouse', width: 8 },
            { header: 'מק"ט', key: 'code', width: 16 },
            { header: 'ברקוד', key: 'barcode', width: 16 },
            { header: 'תיאור', key: 'description', width: 36 },
            { header: 'כמות', key: 'qty', width: 8 },
            { header: 'הערות', key: 'notes', width: 30 },
            { header: 'סופר', key: 'userName', width: 16 },
            { header: 'אזור', key: 'zoneName', width: 16 },
            { header: 'דווח', key: 'createdAt', width: 18 },
            { header: 'סטטוס', key: 'statusHe', width: 12 },
            { header: 'ממצא בדיקה', key: 'reviewNote', width: 30 },
          ],
          (this.review.exceptions(roundId) as Record<string, unknown>[]).map((e) => ({
            ...e,
            createdAt: fmtDate(e.createdAt as string),
            statusHe: e.reviewStatus === 'resolved' ? 'נבדק' : 'ממתין',
          })),
        );
        break;
      case 'by_user':
      case 'by_zone': {
        const d = this.review.dashboard(roundId);
        if (type === 'by_user') {
          sheet(
            wb,
            REPORTS[type],
            [
              { header: 'סופר', key: 'displayName', width: 20 },
              { header: 'מחסן', key: 'warehouse', width: 8 },
              { header: 'אזור', key: 'zoneName', width: 18 },
              { header: 'פעולות', key: 'actions', width: 10 },
              { header: 'פריטים', key: 'items', width: 10 },
              { header: 'פעולה אחרונה', key: 'lastAt', width: 18 },
            ],
            (d.byUser as Record<string, unknown>[]).map((u) => ({ ...u, lastAt: fmtDate(u.lastAt as string | null) })),
          );
        } else {
          sheet(
            wb,
            REPORTS[type],
            [
              { header: 'מחסן', key: 'warehouse', width: 8 },
              { header: 'אזור', key: 'zoneName', width: 20 },
              { header: 'סופרים משובצים', key: 'counters', width: 14 },
              { header: 'פעולות', key: 'actions', width: 10 },
              { header: 'פריטים', key: 'items', width: 10 },
            ],
            d.byZone as Record<string, unknown>[],
          );
        }
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
          .all(roundId) as Record<string, unknown>[];
        sheet(
          wb,
          REPORTS[type],
          [
            { header: 'זמן', key: 'at', width: 18 },
            { header: 'מחסן', key: 'warehouse', width: 8 },
            { header: 'מק"ט', key: 'item_code', width: 16 },
            { header: 'תיאור', key: 'item_name', width: 34 },
            { header: 'כמות', key: 'qty', width: 8 },
            { header: 'סוג', key: 'typeHe', width: 12 },
            { header: 'סטטוס', key: 'statusHe', width: 10 },
            { header: 'סופר', key: 'user_name', width: 16 },
            { header: 'אזור', key: 'zone_name', width: 16 },
            { header: 'הערה / סיבת ביטול', key: 'remark', width: 30 },
          ],
          rows.map((r) => ({
            ...r,
            at: fmtDate(r.created_at as string),
            typeHe: TYPE_HE[r.type as keyof typeof TYPE_HE],
            statusHe: r.status === 'cancelled' ? 'בוטל' : 'נשמר',
            remark: (r.cancel_reason as string) || (r.note as string) || '',
          })),
        );
        break;
      }
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const stamp = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `round-${round.id}-${type}-${stamp}.xlsx` };
  }
}

function sheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name.replace(/[\\/*?:[\]]/g, '').slice(0, 31), {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  rows.forEach((r) => ws.addRow(r));
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECF3' } };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
}
