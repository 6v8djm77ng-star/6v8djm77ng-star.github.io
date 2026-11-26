export interface SnapshotRow {
  warehouse: string;
  itemCode: string;
  itemName: string;
  barcodes: string[];
  onHand: number;
}

export interface StockMovement {
  transNum: number;
  transType: number;
  baseRef: string | null;
  itemCode: string;
  warehouse: string;
  qty: number;
  createdAt: string | null;
}

export interface InventoryCountingInput {
  reference: string;
  countDate: string; // YYYY-MM-DD
  lines: { itemCode: string; warehouse: string; countedQty: number }[];
}

/**
 * Everything the app needs from SAP B1. Reads are read-only;
 * the only write is creating an Inventory Counting document, which does not change stock.
 */
export interface SapGateway {
  readonly mode: 'mock' | 'live';
  loadSnapshot(warehouses: string[]): Promise<{ rows: SnapshotRow[]; lastTransNum: number }>;
  getMovementsSince(warehouses: string[], transNum: number): Promise<StockMovement[]>;
  createInventoryCounting(input: InventoryCountingInput): Promise<{ docEntry: number; docNum: number }>;
  close(): Promise<void>;
}
