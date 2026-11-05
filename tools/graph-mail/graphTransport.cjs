'use strict';
// Microsoft Graph mail transport with a nodemailer-compatible surface.
// Drop-in replacement for `nodemailer.createTransport(...)`: the returned object
// has sendMail(mailOptions) and verify(), so existing `transporter.sendMail({...})`
// call sites keep working. Sends as one fixed M365 mailbox using an Entra ID app
// registration (client-credentials flow, Mail.Send application permission scoped
// to that mailbox by an Exchange Application Access Policy). No user password is
// stored anywhere. Node 18+ (global fetch). No dependencies.
//
// Config (options or env):
//   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER
// Optional: GRAPH_REPLY_TO (default Reply-To when the message sets none).
// Guardrails (env or options):
//   GRAPH_MAX_PER_MINUTE (15)   throttle per process; Exchange limit is 30/min
//   GRAPH_MAX_RECIPIENTS (50)   refuse a message with more recipients
//   GRAPH_DAILY_CAP (2000)      recipients per day, shared via GRAPH_STATE_FILE
//   GRAPH_ALLOWED_DOMAINS       optional comma list; refuse other recipient domains
//   GRAPH_SEND_DISABLED=1       kill switch: refuse every send
//   GRAPH_LOG_FILE              JSON-lines audit log (no bodies), next to this file by default
// 429/503 from Graph are retried after Retry-After (up to 3 times).

const fs = require('fs');
const path = require('path');

const ADDR_RE = /^\s*(?:"?([^"<]*?)"?\s*)?<([^<>@\s]+@[^<>\s]+)>\s*$|^\s*([^<>@\s,]+@[^<>\s,]+)\s*$/;

function parseOne(item) {
  if (!item) return null;
  if (typeof item === 'object') {
    const address = item.address || item.email;
    return address ? { emailAddress: { address, ...(item.name ? { name: item.name } : {}) } } : null;
  }
  const m = String(item).match(ADDR_RE);
  if (!m) throw new Error('graph-mail: invalid address: ' + item);
  const address = m[2] || m[3];
  const name = (m[1] || '').trim();
  return { emailAddress: { address, ...(name ? { name } : {}) } };
}

// Accepts "a@x.com, B <b@y.com>", an array of strings, or {name,address} objects.
function parseList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return items.map((s) => (typeof s === 'string' ? s.trim() : s)).filter(Boolean).map(parseOne).filter(Boolean);
}

function guessType(name) {
  const ext = path.extname(name || '').toLowerCase();
  return ({ '.pdf': 'application/pdf', '.csv': 'text/csv', '.txt': 'text/plain', '.html': 'text/html',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.zip': 'application/zip' })[ext]
    || 'application/octet-stream';
}

function toAttachment(a) {
  let buf;
  if (a.path) buf = fs.readFileSync(a.path);
  else if (Buffer.isBuffer(a.content)) buf = a.content;
  else if (typeof a.content === 'string') buf = Buffer.from(a.content, a.encoding === 'base64' ? 'base64' : 'utf8');
  else throw new Error('graph-mail: attachment needs path or content');
  const name = a.filename || (a.path ? path.basename(a.path) : 'attachment');
  const att = { '@odata.type': '#microsoft.graph.fileAttachment', name, contentType: a.contentType || guessType(name), contentBytes: buf.toString('base64') };
  if (a.cid) { att.contentId = a.cid; att.isInline = true; }
  return att;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const splitCsv = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim().toLowerCase()).filter(Boolean);
function num(opt, env, dflt) {
  const v = opt != null ? Number(opt) : env != null && env !== '' ? Number(env) : dflt;
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

function createGraphTransport(options = {}) {
  const cfg = {
    tenantId: options.tenantId || process.env.GRAPH_TENANT_ID,
    clientId: options.clientId || process.env.GRAPH_CLIENT_ID,
    clientSecret: options.clientSecret || process.env.GRAPH_CLIENT_SECRET,
    sender: options.sender || process.env.GRAPH_SENDER,
    replyTo: options.replyTo || process.env.GRAPH_REPLY_TO || '',
    authority: (options.authority || 'https://login.microsoftonline.com').replace(/\/$/, ''),
    graphBase: (options.graphBase || 'https://graph.microsoft.com/v1.0').replace(/\/$/, ''),
    // Guardrails. Exchange Online allows 30 msgs/min and 10,000 recipients/day per
    // mailbox; stay well under so a runaway loop cannot get the mailbox blocked.
    app: options.app || process.env.GRAPH_APP_NAME || path.basename(process.cwd()),
    maxPerMinute: num(options.maxPerMinute, process.env.GRAPH_MAX_PER_MINUTE, 15),
    maxRecipientsPerMessage: num(options.maxRecipientsPerMessage, process.env.GRAPH_MAX_RECIPIENTS, 50),
    dailyRecipientCap: num(options.dailyRecipientCap, process.env.GRAPH_DAILY_CAP, 2000),
    allowedDomains: splitCsv(options.allowedDomains || process.env.GRAPH_ALLOWED_DOMAINS),
    disabled: options.disabled != null ? !!options.disabled : process.env.GRAPH_SEND_DISABLED === '1',
    logFile: options.logFile || process.env.GRAPH_LOG_FILE || path.join(__dirname, 'graph-mail.log'),
    stateFile: options.stateFile || process.env.GRAPH_STATE_FILE || path.join(__dirname, 'graph-mail-state.json'),
    windowMs: options.windowMs || 60000,
    maxRetries: num(options.maxRetries, null, 3),
  };
  const missing = ['tenantId', 'clientId', 'clientSecret', 'sender'].filter((k) => !cfg[k]);
  if (missing.length) throw new Error('graph-mail: missing config: ' + missing.join(', '));

  const sentAt = []; // send timestamps in the current window (this process)

  function log(entry) {
    try { fs.appendFileSync(cfg.logFile, JSON.stringify({ t: new Date().toISOString(), app: cfg.app, ...entry }) + '\n'); } catch { /* logging must never break sending */ }
  }

  // Daily recipient count, shared by every process using the same state file.
  function dailyCount() {
    try { const s = JSON.parse(fs.readFileSync(cfg.stateFile, 'utf8')); return s.day === today() ? s.recipients : 0; } catch { return 0; }
  }
  function addDaily(n) {
    try { fs.writeFileSync(cfg.stateFile, JSON.stringify({ day: today(), recipients: dailyCount() + n })); } catch { /* best effort */ }
  }

  async function throttle() {
    for (;;) {
      const now = Date.now();
      while (sentAt.length && now - sentAt[0] >= cfg.windowMs) sentAt.shift();
      if (sentAt.length < cfg.maxPerMinute) { sentAt.push(now); return; }
      await sleep(cfg.windowMs - (now - sentAt[0]) + 5);
    }
  }

  let token = null;
  let tokenExp = 0;

  async function getToken() {
    if (token && Date.now() < tokenExp - 60000) return token;
    const res = await fetch(`${cfg.authority}/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: 'https://graph.microsoft.com/.default' }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new Error(`graph-mail: token request failed (${res.status}): ${j.error_description || j.error || 'no token'}`);
    token = j.access_token;
    tokenExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
    return token;
  }

  async function sendMail(mail = {}) {
    const to = parseList(mail.to);
    const cc = parseList(mail.cc);
    const bcc = parseList(mail.bcc);
    if (!to.length && !cc.length && !bcc.length) throw new Error('graph-mail: no recipients');
    const all = [...to, ...cc, ...bcc].map((r) => r.emailAddress.address);
    const meta = { to: all, subject: String(mail.subject || '').slice(0, 200), attachments: (mail.attachments || []).length };
    const refuse = (reason) => { log({ ...meta, status: 'refused', reason }); throw new Error('graph-mail: refused: ' + reason); };
    if (cfg.disabled) refuse('sending disabled (GRAPH_SEND_DISABLED=1)');
    if (all.length > cfg.maxRecipientsPerMessage) refuse(`${all.length} recipients > max ${cfg.maxRecipientsPerMessage} per message`);
    if (cfg.allowedDomains.length) {
      const bad = all.filter((a) => !cfg.allowedDomains.includes(a.split('@')[1].toLowerCase()));
      if (bad.length) refuse('recipient domain not allowed: ' + bad.join(', '));
    }
    if (dailyCount() + all.length > cfg.dailyRecipientCap) refuse(`daily cap ${cfg.dailyRecipientCap} recipients reached`);
    const replyTo = parseList(mail.replyTo || cfg.replyTo);
    const isHtml = mail.html != null && mail.html !== '';
    const message = {
      subject: mail.subject || '',
      body: { contentType: isHtml ? 'HTML' : 'Text', content: String(isHtml ? mail.html : (mail.text || '')) },
      toRecipients: to,
      ...(cc.length ? { ccRecipients: cc } : {}),
      ...(bcc.length ? { bccRecipients: bcc } : {}),
      ...(replyTo.length ? { replyTo } : {}),
      ...(mail.attachments && mail.attachments.length ? { attachments: mail.attachments.map(toAttachment) } : {}),
    };
    const body = JSON.stringify({ message, saveToSentItems: true });
    await throttle();
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${cfg.graphBase}/users/${encodeURIComponent(cfg.sender)}/sendMail`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + (await getToken()), 'content-type': 'application/json' },
        body,
      });
      if (res.status === 202) break;
      // Throttled or briefly unavailable: honour Retry-After, then retry a few times.
      if ((res.status === 429 || res.status === 503) && attempt < cfg.maxRetries) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || 2 ** attempt * 5, 120) * 1000;
        log({ ...meta, status: 'retry', http: res.status, waitMs: wait });
        await sleep(wait);
        continue;
      }
      const j = await res.json().catch(() => ({}));
      const msg = (j.error && (j.error.code + ' ' + j.error.message)) || res.statusText;
      log({ ...meta, status: 'failed', http: res.status, error: msg });
      throw new Error(`graph-mail: sendMail failed (${res.status}): ${msg}`);
    }
    addDaily(all.length);
    log({ ...meta, status: 'sent' });
    return { accepted: all, rejected: [], envelope: { from: cfg.sender, to: all }, messageId: null, response: '202 Accepted' };
  }

  // nodemailer-style: resolves true when credentials work (fetches a token).
  async function verify() { await getToken(); return true; }

  return { sendMail, verify, close() {} };
}

module.exports = { createGraphTransport, parseList };
