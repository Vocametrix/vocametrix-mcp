import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Explicit manual production probe for the out-of-credit case, which cannot be
// reached by calling the API: the review account has to be driven below zero
// balance first. This script therefore WRITES to dbo.accounts — run it only
// after an Azure password confirmation, and only against a review account.
//
// It restores the original credits in a finally block, and prints the restored
// value so a failed run is never mistaken for a clean one.
//
// stdin: { server, database, user, password, apiKey, oauth: {...}, audioPath }
// The apiKey identifies the account both to charge and to restore.

const platformRequire = createRequire('D:/Github/vocametrix-platform/package.json');
const sql = platformRequire('mssql');

let input = '';
for await (const chunk of process.stdin) input += chunk;
const cfg = JSON.parse(input.replace(/^\uFEFF/, ''));
const c = cfg.oauth;
const issuer = c.MCP_OAUTH_ISSUER;
const resource = c.MCP_OAUTH_RESOURCE;
const client = { client_id: c.MCP_OAUTH_CLIENT_ID, client_secret: c.MCP_OAUTH_CLIENT_SECRET };

function form(path, body, extra = {}) {
  return fetch(issuer + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30000),
  });
}

async function grant() {
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL(issuer + '/oauth/authorize');
  Object.entries({
    response_type: 'code', client_id: client.client_id,
    redirect_uri: c.MCP_OAUTH_REDIRECT_URI, scope: 'vocametrix:api', resource,
    state: randomBytes(16).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const page = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf, 'consent CSRF field');
  const cookie = page.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  const approval = await form('/oauth/authorize',
    { csrf, decision: 'approve', api_key: cfg.apiKey }, { Origin: issuer, Cookie: cookie });
  assert.equal(approval.status, 302, 'approve redirect HTTP status');
  const code = new URL(approval.headers.get('location')).searchParams.get('code');
  assert.ok(code, 'authorization code');
  const tokenResponse = await form('/oauth/token', {
    ...client, grant_type: 'authorization_code', code,
    code_verifier: verifier, redirect_uri: c.MCP_OAUTH_REDIRECT_URI, resource,
  });
  assert.equal(tokenResponse.status, 200, 'token exchange HTTP status');
  return tokenResponse.json();
}

async function callTool(accessToken, name, args) {
  const response = await fetch(resource, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(300000),
  });
  const raw = await response.text();
  const line = raw.includes('data:') ? raw.split('\n').find(l => l.startsWith('data:')).slice(5) : raw;
  return JSON.parse(line);
}

const pool = await new sql.ConnectionPool({
  server: cfg.server, database: cfg.database, user: cfg.user, password: cfg.password,
  options: { encrypt: true }, connectionTimeout: 15000, requestTimeout: 15000,
}).connect();

function balance(row) {
  return row.credits + (row.max_seconds - row.used_seconds) / 60;
}

let original = null;
let refresh;
try {
  const before = (await pool.request().input('key', sql.VarChar, cfg.apiKey)
    .query('SELECT user_id, credits, max_seconds, used_seconds FROM dbo.accounts WHERE key_value = @key')).recordset[0];
  assert.ok(before, 'account not found for that API key');
  original = before.credits;
  console.log(`BEFORE user ${before.user_id}: credits ${before.credits}, used_seconds ${before.used_seconds}, balance ${balance(before).toFixed(2)}`);

  await pool.request().input('userId', sql.Int, before.user_id)
    .query('UPDATE dbo.accounts SET credits = 0 WHERE user_id = @userId');
  const drained = (await pool.request().input('userId', sql.Int, before.user_id)
    .query('SELECT credits, max_seconds, used_seconds FROM dbo.accounts WHERE user_id = @userId')).recordset[0];
  assert.ok(balance(drained) <= 0, `balance still positive after draining: ${balance(drained).toFixed(2)}`);
  console.log(`DRAINED: balance ${balance(drained).toFixed(2)}`);

  const tokens = await grant();
  refresh = tokens.refresh_token;

  const bytes = await readFile(cfg.audioPath);
  const uploaded = await callTool(tokens.access_token, 'vocametrix_upload_audio', { audioBase64: bytes.toString('base64') });
  const blobUrl = uploaded.result?.structuredContent?.result?.blobUrl;
  console.log(blobUrl
    ? 'NOTE upload succeeded on a zero balance — uploading is not metered'
    : `NOTE upload refused on a zero balance: ${JSON.stringify(uploaded).slice(0, 400)}`);

  if (blobUrl) {
    const analysed = await callTool(tokens.access_token, 'vocametrix_extract_egemaps', { audioPath: blobUrl });
    const text = JSON.stringify(analysed);
    const blocked = /429|quota|credit/i.test(text);
    console.log(`${blocked ? 'PASS' : 'FAIL'} analysis refused on an exhausted balance`);
    console.log(text.slice(0, 600));
  }

  const after = (await pool.request().input('userId', sql.Int, before.user_id)
    .query('SELECT used_seconds FROM dbo.accounts WHERE user_id = @userId')).recordset[0];
  console.log(`used_seconds after the blocked attempt: ${after.used_seconds} (was ${before.used_seconds})`);
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  if (refresh) await form('/oauth/revoke', { ...client, token: refresh }).catch(() => {});
  if (original !== null) {
    await pool.request().input('key', sql.VarChar, cfg.apiKey).input('credits', sql.Int, original)
      .query('UPDATE dbo.accounts SET credits = @credits WHERE key_value = @key');
    const restored = (await pool.request().input('key', sql.VarChar, cfg.apiKey)
      .query('SELECT credits FROM dbo.accounts WHERE key_value = @key')).recordset[0];
    console.log(`RESTORED credits: ${restored.credits} (expected ${original})`);
    if (restored.credits !== original) process.exitCode = 1;
  }
  await pool.close();
}
