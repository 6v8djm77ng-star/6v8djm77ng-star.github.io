import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { z, ZodError } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db/database.js';
import { CountingService } from '../domain/counting.js';
import { AppError } from '../domain/errors.js';
import { REPORTS, ReportService, type ReportType } from '../domain/reports.js';
import { ReviewService, type ItemFilter } from '../domain/review.js';
import { RoundService, type RoundStatus } from '../domain/rounds.js';
import { UserService, type User } from '../domain/users.js';
import type { SapGateway } from '../sap/types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

const COOKIE = 'ic_session';

export interface Services {
  users: UserService;
  rounds: RoundService;
  counting: CountingService;
  review: ReviewService;
  reports: ReportService;
}

export function createServices(db: Db, sap: SapGateway, cfg: Pick<Config, 'warehouses'>): Services {
  const users = new UserService(db);
  const rounds = new RoundService(db, sap, cfg.warehouses);
  const counting = new CountingService(db, rounds);
  const review = new ReviewService(db, rounds);
  const reports = new ReportService(db, rounds, review);
  return { users, rounds, counting, review, reports };
}

export async function buildApp(opts: {
  services: Services;
  sapMode: 'mock' | 'live';
  cookieSecure: boolean;
  webDist?: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  const { services: s } = opts;
  const app = Fastify({
    logger: opts.logger ? { level: 'info', redact: ['req.headers.cookie', 'req.body.pin'] } : false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });
  await app.register(cookie);
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req) => {
    req.user = s.users.userForToken(req.cookies[COOKIE]);
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: safeDetails(err) } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: 'נתונים לא תקינים', details: err.flatten() } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'VALIDATION', message: 'בקשה לא תקינה' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'שגיאה בשרת. הפעולה לא בוצעה.' } });
  });

  const auth = (role?: 'manager') => async (req: FastifyRequest) => {
    if (!req.user) throw new AppError('UNAUTHORIZED', 'יש להתחבר מחדש');
    if (role && req.user.role !== role) throw new AppError('FORBIDDEN', 'אין הרשאה לפעולה זו');
  };
  const anyUser = { preHandler: auth() };
  const manager = { preHandler: auth('manager') };
  const u = (req: FastifyRequest) => req.user!;
  const roundId = (req: FastifyRequest) => z.coerce.number().int().positive().parse((req.params as { id: string }).id);

  // ---------- health / meta ----------
  app.get('/api/health', async () => ({ ok: true, sapMode: opts.sapMode, time: new Date().toISOString() }));
  app.get('/api/meta', anyUser, async () => ({ warehouses: s.rounds.warehouses(), sapMode: opts.sapMode, reports: REPORTS }));

  // ---------- auth ----------
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ username: z.string().min(1).max(64), pin: z.string().min(1).max(16) }).parse(req.body);
    const { token, user, expires } = await s.users.login(body.username, body.pin);
    reply.setCookie(COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: opts.cookieSecure,
      expires: new Date(expires),
    });
    return { user };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    s.users.logout(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/auth/me', anyUser, async (req) => ({ user: u(req) }));

  // ---------- counter ----------
  app.get('/api/my/assignment', anyUser, async (req) => {
    const a = s.rounds.assignmentFor(u(req).id);
    if (!a) return { assignment: null };
    return { assignment: a, stats: s.counting.myStats(u(req), a.roundId) };
  });
  app.get('/api/rounds/:id/lookup', anyUser, async (req) => {
    const q = z.object({ code: z.string().max(64), warehouse: z.string().optional() }).parse(req.query);
    const ctx = s.counting.context(u(req), roundId(req), q.warehouse);
    return { item: s.counting.lookup(ctx, q.code) };
  });
  app.get('/api/rounds/:id/search', anyUser, async (req) => {
    const q = z.object({ q: z.string().max(100).default(''), warehouse: z.string().optional() }).parse(req.query);
    const ctx = s.counting.context(u(req), roundId(req), q.warehouse);
    return { items: s.counting.search(ctx, q.q) };
  });
  app.post('/api/rounds/:id/counts', anyUser, async (req) => {
    const body = z
      .object({
        id: z.string().uuid(),
        warehouse: z.string().optional(),
        itemCode: z.string().min(1).max(64),
        qty: z.number(),
        correction: z.boolean().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    return { result: s.counting.record(u(req), roundId(req), body) };
  });
  app.get('/api/rounds/:id/my-actions', anyUser, async (req) => ({ actions: s.counting.myActions(u(req), roundId(req)) }));
  app.post('/api/counts/:actionId/cancel', anyUser, async (req) => {
    const { actionId } = req.params as { actionId: string };
    const body = z.object({ reason: z.string().min(1).max(500) }).parse(req.body);
    return s.counting.cancel(u(req), actionId, body.reason);
  });
  // Larger body limit only here: the optional photo is sent inline (compressed on the device, max 3MB decoded).
  app.post('/api/rounds/:id/exceptions', { ...anyUser, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const body = z
      .object({
        id: z.string().uuid(),
        warehouse: z.string().optional(),
        code: z.string().max(64).optional(),
        barcode: z.string().max(64).optional(),
        description: z.string().min(1).max(300),
        qty: z.number(),
        notes: z.string().max(500).optional(),
        photo: z.string().max(4_500_000).optional(),
      })
      .parse(req.body);
    return s.counting.reportException(u(req), roundId(req), body);
  });

  // ---------- manager: rounds ----------
  app.get('/api/rounds', manager, async () => ({ rounds: s.rounds.list() }));
  app.post('/api/rounds', manager, async (req) => {
    const body = z
      .object({
        name: z.string().min(1).max(100),
        warehouses: z.array(z.string()).min(1),
        zones: z.array(z.object({ warehouse: z.string(), name: z.string().max(60) })).default([]),
      })
      .parse(req.body);
    return { round: await s.rounds.create(u(req), body) };
  });
  app.get('/api/rounds/:id', manager, async (req) => {
    const id = roundId(req);
    return { round: s.rounds.get(id), zones: s.rounds.zones(id), assignments: s.rounds.assignments(id) };
  });
  app.post('/api/rounds/:id/status', manager, async (req) => {
    const body = z
      .object({
        status: z.enum(['open', 'paused', 'review', 'closed']),
        acknowledgeMovements: z.boolean().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    return { round: await s.rounds.setStatus(u(req), roundId(req), body.status as RoundStatus, body) };
  });
  app.post('/api/rounds/:id/zones', manager, async (req) => {
    const body = z.object({ warehouse: z.string(), name: z.string().min(1).max(60) }).parse(req.body);
    return { zone: s.rounds.addZone(u(req), roundId(req), body.warehouse, body.name) };
  });
  app.post('/api/rounds/:id/assignments', manager, async (req) => {
    const body = z.object({ userId: z.number().int(), zoneId: z.number().int().nullable() }).parse(req.body);
    return { assignments: s.rounds.assign(u(req), roundId(req), body.userId, body.zoneId) };
  });
  app.get('/api/rounds/:id/freeze-check', manager, async (req) => s.rounds.freezeCheck(roundId(req)));
  app.get('/api/rounds/:id/sap-preview', manager, async (req) => s.rounds.sendPreview(roundId(req)));
  app.post('/api/rounds/:id/send-to-sap', manager, async (req) => s.rounds.sendToSap(u(req), roundId(req)));

  // ---------- manager: review ----------
  app.get('/api/rounds/:id/dashboard', manager, async (req) => s.review.dashboard(roundId(req)));
  app.get('/api/rounds/:id/items', manager, async (req) => {
    const q = z
      .object({
        filter: z.enum(['all', 'diff', 'not_counted', 'zero_found', 'multi_zone', 'recount', 'approved']).default('all'),
        warehouse: z.string().optional(),
        q: z.string().max(100).optional(),
      })
      .parse(req.query);
    return { items: s.review.items(roundId(req), { ...q, filter: q.filter as ItemFilter }) };
  });
  app.get('/api/rounds/:id/items/:warehouse/:itemCode', manager, async (req) => {
    const p = req.params as { warehouse: string; itemCode: string };
    return s.review.itemHistory(roundId(req), p.warehouse, p.itemCode);
  });
  app.post('/api/rounds/:id/recounts', manager, async (req) => {
    const body = z
      .object({
        warehouse: z.string(),
        itemCode: z.string(),
        assignedTo: z.number().int().nullable().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    return s.review.requestRecount(u(req), roundId(req), body);
  });
  app.post('/api/rounds/:id/approvals', manager, async (req) => {
    const body = z
      .object({ warehouse: z.string(), itemCode: z.string(), qty: z.number(), note: z.string().max(500).optional() })
      .parse(req.body);
    return s.review.approve(u(req), roundId(req), body);
  });
  app.post('/api/rounds/:id/approvals/revoke', manager, async (req) => {
    const body = z.object({ warehouse: z.string(), itemCode: z.string() }).parse(req.body);
    return s.review.revokeApproval(u(req), roundId(req), body.warehouse, body.itemCode);
  });
  app.get('/api/rounds/:id/exceptions', manager, async (req) => ({ exceptions: s.review.exceptions(roundId(req)) }));
  app.get('/api/rounds/:id/exceptions/:exId/photo', manager, async (req, reply: FastifyReply) => {
    const photo = s.review.exceptionPhoto(roundId(req), (req.params as { exId: string }).exId);
    reply.header('Content-Type', photo.mime).header('Cache-Control', 'private, max-age=3600');
    reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
    return reply.send(photo.data);
  });
  app.post('/api/rounds/:id/exceptions/:exId/resolve', manager, async (req) => {
    const body = z.object({ note: z.string().min(1).max(500) }).parse(req.body);
    return s.review.resolveException(u(req), roundId(req), (req.params as { exId: string }).exId, body.note);
  });
  app.get('/api/rounds/:id/report-data/:type', manager, async (req) => {
    return s.reports.table(roundId(req), (req.params as { type: string }).type as ReportType);
  });
  app.get('/api/rounds/:id/reports/:type', manager, async (req, reply: FastifyReply) => {
    const type = (req.params as { type: string }).type as ReportType;
    const { buffer, filename } = await s.reports.build(roundId(req), type);
    reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store');
    return reply.send(buffer);
  });

  // ---------- manager: users ----------
  app.get('/api/users', manager, async () => ({ users: s.users.list() }));
  const userBody = z.object({
    username: z.string(),
    displayName: z.string().min(1).max(60),
    role: z.enum(['counter', 'manager']),
    pin: z.string(),
  });
  app.post('/api/users', manager, async (req) => ({ user: await s.users.create(u(req).id, userBody.parse(req.body)) }));
  app.patch('/api/users/:userId', manager, async (req) => {
    const id = z.coerce.number().int().parse((req.params as { userId: string }).userId);
    const body = userBody.omit({ username: true }).partial().extend({ active: z.boolean().optional() }).parse(req.body);
    return { user: await s.users.update(u(req).id, id, body) };
  });

  // ---------- SPA ----------
  if (opts.webDist && existsSync(opts.webDist)) {
    await app.register(fastifyStatic, {
      root: opts.webDist,
      // Files are resolved per request (no startup file list), so a rebuilt frontend is served without a restart.
      wildcard: true,
      cacheControl: false,
      setHeaders: (res, path) => {
        // Hashed assets never change; index.html must always be revalidated after a deploy.
        res.setHeader('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'לא נמצא' } });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  return app;
}

function safeDetails(err: AppError) {
  // Never leak raw SAP/driver errors to the browser; they are logged server-side.
  if (err.code === 'SAP_ERROR') return undefined;
  return err.details;
}
