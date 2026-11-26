import sql from 'mssql';
import https from 'node:https';
import type { Config } from '../config.js';
import type { InventoryCountingInput, SapGateway, SnapshotRow, StockMovement } from './types.js';

/**
 * Real SAP B1 gateway.
 *  - Reads: direct READ-ONLY SQL against the company DB (use a db_datareader login).
 *  - Write: Service Layer, Inventory Counting document only (does not change stock).
 */
export class LiveSapGateway implements SapGateway {
  readonly mode = 'live' as const;
  private pool: Promise<sql.ConnectionPool>;
  private slSession: { cookie: string; expires: number } | null = null;
  private agent: https.Agent;

  constructor(private cfg: Config) {
    this.pool = new sql.ConnectionPool({
      server: cfg.SAP_SQL_SERVER!,
      database: cfg.SAP_SQL_DATABASE!,
      user: cfg.SAP_SQL_USER!,
      password: cfg.SAP_SQL_PASSWORD!,
      options: { encrypt: cfg.SAP_SQL_ENCRYPT, trustServerCertificate: true, readOnlyIntent: true },
      pool: { max: 4 },
      requestTimeout: 60000,
    }).connect();
    this.agent = new https.Agent({ rejectUnauthorized: cfg.SL_TLS_VERIFY, keepAlive: true });
  }

  private async request() {
    return (await this.pool).request();
  }

  private bindWarehouses(req: sql.Request, warehouses: string[]) {
    return warehouses
      .map((w, i) => {
        req.input(`w${i}`, sql.NVarChar(8), w);
        return `@w${i}`;
      })
      .join(',');
  }

  async loadSnapshot(warehouses: string[]) {
    // READ-ONLY
    const req = await this.request();
    const inList = this.bindWarehouses(req, warehouses);
    const result = await req.query(`
      SELECT ISNULL(MAX(TransNum),0) AS LastTransNum FROM OINM WITH (NOLOCK);

      SELECT W.WhsCode, I.ItemCode, I.ItemName, I.CodeBars, W.OnHand
      FROM OITW W WITH (NOLOCK)
      JOIN OITM I WITH (NOLOCK) ON I.ItemCode = W.ItemCode
      WHERE W.WhsCode IN (${inList})
        AND I.InvntItem = 'Y'
        AND (W.OnHand <> 0 OR I.frozenFor = 'N');

      SELECT DISTINCT B.ItemCode, B.BcdCode
      FROM OBCD B WITH (NOLOCK)
      JOIN OITW W WITH (NOLOCK) ON W.ItemCode = B.ItemCode
      WHERE W.WhsCode IN (${inList});
    `);
    const sets = result.recordsets as unknown as Record<string, unknown>[][];
    const lastTransNum = Number(sets[0]?.[0]?.LastTransNum ?? 0);
    const extra = new Map<string, Set<string>>();
    for (const r of sets[2] ?? []) {
      const code = String(r.ItemCode);
      if (!extra.has(code)) extra.set(code, new Set());
      if (r.BcdCode) extra.get(code)!.add(String(r.BcdCode).trim());
    }
    const rows: SnapshotRow[] = (sets[1] ?? []).map((r) => {
      const code = String(r.ItemCode);
      const bc = new Set(extra.get(code) ?? []);
      if (r.CodeBars) bc.add(String(r.CodeBars).trim());
      return {
        warehouse: String(r.WhsCode),
        itemCode: code,
        itemName: String(r.ItemName ?? ''),
        barcodes: [...bc].filter(Boolean),
        onHand: Number(r.OnHand ?? 0),
      };
    });
    return { rows, lastTransNum };
  }

  async getMovementsSince(warehouses: string[], transNum: number): Promise<StockMovement[]> {
    // READ-ONLY
    const req = await this.request();
    const inList = this.bindWarehouses(req, warehouses);
    req.input('t', sql.Int, transNum);
    const result = await req.query(`
      SELECT TOP 500 TransNum, TransType, BASE_REF, ItemCode, Warehouse,
             (InQty - OutQty) AS Qty, CreateDate
      FROM OINM WITH (NOLOCK)
      WHERE TransNum > @t AND Warehouse IN (${inList})
      ORDER BY TransNum`);
    return result.recordset.map((r: Record<string, unknown>) => ({
      transNum: Number(r.TransNum),
      transType: Number(r.TransType),
      baseRef: r.BASE_REF == null ? null : String(r.BASE_REF),
      itemCode: String(r.ItemCode),
      warehouse: String(r.Warehouse),
      qty: Number(r.Qty),
      createdAt: r.CreateDate ? new Date(r.CreateDate as string).toISOString() : null,
    }));
  }

  private async sl(method: string, path: string, body?: unknown, retry = true): Promise<unknown> {
    if (!this.slSession || Date.now() > this.slSession.expires) await this.slLogin();
    const res = await this.slFetch(method, path, body, this.slSession!.cookie);
    if (res.status === 401 && retry) {
      this.slSession = null;
      return this.sl(method, path, body, false);
    }
    if (res.status >= 400) {
      throw new Error(`Service Layer ${method} ${path} failed (${res.status}): ${res.body.slice(0, 500)}`);
    }
    return res.body ? JSON.parse(res.body) : null;
  }

  private async slLogin() {
    const res = await this.slFetch('POST', '/Login', {
      CompanyDB: this.cfg.SL_COMPANY_DB,
      UserName: this.cfg.SL_USER,
      Password: this.cfg.SL_PASSWORD,
    });
    if (res.status >= 400) throw new Error(`Service Layer login failed (${res.status})`);
    const cookies = res.setCookie.map((c) => c.split(';')[0]).join('; ');
    const timeoutMin = Number(JSON.parse(res.body).SessionTimeout ?? 30);
    this.slSession = { cookie: cookies, expires: Date.now() + (timeoutMin - 2) * 60000 };
  }

  private slFetch(method: string, path: string, body?: unknown, cookie?: string) {
    const url = new URL(this.cfg.SL_URL!.replace(/\/$/, '') + path);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<{ status: number; body: string; setCookie: string[] }>((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          agent: this.agent,
          headers: {
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          },
          timeout: 120000,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (c) => (data += c));
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, body: data, setCookie: res.headers['set-cookie'] ?? [] }),
          );
        },
      );
      req.on('timeout', () => req.destroy(new Error('Service Layer timeout')));
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  async createInventoryCounting(input: InventoryCountingInput) {
    const doc = (await this.sl('POST', '/InventoryCountings', {
      CountDate: input.countDate,
      Reference2: input.reference.slice(0, 11),
      Remarks: input.reference,
      InventoryCountingLines: input.lines.map((l) => ({
        ItemCode: l.itemCode,
        WarehouseCode: l.warehouse,
        CountedQuantity: l.countedQty,
        Counted: 'tYES',
      })),
    })) as { DocumentEntry: number; DocumentNumber: number };
    return { docEntry: doc.DocumentEntry, docNum: doc.DocumentNumber };
  }

  async close() {
    await (await this.pool).close();
  }
}
