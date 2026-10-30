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

function createGraphTransport(options = {}) {
  const cfg = {
    tenantId: options.tenantId || process.env.GRAPH_TENANT_ID,
    clientId: options.clientId || process.env.GRAPH_CLIENT_ID,
    clientSecret: options.clientSecret || process.env.GRAPH_CLIENT_SECRET,
    sender: options.sender || process.env.GRAPH_SENDER,
    replyTo: options.replyTo || process.env.GRAPH_REPLY_TO || '',
    authority: (options.authority || 'https://login.microsoftonline.com').replace(/\/$/, ''),
    graphBase: (options.graphBase || 'https://graph.microsoft.com/v1.0').replace(/\/$/, ''),
  };
  const missing = ['tenantId', 'clientId', 'clientSecret', 'sender'].filter((k) => !cfg[k]);
  if (missing.length) throw new Error('graph-mail: missing config: ' + missing.join(', '));

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
    const res = await fetch(`${cfg.graphBase}/users/${encodeURIComponent(cfg.sender)}/sendMail`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + (await getToken()), 'content-type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    if (res.status !== 202) {
      const j = await res.json().catch(() => ({}));
      throw new Error(`graph-mail: sendMail failed (${res.status}): ${(j.error && (j.error.code + ' ' + j.error.message)) || res.statusText}`);
    }
    const accepted = [...to, ...cc, ...bcc].map((r) => r.emailAddress.address);
    return { accepted, rejected: [], envelope: { from: cfg.sender, to: accepted }, messageId: null, response: '202 Accepted' };
  }

  // nodemailer-style: resolves true when credentials work (fetches a token).
  async function verify() { await getToken(); return true; }

  return { sendMail, verify, close() {} };
}

module.exports = { createGraphTransport, parseList };
