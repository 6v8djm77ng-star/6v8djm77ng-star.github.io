import type { InventoryCountingInput, SapGateway, SnapshotRow, StockMovement } from './types.js';

const NAMES = [
  'מיקסר ידני 400W', 'קומקום חשמלי 1.7 ל׳', 'מצנם 2 פרוסות', 'טוסטר אובן 23 ל׳', 'בלנדר מוט',
  'מסחטת הדרים', 'מכונת קפה קפסולות', 'מגהץ אדים', 'שואב אבק אלחוטי', 'מאוורר עמוד',
  'תנור חימום שמן', 'מייבש שיער 2200W', 'מחליק שיער', 'מכונת גילוח', 'מטחנת קפה',
  'סיר בישול איטי', 'סיר לחץ חשמלי', 'מכשיר אדים', 'פלטת שבת', 'מיחם 30 כוסות',
  'גריל חשמלי', 'מעבד מזון', 'משקל מטבח דיגיטלי', 'מסנן מים', 'כבל מתאם חשמל',
  'מנוע מיקסר – חלק חילוף', 'להב בלנדר – חלק חילוף', 'ידית קומקום – חלק חילוף', 'כרטיס בקר', 'ספק כוח 12V',
];

function seed(): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  // Fixed acceptance-test items from the spec
  rows.push({ warehouse: '15', itemCode: '1111', itemName: 'מוצר לדוגמה', barcodes: ['7290000001111'], onHand: 20 });
  rows.push({ warehouse: '151', itemCode: '1111', itemName: 'מוצר לדוגמה', barcodes: ['7290000001111'], onHand: 35 });
  rows.push({ warehouse: '15', itemCode: '2222', itemName: 'פריט ביתרה אפס', barcodes: ['7290000002222'], onHand: 0 });
  rows.push({ warehouse: '151', itemCode: '2222', itemName: 'פריט ביתרה אפס', barcodes: ['7290000002222'], onHand: 0 });
  NAMES.forEach((name, i) => {
    const code = `OIG-${String(1000 + i * 7)}`;
    const barcode = `72900${String(10000000 + i * 131).slice(0, 8)}`;
    for (const wh of ['15', '151']) {
      const onHand = (i * 13 + (wh === '15' ? 5 : 11)) % 47;
      rows.push({ warehouse: wh, itemCode: code, itemName: name, barcodes: [barcode], onHand: i % 9 === 4 ? 0 : onHand });
    }
  });
  return rows;
}

/** In-memory SAP stand-in for demos and tests. */
export class MockSapGateway implements SapGateway {
  readonly mode = 'mock' as const;
  private rows = seed();
  private movements: StockMovement[] = [];
  private transNum = 500000;
  private docEntry = 900;
  readonly createdDocuments: (InventoryCountingInput & { docEntry: number })[] = [];

  async loadSnapshot(warehouses: string[]) {
    return {
      rows: this.rows.filter((r) => warehouses.includes(r.warehouse)).map((r) => ({ ...r, barcodes: [...r.barcodes] })),
      lastTransNum: this.transNum,
    };
  }

  async getMovementsSince(warehouses: string[], transNum: number) {
    return this.movements.filter((m) => m.transNum > transNum && warehouses.includes(m.warehouse));
  }

  async createInventoryCounting(input: InventoryCountingInput) {
    const docEntry = ++this.docEntry;
    this.createdDocuments.push({ ...input, docEntry });
    return { docEntry, docNum: docEntry };
  }

  /** Test/demo helper: simulate a stock transaction in SAP (breaks the freeze). */
  simulateMovement(itemCode: string, warehouse: string, qty: number) {
    const m: StockMovement = {
      transNum: ++this.transNum,
      transType: 15,
      baseRef: String(70000 + this.transNum % 1000),
      itemCode,
      warehouse,
      qty,
      createdAt: new Date().toISOString(),
    };
    this.movements.push(m);
    return m;
  }

  async close() {}
}
