import { readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { buildApp, createServices } from './http/app.js';
import { createSapGateway } from './sap/index.js';

loadDotEnv();
const cfg = loadConfig();
const here = dirname(fileURLToPath(import.meta.url));
const db = openDatabase(resolve(cfg.DB_PATH));
const sap = createSapGateway(cfg);
const services = createServices(db, sap, cfg);

if (await services.users.ensureBootstrapAdmin(cfg.BOOTSTRAP_ADMIN_USERNAME, cfg.BOOTSTRAP_ADMIN_PIN)) {
  console.log(`Created first manager "${cfg.BOOTSTRAP_ADMIN_USERNAME}". Change the PIN after first login.`);
}

const app = await buildApp({
  services,
  sapMode: cfg.SAP_MODE,
  cookieSecure: cfg.COOKIE_SECURE,
  webDist: resolve(here, '../../web/dist'),
  logger: true,
});

await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info(`SAP mode: ${cfg.SAP_MODE}`);

// Daily online backup (consistent while running, WAL-safe). Keeps the last 14 copies.
const backupDir = resolve(dirname(resolve(cfg.DB_PATH)), 'backups');
const runBackup = async () => {
  try {
    mkdirSync(backupDir, { recursive: true });
    const file = resolve(backupDir, `inventory-${new Date().toISOString().slice(0, 10)}.db`);
    await db.backup(file);
    const old = readdirSync(backupDir).filter((f) => f.startsWith('inventory-') && f.endsWith('.db')).sort().slice(0, -14);
    old.forEach((f) => unlinkSync(resolve(backupDir, f)));
    app.log.info(`Backup written: ${file}`);
  } catch (e) {
    app.log.error(e, 'Backup failed');
  }
};
void runBackup();
const backupTimer = setInterval(() => void runBackup(), 24 * 3600 * 1000);
backupTimer.unref();

const shutdown = async (signal: string) => {
  app.log.info(`${signal} received, shutting down`);
  await app.close();
  await sap.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

/** Minimal .env loader (no extra dependency). Real env vars win. */
function loadDotEnv() {
  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const [, key, raw] = m;
    if (process.env[key!] !== undefined) continue;
    process.env[key!] = raw!.replace(/^(['"])(.*)\1$/, '$2');
  }
}
