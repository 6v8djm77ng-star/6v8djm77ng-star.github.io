import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DB_PATH: z.string().default('./data/inventory.db'),
  COOKIE_SECURE: bool,
  BOOTSTRAP_ADMIN_USERNAME: z.string().default('admin'),
  BOOTSTRAP_ADMIN_PIN: z.string().optional(),
  WAREHOUSES: z.string().default('15:מחסן מעבדה,151:מחסן צבר'),
  SAP_MODE: z.enum(['mock', 'live']).default('mock'),
  SAP_SQL_SERVER: z.string().optional(),
  SAP_SQL_DATABASE: z.string().optional(),
  SAP_SQL_USER: z.string().optional(),
  SAP_SQL_PASSWORD: z.string().optional(),
  SAP_SQL_ENCRYPT: bool,
  SL_URL: z.string().optional(),
  SL_COMPANY_DB: z.string().optional(),
  SL_USER: z.string().optional(),
  SL_PASSWORD: z.string().optional(),
  SL_TLS_VERIFY: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
});

export type Config = z.infer<typeof schema> & {
  warehouses: { code: string; name: string }[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const warehouses = parsed.WAREHOUSES.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [code, ...name] = part.split(':');
      return { code: (code ?? '').trim(), name: name.join(':').trim() || (code ?? '').trim() };
    });
  if (warehouses.length === 0) throw new Error('WAREHOUSES must list at least one warehouse');
  if (parsed.SAP_MODE === 'live') {
    const missing = [
      'SAP_SQL_SERVER',
      'SAP_SQL_DATABASE',
      'SAP_SQL_USER',
      'SAP_SQL_PASSWORD',
      'SL_URL',
      'SL_COMPANY_DB',
      'SL_USER',
      'SL_PASSWORD',
    ].filter((k) => !parsed[k as keyof typeof parsed]);
    if (missing.length) throw new Error(`SAP_MODE=live requires: ${missing.join(', ')}`);
  }
  return { ...parsed, warehouses };
}
