/**
 * Acceptance scenarios from the spec, §17 (A–H), exercised end-to-end through the HTTP API.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/db/database.js';
import { buildApp, createServices } from '../src/http/app.js';
import { MockSapGateway } from '../src/sap/mock.js';

const WAREHOUSES = [
  { code: '15', name: 'מחסן מעבדה' },
  { code: '151', name: 'מחסן צבר' },
];

let app: FastifyInstance;
let sap: MockSapGateway;

async function login(username: string, pin: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, pin } });
  expect(res.statusCode, res.body).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'ic_session')!;
  return { cookie: `ic_session=${cookie.value}`, user: res.json().user };
}

function call(cookie: string) {
  return async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object, headers: { cookie } });
    return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.rawPayload };
  };
}

let mgr: ReturnType<typeof call>;
let alice: ReturnType<typeof call>;
let bob: ReturnType<typeof call>;
let aliceId: number;
let bobId: number;
let roundId: number;
let zones: { id: number; warehouse: string; name: string }[];

beforeEach(async () => {
  const db = openDatabase(':memory:');
  sap = new MockSapGateway();
  const services = createServices(db, sap, { warehouses: WAREHOUSES });
  await services.users.ensureBootstrapAdmin('admin', '9999');
  app = await buildApp({ services, sapMode: 'mock', cookieSecure: false });

  mgr = call((await login('admin', '9999')).cookie);
  aliceId = (await mgr('POST', '/api/users', { username: 'alice', displayName: 'אליס', role: 'counter', pin: '1111' })).body.user.id;
  bobId = (await mgr('POST', '/api/users', { username: 'bob', displayName: 'בוב', role: 'counter', pin: '2222' })).body.user.id;

  const created = await mgr('POST', '/api/rounds', {
    name: 'ספירה שנתית',
    warehouses: ['15', '151'],
    zones: [
      { warehouse: '15', name: 'מדפים A' },
      { warehouse: '151', name: 'משטחים צפון' },
      { warehouse: '151', name: 'משטחים דרום' },
    ],
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  roundId = created.body.round.id;
  zones = (await mgr('GET', `/api/rounds/${roundId}`)).body.zones;
  const zone = (wh: string, name: string) => zones.find((z) => z.warehouse === wh && z.name === name)!.id;

  await mgr('POST', `/api/rounds/${roundId}/assignments`, { userId: aliceId, zoneId: zone('151', 'משטחים צפון') });
  await mgr('POST', `/api/rounds/${roundId}/assignments`, { userId: bobId, zoneId: zone('151', 'משטחים דרום') });
  alice = call((await login('alice', '1111')).cookie);
  bob = call((await login('bob', '2222')).cookie);
});

const count = (who: ReturnType<typeof call>, itemCode: string, qty: number, extra: object = {}) =>
  who('POST', `/api/rounds/${roundId}/counts`, { id: randomUUID(), itemCode, qty, ...extra });

describe('spec §17 acceptance scenarios', () => {
  it('A: warehouses are fully separated', async () => {
    // alice counts 12 in 151, manager counts 4 in 15
    expect((await count(alice, '1111', 12)).body.result.sapQty).toBe(35);
    const m15 = await mgr('POST', `/api/rounds/${roundId}/counts`, { id: randomUUID(), itemCode: '1111', qty: 4, warehouse: '15' });
    expect(m15.body.result.sapQty).toBe(20);

    const items = (await mgr('GET', `/api/rounds/${roundId}/items?q=1111`)).body.items;
    const w15 = items.find((i: { warehouse: string }) => i.warehouse === '15');
    const w151 = items.find((i: { warehouse: string }) => i.warehouse === '151');
    expect([w15.counted, w15.diff]).toEqual([4, -16]);
    expect([w151.counted, w151.diff]).toEqual([12, -23]);
  });

  it('B: zero-balance item is hidden from the main list, findable, and reported as +8', async () => {
    const main = (await alice('GET', `/api/rounds/${roundId}/search?q=`)).body.items;
    expect(main.some((i: { itemCode: string }) => i.itemCode === '2222')).toBe(false);

    const found = (await alice('GET', `/api/rounds/${roundId}/lookup?code=7290000002222`)).body.item;
    expect(found.itemCode).toBe('2222');

    const r = (await count(alice, '2222', 8)).body.result;
    expect(r.sapQty).toBe(0);
    expect(r.comparison).toBe('higher');

    const zero = (await mgr('GET', `/api/rounds/${roundId}/items?filter=zero_found`)).body.items;
    expect(zero).toHaveLength(1);
    expect(zero[0]).toMatchObject({ itemCode: '2222', warehouse: '151', diff: 8 });
  });

  it('C: item missing in SAP can be reported as an exception and reaches the manager', async () => {
    const miss = (await alice('GET', `/api/rounds/${roundId}/lookup?code=999999999`)).body.item;
    expect(miss).toBeNull();
    const notInSap = await count(alice, 'NO-SUCH', 3);
    expect(notInSap.status).toBe(404);

    const ex = await alice('POST', `/api/rounds/${roundId}/exceptions`, {
      id: randomUUID(),
      barcode: '999999999',
      description: 'קרטון מיקסרים ללא מדבקה',
      qty: 6,
    });
    expect(ex.status).toBe(200);
    const list = (await mgr('GET', `/api/rounds/${roundId}/exceptions`)).body.exceptions;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ description: 'קרטון מיקסרים ללא מדבקה', qty: 6, reviewStatus: 'pending', userName: 'אליס' });
  });

  it('D: logout and login again — all actions are there, nothing lost or duplicated', async () => {
    await count(alice, '1111', 5);
    await count(alice, '1111', 7);
    await count(alice, '1111', 3);
    const again = call((await login('alice', '1111')).cookie);
    const mine = (await again('GET', `/api/rounds/${roundId}/my-actions`)).body.actions;
    expect(mine.map((a: { qty: number }) => a.qty).sort()).toEqual([3, 5, 7]);
    const item = (await mgr('GET', `/api/rounds/${roundId}/items?q=1111&warehouse=151`)).body.items[0];
    expect(item.counted).toBe(15);
  });

  it('E: parallel counters accumulate per counter and zone, nothing overwritten, multi-zone flagged', async () => {
    await count(alice, '1111', 5);
    await count(bob, '1111', 7);
    await count(alice, '1111', 3);
    const h = (await mgr('GET', `/api/rounds/${roundId}/items/151/1111`)).body;
    expect(h.summary.counted).toBe(15);
    expect(h.actions.map((a: { userName: string; zoneName: string }) => `${a.userName}:${a.zoneName}`)).toEqual([
      'אליס:משטחים צפון',
      'בוב:משטחים דרום',
      'אליס:משטחים צפון',
    ]);
    const multi = (await mgr('GET', `/api/rounds/${roundId}/items?filter=multi_zone`)).body.items;
    expect(multi.map((i: { itemCode: string }) => i.itemCode)).toEqual(['1111']);
  });

  it('F: counter never receives the SAP quantity before saving', async () => {
    const search = (await alice('GET', `/api/rounds/${roundId}/search?q=1111`)).body.items[0];
    const lookup = (await alice('GET', `/api/rounds/${roundId}/lookup?code=1111`)).body.item;
    for (const blind of [search, lookup]) {
      expect(JSON.stringify(blind)).not.toMatch(/sap|35/i);
    }
    const r = (await count(alice, '1111', 30)).body.result;
    expect(r).toMatchObject({ sapQty: 35, totalCounted: 30, comparison: 'lower' });
    // counters cannot reach manager endpoints that expose quantities
    expect((await alice('GET', `/api/rounds/${roundId}/items`)).status).toBe(403);
    expect((await alice('GET', `/api/rounds/${roundId}/dashboard`)).status).toBe(403);
  });

  it('G: freeze control blocks closing when SAP stock moved during the round', async () => {
    await count(alice, '1111', 35);
    expect((await mgr('POST', `/api/rounds/${roundId}/status`, { status: 'review' })).status).toBe(200);
    expect((await mgr('GET', `/api/rounds/${roundId}/freeze-check`)).body.clean).toBe(true);

    sap.simulateMovement('1111', '151', -2);
    const blocked = await mgr('POST', `/api/rounds/${roundId}/status`, { status: 'closed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('FREEZE_VIOLATION');
    expect(blocked.body.error.details.movements[0]).toMatchObject({ itemCode: '1111', warehouse: '151', qty: -2 });

    const forced = await mgr('POST', `/api/rounds/${roundId}/status`, {
      status: 'closed',
      acknowledgeMovements: true,
      note: 'תנועה נבדקה',
    });
    expect(forced.body.round.status).toBe('closed');
  });

  it('H: double tap / retry with the same action id creates exactly one record', async () => {
    const id = randomUUID();
    const payload = { id, itemCode: '1111', qty: 4 };
    const [a, b] = await Promise.all([
      alice('POST', `/api/rounds/${roundId}/counts`, payload),
      alice('POST', `/api/rounds/${roundId}/counts`, payload),
    ]);
    const c = await alice('POST', `/api/rounds/${roundId}/counts`, payload);
    expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
    expect(c.body.result.duplicate).toBe(true);
    expect((await mgr('GET', `/api/rounds/${roundId}/items/151/1111`)).body.actions).toHaveLength(1);
  });
});

describe('review flow and SAP document', () => {
  it('recount is stored separately, manager approves, and the SAP document uses approved quantities', async () => {
    await count(alice, '1111', 12);
    await mgr('POST', `/api/rounds/${roundId}/status`, { status: 'review' });

    // regular counting is blocked in review…
    expect((await count(bob, 'OIG-1000', 3)).body.error.code).toBe('ROUND_NOT_ACTIVE');
    // …but an item marked for recount can be counted
    await mgr('POST', `/api/rounds/${roundId}/recounts`, { warehouse: '151', itemCode: '1111', assignedTo: bobId });
    const re = (await count(bob, '1111', 14)).body.result;
    expect(re).toMatchObject({ type: 'recount', totalCounted: 12, totalRecounted: 14 });
    // recount assigned to bob: alice cannot do it
    expect((await count(alice, '1111', 1)).status).toBe(403);

    await mgr('POST', `/api/rounds/${roundId}/approvals`, { warehouse: '151', itemCode: '1111', qty: 14, note: 'אומת' });
    const h = (await mgr('GET', `/api/rounds/${roundId}/items/151/1111`)).body;
    expect(h.summary).toMatchObject({ counted: 12, recounted: 14, approvedQty: 14, finalQty: 14, state: 'approved' });
    expect(h.recounts[0].status).toBe('done');

    await mgr('POST', `/api/rounds/${roundId}/status`, { status: 'closed' });
    const preview = (await mgr('GET', `/api/rounds/${roundId}/sap-preview`)).body;
    expect(preview.lines).toBe(1);
    const sent = await mgr('POST', `/api/rounds/${roundId}/send-to-sap`);
    expect(sent.status).toBe(200);
    expect(sap.createdDocuments[0]!.lines).toEqual([{ itemCode: '1111', warehouse: '151', countedQty: 14 }]);
    expect((await mgr('POST', `/api/rounds/${roundId}/send-to-sap`)).status).toBe(409);
    expect((await mgr('POST', `/api/rounds/${roundId}/status`, { status: 'review' })).status).toBe(409);
  });

  it('cancel keeps history and removes the quantity from totals', async () => {
    const r = (await count(alice, '1111', 9)).body.result;
    await count(alice, '1111', 2);
    expect((await bob('POST', `/api/counts/${r.actionId}/cancel`, { reason: 'x' })).status).toBe(403);
    expect((await alice('POST', `/api/counts/${r.actionId}/cancel`, { reason: 'נספר פעמיים' })).status).toBe(200);
    const h = (await mgr('GET', `/api/rounds/${roundId}/items/151/1111`)).body;
    expect(h.summary.counted).toBe(2);
    expect(h.actions).toHaveLength(2);
    expect(h.actions[0]).toMatchObject({ status: 'cancelled', cancelReason: 'נספר פעמיים' });
  });

  it('paused round rejects counts; second active round on the same warehouse is rejected', async () => {
    await mgr('POST', `/api/rounds/${roundId}/status`, { status: 'paused' });
    expect((await count(alice, '1111', 1)).body.error.code).toBe('ROUND_NOT_ACTIVE');
    const dup = await mgr('POST', '/api/rounds', { name: 'כפול', warehouses: ['151'], zones: [] });
    expect(dup.status).toBe(409);
  });

  it('reports export as xlsx', async () => {
    await count(alice, '1111', 12);
    const res = await app.inject({
      method: 'GET',
      url: `/api/rounds/${roundId}/reports/differences`,
      headers: { cookie: (await login('admin', '9999')).cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });

  it('auth: wrong PIN rejected, lockout after 5 failures, counters cannot manage users', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', pin: '0000' } });
      expect(r.statusCode).toBe(401);
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', pin: '2222' } });
    expect(locked.statusCode).toBe(429);
    expect((await alice('POST', '/api/users', { username: 'x', displayName: 'x', role: 'manager', pin: '1234' })).status).toBe(403);
  });
});

describe('phase B: exception photo and printable reports', () => {
  // Smallest valid JPEG header + filler: enough for signature validation.
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
  const exception = (who: ReturnType<typeof call>, extra: object = {}) =>
    who('POST', `/api/rounds/${roundId}/exceptions`, { id: randomUUID(), description: 'קרטון ללא מדבקה', qty: 2, ...extra });

  it('stores a photo with the exception and serves it to managers only', async () => {
    const r = await exception(alice, { photo: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.hasPhoto).toBe(true);

    const list = (await mgr('GET', `/api/rounds/${roundId}/exceptions`)).body.exceptions;
    expect(list[0].hasPhoto).toBe(1);

    const img = await mgr('GET', `/api/rounds/${roundId}/exceptions/${r.body.id}/photo`);
    expect(img.status).toBe(200);
    expect(Buffer.compare(img.body as Buffer, jpeg)).toBe(0);
    expect((await alice('GET', `/api/rounds/${roundId}/exceptions/${r.body.id}/photo`)).status).toBe(403);
  });

  it('rejects files that are not images, and saves nothing', async () => {
    const id = randomUUID();
    const bad = await alice('POST', `/api/rounds/${roundId}/exceptions`, {
      id,
      description: 'x',
      qty: 1,
      photo: Buffer.from('<script>alert(1)</script>').toString('base64'),
    });
    expect(bad.status).toBe(400);
    expect((await mgr('GET', `/api/rounds/${roundId}/exceptions`)).body.exceptions).toHaveLength(0);
  });

  it('exception without photo still works; photo endpoint says there is none', async () => {
    const r = await exception(alice);
    expect(r.body.hasPhoto).toBe(false);
    expect((await mgr('GET', `/api/rounds/${roundId}/exceptions/${r.body.id}/photo`)).status).toBe(404);
  });

  it('report data for the printable page matches the Excel source', async () => {
    await count(alice, '1111', 12);
    const rep = (await mgr('GET', `/api/rounds/${roundId}/report-data/differences`)).body;
    expect(rep.title).toBe('דוח הפרשים');
    expect(rep.round.id).toBe(roundId);
    const row = rep.sections[0].rows.find((r: { itemCode: string; warehouse: string }) => r.itemCode === '1111' && r.warehouse === '151');
    expect(row).toMatchObject({ sapQty: 35, finalQty: 12, diff: -23 });
    expect((await mgr('GET', `/api/rounds/${roundId}/report-data/nope`)).status).toBe(404);
    expect((await alice('GET', `/api/rounds/${roundId}/report-data/differences`)).status).toBe(403);
  });
});
