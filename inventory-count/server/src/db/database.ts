import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

/**
 * Ordered, append-only migrations. Never edit a released migration — add a new one.
 */
const migrations: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('counter','manager')),
    pin_hash      TEXT NOT NULL,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    expires_at  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE rounds (
    id                 INTEGER PRIMARY KEY,
    name               TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('open','paused','review','closed')),
    snapshot_trans_num INTEGER NOT NULL,
    snapshot_at        TEXT NOT NULL,
    created_by         INTEGER NOT NULL REFERENCES users(id),
    created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    closed_at          TEXT,
    closed_by          INTEGER REFERENCES users(id),
    sap_doc_entry      INTEGER,
    sap_doc_num        INTEGER,
    sap_sent_at        TEXT
  );

  CREATE TABLE round_warehouses (
    round_id   INTEGER NOT NULL REFERENCES rounds(id),
    warehouse  TEXT NOT NULL,
    PRIMARY KEY (round_id, warehouse)
  );

  CREATE TABLE zones (
    id        INTEGER PRIMARY KEY,
    round_id  INTEGER NOT NULL REFERENCES rounds(id),
    warehouse TEXT NOT NULL,
    name      TEXT NOT NULL,
    UNIQUE (round_id, warehouse, name)
  );

  CREATE TABLE assignments (
    round_id INTEGER NOT NULL REFERENCES rounds(id),
    user_id  INTEGER NOT NULL REFERENCES users(id),
    zone_id  INTEGER NOT NULL REFERENCES zones(id),
    PRIMARY KEY (round_id, user_id)
  );

  -- SAP stock frozen at round opening. All comparisons use this, never live SAP.
  CREATE TABLE snapshot_items (
    round_id   INTEGER NOT NULL REFERENCES rounds(id),
    warehouse  TEXT NOT NULL,
    item_code  TEXT NOT NULL,
    item_name  TEXT NOT NULL,
    barcodes   TEXT NOT NULL DEFAULT '',
    sap_qty    REAL NOT NULL,
    PRIMARY KEY (round_id, warehouse, item_code)
  );
  CREATE INDEX ix_snapshot_name ON snapshot_items(round_id, item_name);

  CREATE TABLE barcodes (
    round_id  INTEGER NOT NULL REFERENCES rounds(id),
    barcode   TEXT NOT NULL,
    item_code TEXT NOT NULL,
    PRIMARY KEY (round_id, barcode, item_code)
  );

  -- Append-only log. id is generated on the device => retries are idempotent.
  CREATE TABLE count_actions (
    id             TEXT PRIMARY KEY,
    round_id       INTEGER NOT NULL REFERENCES rounds(id),
    warehouse      TEXT NOT NULL,
    item_code      TEXT NOT NULL,
    zone_id        INTEGER REFERENCES zones(id),
    user_id        INTEGER NOT NULL REFERENCES users(id),
    qty            REAL NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('count','recount','correction')),
    status         TEXT NOT NULL DEFAULT 'saved' CHECK (status IN ('saved','cancelled')),
    note           TEXT,
    cancel_reason  TEXT,
    cancelled_by   INTEGER REFERENCES users(id),
    cancelled_at   TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX ix_actions_item ON count_actions(round_id, warehouse, item_code);
  CREATE INDEX ix_actions_user ON count_actions(round_id, user_id, created_at);

  CREATE TABLE exception_items (
    id           TEXT PRIMARY KEY,
    round_id     INTEGER NOT NULL REFERENCES rounds(id),
    warehouse    TEXT NOT NULL,
    zone_id      INTEGER REFERENCES zones(id),
    user_id      INTEGER NOT NULL REFERENCES users(id),
    code         TEXT,
    barcode      TEXT,
    description  TEXT NOT NULL,
    qty          REAL NOT NULL,
    notes        TEXT,
    review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','resolved')),
    review_note  TEXT,
    reviewed_by  INTEGER REFERENCES users(id),
    reviewed_at  TEXT,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE recount_requests (
    id          INTEGER PRIMARY KEY,
    round_id    INTEGER NOT NULL REFERENCES rounds(id),
    warehouse   TEXT NOT NULL,
    item_code   TEXT NOT NULL,
    assigned_to INTEGER REFERENCES users(id),
    note        TEXT,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
    created_by  INTEGER NOT NULL REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX ix_recount_item ON recount_requests(round_id, warehouse, item_code);

  CREATE TABLE approvals (
    round_id     INTEGER NOT NULL REFERENCES rounds(id),
    warehouse    TEXT NOT NULL,
    item_code    TEXT NOT NULL,
    approved_qty REAL NOT NULL,
    note         TEXT,
    approved_by  INTEGER NOT NULL REFERENCES users(id),
    approved_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (round_id, warehouse, item_code)
  );

  CREATE TABLE audit_log (
    id        INTEGER PRIMARY KEY,
    at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    user_id   INTEGER REFERENCES users(id),
    action    TEXT NOT NULL,
    entity    TEXT NOT NULL,
    entity_id TEXT,
    details   TEXT
  );
  `,
  // v2: photo of an exception item (stored in the DB so it is part of the daily backup)
  `
  CREATE TABLE exception_photos (
    exception_id TEXT PRIMARY KEY REFERENCES exception_items(id),
    mime         TEXT NOT NULL,
    size         INTEGER NOT NULL,
    data         BLOB NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
];

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: Db) {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export function audit(
  db: Db,
  userId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details?: unknown,
) {
  db.prepare(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?,?,?,?,?)',
  ).run(userId, action, entity, entityId === null ? null : String(entityId), details === undefined ? null : JSON.stringify(details));
}
