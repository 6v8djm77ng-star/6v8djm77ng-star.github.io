'use strict';
// OIG access gate.
// Sits between Tailscale Funnel and internal apps. Only enrolled devices pass;
// everyone else gets a plain 404. Optional passkey mode (Face ID / Windows Hello).
// No external dependencies — Node core only.

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CONFIG_FILE = path.join(DIR, 'gate-config.json');
const STATE_FILE = path.join(DIR, 'gate-state.json');
const SECRET_FILE = path.join(DIR, 'gate-secret.key');
const LOG_FILE = path.join(DIR, 'gate.log');
const LOG_MAX_BYTES = 10 * 1024 * 1024;

const DEFAULT_CONFIG = {
  // 'link'    = enrolled device cookie is enough
  // 'passkey' = enrolled device + Face ID / Windows Hello every sessionDays
  mode: 'link',
  // Set by: node gate.js init --host <machine>.<tailnet>.ts.net
  rpId: '',
  origins: [],
  enrollBaseUrl: '',
  deviceDays: 365,
  sessionDays: 30,
  linkMinutes: 30,
  passkeySetupMinutes: 15,
  listeners: [
    { name: 'sap-bi', port: 4801, target: 'http://127.0.0.1:3001' },
    { name: 'logistics-hub', port: 4802, target: 'http://127.0.0.1:4000' }
  ]
};

const DEV_COOKIE = '__Host-oig_dev';
const SES_COOKIE = '__Host-oig_ses';
const DAY = 86400000;

// ---------- utils ----------

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const now = () => Date.now();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

function log(event, fields) {
  try {
    try {
      if (fs.statSync(LOG_FILE).size > LOG_MAX_BYTES) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    } catch {}
    fs.appendFileSync(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), event, ...fields }) + '\n');
  } catch {}
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

// Trustworthy source IP for allow-list decisions. Tailscale Funnel appends the
// real client IP as the last X-Forwarded-For hop, so a client-prepended value
// cannot shift it; fall back to the socket peer when no header is present.
function trustedIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ip = xff.length ? xff[xff.length - 1] : String(req.socket.remoteAddress || '');
  return ip.replace(/^::ffff:/, '');
}

// A request matches a listener's publicPaths when its path equals or sits under
// a configured prefix. Such a path skips the passkey gate but is served only to
// the configured source IPs (empty allowIps = served to no one).
function publicRoute(liveListener, pathname) {
  for (const pp of liveListener.publicPaths || []) {
    if (pp.path && (pathname === pp.path || pathname.startsWith(pp.path + '/'))) return pp;
  }
  return null;
}

// ---------- config / state / secret ----------

function loadConfig() {
  return { ...DEFAULT_CONFIG, ...readJson(CONFIG_FILE, {}) };
}

function loadSecret() {
  if (!fs.existsSync(SECRET_FILE)) throw new Error('Missing gate-secret.key — run: node gate.js init');
  return Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'base64url');
}

let stateCache = null;
let stateMtime = 0;

// State is re-read when the file changes, so CLI commands (link/revoke/mode) apply without restart.
function getState() {
  let mtime = 0;
  try { mtime = fs.statSync(STATE_FILE).mtimeMs; } catch {}
  if (!stateCache || mtime !== stateMtime) {
    stateCache = readJson(STATE_FILE, { devices: {}, links: {} });
    stateCache.devices = stateCache.devices || {};
    stateCache.links = stateCache.links || {};
    stateMtime = mtime;
  }
  return stateCache;
}

function saveState(state) {
  writeJsonAtomic(STATE_FILE, state);
  stateCache = state;
  try { stateMtime = fs.statSync(STATE_FILE).mtimeMs; } catch {}
}

// ---------- signed cookies ----------

function sign(secret, name, payload) {
  const p = b64u(JSON.stringify(payload));
  const s = b64u(crypto.createHmac('sha256', secret).update(name + '.' + p).digest());
  return p + '.' + s;
}

function verify(secret, name, value) {
  if (!value || typeof value !== 'string') return null;
  const [p, s] = value.split('.');
  if (!p || !s) return null;
  const expected = crypto.createHmac('sha256', secret).update(name + '.' + p).digest();
  const got = unb64u(s);
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
  try {
    const payload = JSON.parse(unb64u(p).toString('utf8'));
    if (!payload.e || payload.e < now()) return null;
    return payload;
  } catch { return null; }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function stripGateCookies(header) {
  return String(header || '')
    .split(';')
    .filter((c) => { const n = c.split('=')[0].trim(); return n && n !== DEV_COOKIE && n !== SES_COOKIE; })
    .join(';').trim();
}

function cookieHeader(name, value, days) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(days * 86400)}`;
}

// ---------- auth ----------

function authOf(req, ctx) {
  const cookies = parseCookies(req.headers.cookie);
  const dev = verify(ctx.secret, DEV_COOKIE, cookies[DEV_COOKIE]);
  const device = dev && getState().devices[dev.d];
  if (!device || device.revoked) return { device: null, deviceId: null, session: false };
  const ses = verify(ctx.secret, SES_COOKIE, cookies[SES_COOKIE]);
  return { device, deviceId: dev.d, session: !!(ses && ses.d === dev.d) };
}

function isAllowed(auth, config) {
  if (!auth.device) return false;
  if (config.mode === 'passkey') return auth.session && !!auth.device.cred;
  return true;
}

// Per-device app scoping. A device with no `apps` array reaches every listener
// (backward compatible); one with `apps` reaches only the named listeners.
function appAllowed(device, listenerName) {
  if (!device) return false;
  if (!Array.isArray(device.apps)) return true;
  return device.apps.includes(listenerName);
}

// Parse a CLI apps argument: "all"/"*"/empty -> undefined (all apps),
// otherwise a comma-separated list validated against the configured listeners.
function parseApps(arg, config) {
  if (arg == null || arg === '' || arg === 'all' || arg === '*') return undefined;
  const names = new Set(config.listeners.map((l) => l.name));
  const apps = arg.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = apps.filter((a) => !names.has(a));
  if (bad.length) throw new Error('unknown app(s): ' + bad.join(', ') + '  (known: ' + [...names].join(', ') + ')');
  return apps;
}

// ---------- WebAuthn (passkeys) ----------

const challenges = new Map(); // challenge(b64u) -> { deviceId, type, exp }

function newChallenge(deviceId, type) {
  for (const [k, v] of challenges) if (v.exp < now()) challenges.delete(k);
  const c = b64u(crypto.randomBytes(32));
  challenges.set(c, { deviceId, type, exp: now() + 5 * 60000 });
  return c;
}

function checkClientData(clientDataB64, expectedType, deviceId, config) {
  const raw = unb64u(clientDataB64);
  const cd = JSON.parse(raw.toString('utf8'));
  if (cd.type !== expectedType) throw new Error('clientData type');
  if (!config.origins.includes(cd.origin)) throw new Error('origin ' + cd.origin);
  const ch = challenges.get(cd.challenge);
  if (!ch || ch.exp < now() || ch.deviceId !== deviceId || ch.type !== expectedType) throw new Error('challenge');
  challenges.delete(cd.challenge);
  return raw;
}

function checkAuthData(authDataB64, config) {
  const ad = unb64u(authDataB64);
  if (ad.length < 37) throw new Error('authData length');
  if (!ad.subarray(0, 32).equals(sha256(config.rpId))) throw new Error('rpIdHash');
  const flags = ad[32];
  if (!(flags & 0x01)) throw new Error('user not present');
  if (!(flags & 0x04)) throw new Error('user not verified');
  return { ad, signCount: ad.readUInt32BE(33) };
}

function verifyRegistration(body, deviceId, config) {
  checkClientData(body.clientDataJSON, 'webauthn.create', deviceId, config);
  checkAuthData(body.authenticatorData, config);
  if (![-7, -257].includes(body.alg)) throw new Error('alg ' + body.alg);
  const spki = unb64u(body.publicKey);
  crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' }); // throws if malformed
  return { id: String(body.id), spki: b64u(spki), alg: body.alg, signCount: 0 };
}

function verifyAssertion(body, deviceId, cred, config) {
  if (String(body.id) !== cred.id) throw new Error('credential id');
  const clientRaw = checkClientData(body.clientDataJSON, 'webauthn.get', deviceId, config);
  const { ad, signCount } = checkAuthData(body.authenticatorData, config);
  const data = Buffer.concat([ad, sha256(clientRaw)]);
  const key = crypto.createPublicKey({ key: unb64u(cred.spki), format: 'der', type: 'spki' });
  if (!crypto.verify('sha256', data, key, unb64u(body.signature))) throw new Error('signature');
  // Apple/iCloud passkeys report signCount 0; only enforce when the authenticator counts.
  if (signCount !== 0 && cred.signCount !== 0 && signCount <= cred.signCount) throw new Error('signCount');
  return signCount;
}

// ---------- pages ----------

const PAGE_JS = `
const enc = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const dec = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/') + '==='.slice((s.length+3)%4)), c => c.charCodeAt(0));
async function post(u, b) {
  const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}), credentials: 'same-origin' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
}
function msg(t) { document.getElementById('msg').textContent = t; }
async function registerPasskey() {
  try {
    const o = await post('/__gate/passkey/register-options');
    const c = await navigator.credentials.create({ publicKey: {
      challenge: dec(o.challenge), rp: { id: o.rpId, name: 'OIG' },
      user: { id: dec(o.userId), name: o.userName, displayName: o.userName },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none', timeout: 60000 } });
    const r = c.response;
    await post('/__gate/passkey/register', { id: c.id, clientDataJSON: enc(r.clientDataJSON),
      authenticatorData: enc(r.getAuthenticatorData()), publicKey: enc(r.getPublicKey()), alg: r.getPublicKeyAlgorithm() });
    msg('נרשם בהצלחה'); setTimeout(() => location.href = '/', 800);
  } catch (e) { msg('שגיאה: ' + e.message); }
}
async function loginPasskey() {
  try {
    const o = await post('/__gate/passkey/login-options');
    const a = await navigator.credentials.get({ publicKey: {
      challenge: dec(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 60000,
      allowCredentials: [{ type: 'public-key', id: dec(o.credId) }] } });
    const r = a.response;
    const res = await post('/__gate/passkey/login', { id: a.id, clientDataJSON: enc(r.clientDataJSON),
      authenticatorData: enc(r.authenticatorData), signature: enc(r.signature) });
    location.href = res.redirect || '/';
  } catch (e) { msg('שגיאה: ' + e.message); }
}`;

function page(title, body) {
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${title}</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#f4f5f7;color:#111;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{background:#fff;padding:28px 24px;border-radius:14px;max-width:360px;width:calc(100% - 32px);box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
button,a.b{display:block;width:100%;box-sizing:border-box;padding:14px;margin-top:12px;border:0;border-radius:10px;font-size:17px;cursor:pointer;text-decoration:none}
.p{background:#111;color:#fff}.s{background:#e8e9ec;color:#111}#msg{margin-top:14px;min-height:20px;color:#b00}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}.c{background:#1c1c1e}.s{background:#2c2c2e;color:#eee}.p{background:#eee;color:#111}}
</style></head><body><div class="c">${body}<div id="msg"></div></div><script>${PAGE_JS}</script></body></html>`;
}

// ---------- HTTP helpers ----------

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', ...headers });
  res.end(body);
}
const notFound = (res) => send(res, 404, 'Not Found', { 'content-type': 'text/plain' });
const json = (res, status, obj, headers) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json', ...headers });
const html = (res, body, headers) => send(res, 200, body, { 'content-type': 'text/html; charset=utf-8', ...headers });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 65536) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const hits = new Map(); // ip -> { n, start }
function rateLimited(ip) {
  const h = hits.get(ip);
  if (!h || now() - h.start > 10 * 60000) { hits.set(ip, { n: 1, start: now() }); return false; }
  return ++h.n > 30;
}

// ---------- gate routes ----------

async function handleGate(req, res, ctx, url) {
  const { config, secret } = ctx;
  const ip = clientIp(req);
  if (rateLimited(ip)) { log('rate_limited', { ip, path: url.pathname }); return send(res, 429, 'Too Many Requests'); }
  const auth = authOf(req, ctx);
  const p = url.pathname;

  if (p === '/__gate/enroll' && req.method === 'GET') {
    const token = url.searchParams.get('t') || '';
    const state = getState();
    const key = b64u(sha256(token));
    const link = state.links[key];
    if (!token || !link || link.usedAt || link.exp < now()) {
      log('enroll_denied', { ip, ua: req.headers['user-agent'] });
      return notFound(res);
    }
    const deviceId = b64u(crypto.randomBytes(12));
    state.devices[deviceId] = { label: link.label, createdAt: new Date().toISOString(), enrolledAt: now(), ua: req.headers['user-agent'] || '' };
    if (Array.isArray(link.apps)) state.devices[deviceId].apps = link.apps;
    link.usedAt = new Date().toISOString();
    link.deviceId = deviceId;
    saveState(state);
    log('enrolled', { ip, deviceId, label: link.label });
    res.writeHead(302, {
      location: '/__gate/setup', 'cache-control': 'no-store',
      'set-cookie': [
        cookieHeader(DEV_COOKIE, sign(secret, DEV_COOKIE, { d: deviceId, e: now() + config.deviceDays * DAY }), config.deviceDays),
        cookieHeader(SES_COOKIE, sign(secret, SES_COOKIE, { d: deviceId, e: now() + config.sessionDays * DAY }), config.sessionDays)
      ]
    });
    return res.end();
  }

  if (!auth.device) { log('gate_denied', { ip, path: p }); return notFound(res); }
  const setupOpen = !auth.device.cred && now() - auth.device.enrolledAt < config.passkeySetupMinutes * 60000;

  if (p === '/__gate/setup' && req.method === 'GET') {
    const body = setupOpen
      ? `<h2>המכשיר אושר ✓</h2><p>מומלץ לרשום Face ID / Windows Hello למכשיר הזה (אפשרי ב-${config.passkeySetupMinutes} הדקות הקרובות).</p>
         <button class="p" onclick="registerPasskey()">רישום Face ID</button><a class="b s" href="/">המשך בלי</a>`
      : `<h2>המכשיר מאושר ✓</h2>${auth.device.cred ? '<p>Face ID רשום.</p>' : ''}<a class="b p" href="/">המשך</a>`;
    return html(res, page('אישור מכשיר', body));
  }

  if (p === '/__gate/login' && req.method === 'GET') {
    if (!auth.device.cred) return notFound(res);
    return html(res, page('כניסה', `<h2>כניסה</h2><button class="p" onclick="loginPasskey()">כניסה עם Face ID</button>`));
  }

  if (req.method !== 'POST') return notFound(res);
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad request' }); }

  if (p === '/__gate/passkey/register-options') {
    if (!setupOpen) return json(res, 403, { error: 'חלון הרישום נסגר. צריך קישור חדש' });
    return json(res, 200, { challenge: newChallenge(auth.deviceId, 'webauthn.create'), rpId: config.rpId, userId: b64u(Buffer.from(auth.deviceId)), userName: 'OIG ' + auth.device.label });
  }

  if (p === '/__gate/passkey/register') {
    if (!setupOpen) return json(res, 403, { error: 'חלון הרישום נסגר' });
    try {
      const cred = verifyRegistration(body, auth.deviceId, config);
      const state = getState();
      state.devices[auth.deviceId].cred = cred;
      saveState(state);
      log('passkey_registered', { ip, deviceId: auth.deviceId });
      return json(res, 200, { ok: true });
    } catch (e) {
      log('passkey_register_failed', { ip, deviceId: auth.deviceId, err: e.message });
      return json(res, 400, { error: 'הרישום נכשל' });
    }
  }

  if (p === '/__gate/passkey/login-options') {
    if (!auth.device.cred) return json(res, 403, { error: 'no passkey' });
    return json(res, 200, { challenge: newChallenge(auth.deviceId, 'webauthn.get'), rpId: config.rpId, credId: auth.device.cred.id });
  }

  if (p === '/__gate/passkey/login') {
    if (!auth.device.cred) return json(res, 403, { error: 'no passkey' });
    try {
      const signCount = verifyAssertion(body, auth.deviceId, auth.device.cred, config);
      const state = getState();
      state.devices[auth.deviceId].cred.signCount = signCount;
      state.devices[auth.deviceId].lastLogin = new Date().toISOString();
      saveState(state);
      log('passkey_login', { ip, deviceId: auth.deviceId });
      return json(res, 200, { ok: true, redirect: '/' }, {
        'set-cookie': cookieHeader(SES_COOKIE, sign(secret, SES_COOKIE, { d: auth.deviceId, e: now() + config.sessionDays * DAY }), config.sessionDays)
      });
    } catch (e) {
      log('passkey_login_failed', { ip, deviceId: auth.deviceId, err: e.message });
      return json(res, 401, { error: 'האימות נכשל' });
    }
  }

  return notFound(res);
}

// ---------- proxy ----------

function proxy(req, res, target) {
  const t = new URL(target);
  const headers = { ...req.headers };
  const cookie = stripGateCookies(headers.cookie);
  if (cookie) headers.cookie = cookie; else delete headers.cookie;
  const upstream = http.request({ host: t.hostname, port: t.port, method: req.method, path: req.url, headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers);
    ur.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) send(res, 502, 'Bad Gateway'); else res.destroy(); });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, target) {
  const t = new URL(target);
  const up = net.connect(Number(t.port), t.hostname, () => {
    let raw = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < req.rawHeaders.length; i += 2) raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
    up.write(raw + '\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

// ---------- server ----------

function startListener(listener, ctxBase) {
  const server = http.createServer(async (req, res) => {
    const ctx = { ...ctxBase, config: loadConfig() };
    try {
      const url = new URL(req.url, 'http://gate');
      if (url.pathname.startsWith('/__gate/')) return await handleGate(req, res, ctx, url);
      // Machine webhooks: skip the passkey gate, serve only to allow-listed IPs.
      const liveListener = (ctx.config.listeners || []).find((l) => l.name === listener.name) || listener;
      const pub = publicRoute(liveListener, url.pathname);
      if (pub) {
        const ip = trustedIp(req);
        if (Array.isArray(pub.allowIps) && pub.allowIps.includes(ip)) return proxy(req, res, listener.target);
        log('denied_public', { app: listener.name, ip, path: url.pathname.slice(0, 200) });
        return notFound(res);
      }
      const auth = authOf(req, ctx);
      const allowedHere = appAllowed(auth.device, listener.name);
      if (isAllowed(auth, ctx.config) && allowedHere) return proxy(req, res, listener.target);
      if (auth.device && !allowedHere) {
        log('denied_app', { app: listener.name, ip: clientIp(req), deviceId: auth.deviceId, label: auth.device.label });
        return notFound(res);
      }
      if (auth.device && auth.device.cred && req.method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
        res.writeHead(302, { location: '/__gate/login', 'cache-control': 'no-store' });
        return res.end();
      }
      if (auth.device) return send(res, 401, 'Unauthorized');
      log('denied', { app: listener.name, ip: clientIp(req), method: req.method, path: req.url.slice(0, 200), ua: String(req.headers['user-agent'] || '').slice(0, 200) });
      return notFound(res);
    } catch (e) {
      log('error', { app: listener.name, err: e.message });
      if (!res.headersSent) send(res, 500, 'Error');
    }
  });
  server.on('upgrade', (req, socket, head) => {
    const ctx = { ...ctxBase, config: loadConfig() };
    const a = authOf(req, ctx);
    if (!isAllowed(a, ctx.config) || !appAllowed(a.device, listener.name)) {
      log('denied_ws', { app: listener.name, ip: clientIp(req), path: req.url.slice(0, 200) });
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    proxyUpgrade(req, socket, head, listener.target);
  });
  server.listen(listener.port, '127.0.0.1', () => console.log(`[gate] ${listener.name}: 127.0.0.1:${listener.port} -> ${listener.target}`));
  return server;
}

function serve() {
  const secret = loadSecret();
  const config = loadConfig();
  if (!fs.existsSync(STATE_FILE)) saveState({ devices: {}, links: {} });
  console.log(`[gate] mode=${config.mode}`);
  return config.listeners.map((l) => startListener(l, { secret }));
}

// ---------- CLI ----------

function cli(args) {
  const cmd = args[0] || 'serve';
  const config = loadConfig();

  if (cmd === 'serve') return serve();

  if (cmd === 'init') {
    if (!fs.existsSync(SECRET_FILE)) { fs.writeFileSync(SECRET_FILE, b64u(crypto.randomBytes(32))); console.log('created gate-secret.key'); }
    if (!fs.existsSync(CONFIG_FILE)) { writeJsonAtomic(CONFIG_FILE, DEFAULT_CONFIG); console.log('created gate-config.json'); }
    const hi = args.indexOf('--host');
    if (hi > 0 && args[hi + 1]) {
      const host = args[hi + 1].replace(/\.$/, '');
      writeJsonAtomic(CONFIG_FILE, { ...readJson(CONFIG_FILE, DEFAULT_CONFIG), rpId: host, origins: [`https://${host}`, `https://${host}:8443`], enrollBaseUrl: `https://${host}:8443` });
      console.log('host = ' + host);
    }
    if (!fs.existsSync(STATE_FILE)) { saveState({ devices: {}, links: {} }); console.log('created gate-state.json'); }
    return console.log('init done');
  }

  const state = getState();

  if (cmd === 'link') {
    const label = args[1] || 'device';
    let apps;
    try { apps = parseApps(args[2], config); } catch (e) { return console.log(e.message); }
    const token = b64u(crypto.randomBytes(32));
    const rec = { label, exp: now() + config.linkMinutes * 60000, createdAt: new Date().toISOString() };
    if (apps) rec.apps = apps;
    state.links[b64u(sha256(token))] = rec;
    saveState(state);
    console.log(`One-time link for "${label}" (valid ${config.linkMinutes} min, single use)${apps ? ', apps: ' + apps.join(',') : ', apps: all'}:`);
    return console.log(`${config.enrollBaseUrl}/__gate/enroll?t=${token}`);
  }

  if (cmd === 'apps') {
    const id = args[1];
    if (!id || args[2] == null) return console.log('usage: node gate.js apps <deviceId> <app1,app2|all>');
    if (!state.devices[id]) return console.log('unknown device ' + id);
    let apps;
    try { apps = parseApps(args[2], config); } catch (e) { return console.log(e.message); }
    if (apps) state.devices[id].apps = apps; else delete state.devices[id].apps;
    saveState(state);
    return console.log(`device ${id} apps = ${apps ? apps.join(',') : 'all'} (applies immediately)`);
  }

  if (cmd === 'list') {
    console.log(`mode: ${config.mode}`);
    for (const [id, d] of Object.entries(state.devices)) {
      console.log(`${id}  ${d.revoked ? 'REVOKED' : 'active '}  passkey:${d.cred ? 'yes' : 'no '}  apps:${Array.isArray(d.apps) ? d.apps.join('+') : 'all'}  ${d.label}  enrolled:${d.createdAt}  lastLogin:${d.lastLogin || '-'}`);
    }
    return;
  }

  if (cmd === 'revoke') {
    const id = args[1];
    const ids = id === 'all' ? Object.keys(state.devices) : [id];
    for (const i of ids) {
      if (!state.devices[i]) { console.log('unknown device ' + i); continue; }
      state.devices[i].revoked = new Date().toISOString();
      console.log('revoked ' + i);
    }
    return saveState(state);
  }

  if (cmd === 'mode') {
    const mode = args[1];
    if (!['link', 'passkey'].includes(mode)) return console.log('usage: node gate.js mode link|passkey');
    if (mode === 'passkey') {
      const missing = Object.entries(state.devices).filter(([, d]) => !d.revoked && !d.cred);
      if (missing.length && args[2] !== '--force') {
        console.log('These active devices have no Face ID yet and would be locked out:');
        for (const [id, d] of missing) console.log(`  ${id}  ${d.label}`);
        return console.log('Register Face ID on them first, or rerun with --force.');
      }
    }
    writeJsonAtomic(CONFIG_FILE, { ...readJson(CONFIG_FILE, DEFAULT_CONFIG), mode });
    return console.log('mode = ' + mode + ' (applies immediately)');
  }

  console.log('usage: node gate.js [init|serve|link <label> [apps]|apps <id> <apps|all>|list|revoke <id|all>|mode link|passkey]');
}

if (require.main === module) cli(process.argv.slice(2));

module.exports = { verifyRegistration, verifyAssertion, newChallenge, sign, verify, DEFAULT_CONFIG };
