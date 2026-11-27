export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'אין חיבור לשרת. הפעולה לא נשמרה.');
  }
  if (res.ok) return (await res.json()) as T;
  let payload: { error?: { code: string; message: string; details?: unknown } } = {};
  try {
    payload = await res.json();
  } catch {
    /* non-JSON error */
  }
  if (res.status === 401) window.dispatchEvent(new Event('auth:expired'));
  throw new ApiError(
    res.status,
    payload.error?.code ?? 'HTTP',
    payload.error?.message ?? `שגיאה ${res.status}`,
    payload.error?.details,
  );
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
};

// ---------- shared types (mirror server responses) ----------
export type Role = 'counter' | 'manager';
export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
}
export type RoundStatus = 'open' | 'paused' | 'review' | 'closed';
export interface Round {
  id: number;
  name: string;
  status: RoundStatus;
  warehouses: string[];
  snapshotAt: string;
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
export interface Meta {
  warehouses: { code: string; name: string }[];
  sapMode: 'mock' | 'live';
  reports: Record<string, string>;
}
export type Comparison = 'higher' | 'lower' | 'match';
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
  type: 'count' | 'recount' | 'correction';
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
export interface MyAction {
  id: string;
  warehouse: string;
  itemCode: string;
  itemName: string;
  qty: number;
  type: 'count' | 'recount' | 'correction';
  status: 'saved' | 'cancelled';
  note: string | null;
  cancelReason: string | null;
  createdAt: string;
}
export interface MyAssignment {
  assignment: {
    roundId: number;
    roundName: string;
    status: RoundStatus;
    zoneId: number;
    zoneName: string;
    warehouse: string;
  } | null;
  stats?: { actions: number; items: number; units: number };
}
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
export interface Dashboard {
  round: Round;
  totals: {
    expected: number;
    counted: number;
    notCounted: number;
    progress: number;
    withDiff: number;
    zeroFound: number;
    multiZone: number;
    openRecounts: number;
    exceptionsPending: number;
    approved: number;
  };
  byWarehouse: { warehouse: string; expected: number; counted: number; progress: number; withDiff: number }[];
  byUser: { userId: number; displayName: string; zoneName: string | null; warehouse: string | null; actions: number; items: number; lastAt: string | null }[];
  byZone: { zoneId: number; zoneName: string; warehouse: string; actions: number; items: number; counters: number }[];
  recent: { id: string; warehouse: string; itemCode: string; itemName: string; qty: number; type: string; status: string; userName: string; zoneName: string | null; createdAt: string }[];
}
export interface ItemHistory {
  warehouse: string;
  itemCode: string;
  itemName: string;
  barcodes: string[];
  sapQty: number;
  summary: ItemRow | null;
  actions: { id: string; qty: number; type: string; status: string; note: string | null; cancelReason: string | null; createdAt: string; userName: string; zoneName: string | null; cancelledBy: string | null }[];
  recounts: { id: number; note: string | null; status: string; createdAt: string; createdBy: string; assignedTo: string | null }[];
  approval: { approvedQty: number; note: string | null; approvedAt: string; approvedBy: string } | null;
}
export interface ExceptionItem {
  id: string;
  warehouse: string;
  code: string | null;
  barcode: string | null;
  description: string;
  qty: number;
  notes: string | null;
  reviewStatus: 'pending' | 'resolved';
  reviewNote: string | null;
  createdAt: string;
  userName: string;
  zoneName: string | null;
  reviewedBy: string | null;
  hasPhoto: number | boolean;
}
export interface FreezeCheck {
  checkedAt: string;
  clean: boolean;
  movements: { transNum: number; transType: number; baseRef: string | null; itemCode: string; itemName: string; warehouse: string; qty: number; createdAt: string | null }[];
}

export interface ReportTable {
  type: string;
  title: string;
  round: { id: number; name: string; warehouses: string[]; snapshotAt: string; status: RoundStatus };
  generatedAt: string;
  sections: {
    name: string;
    columns: { header: string; key: string; width: number; numeric?: boolean }[];
    rows: Record<string, string | number | null>[];
  }[];
}
