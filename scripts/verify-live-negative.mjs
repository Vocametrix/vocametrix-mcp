import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Explicit manual production probe for the negative cases the ChatGPT
// submission has to document: a rejected API key at consent, and a call made
// after the authorization was revoked.
//
// The out-of-credit case is not here: it needs the account's balance driven to
// zero in the database, which is a production write and stays a deliberate,
// separately confirmed step.
//
// Secrets stay in memory; no tokens or API keys are logged.

const c = JSON.parse(process.env.VOCAMETRIX_OAUTH_CONFIG);
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

// Opens a consent page and returns its CSRF token, cookie and PKCE verifier.
async function openConsent() {
  const verifier = randomBytes(32).toString('base64url');
  const url = new URL(issuer + '/oauth/authorize');
  Object.entries({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: c.MCP_OAUTH_REDIRECT_URI,
    scope: 'vocametrix:api',
    resource,
    state: randomBytes(16).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const page = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(page.status, 200, 'consent HTTP status');
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf, 'consent CSRF field');
  return { csrf, cookie: page.headers.getSetCookie().map(s => s.split(';')[0]).join('; '), verifier };
}

function mcpCall(accessToken) {
  return fetch(resource, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    signal: AbortSignal.timeout(30000),
  });
}

let failures = 0;
function report(passed, label, detail) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${detail ? `: ${detail}` : ''}`);
  if (!passed) failures += 1;
}

try {
  // 1. An API key that does not exist must not yield an authorization code.
  {
    const { csrf, cookie } = await openConsent();
    const rejected = await form('/oauth/authorize',
      { csrf, decision: 'approve', api_key: `vcmx_${'0'.repeat(64)}` },
      { Origin: issuer, Cookie: cookie });
    const location = rejected.headers.get('location');
    const gotCode = rejected.status === 302 && location
      ? new URL(location).searchParams.get('code')
      : null;
    report(!gotCode, 'invalid API key refused at consent',
      `HTTP ${rejected.status}${gotCode ? ' and an authorization code was issued' : ''}`);
  }

  // 2. After revocation the access token must stop being accepted by the MCP
  //    server, which is what makes "disconnect" mean anything.
  {
    const { csrf, cookie, verifier } = await openConsent();
    const approval = await form('/oauth/authorize',
      { csrf, decision: 'approve', api_key: process.env.VOCAMETRIX_API_KEY },
      { Origin: issuer, Cookie: cookie });
    assert.equal(approval.status, 302, 'approve redirect HTTP status');
    const code = new URL(approval.headers.get('location')).searchParams.get('code');
    assert.ok(code, 'authorization code');
    const tokenResponse = await form('/oauth/token', {
      ...client, grant_type: 'authorization_code', code,
      code_verifier: verifier, redirect_uri: c.MCP_OAUTH_REDIRECT_URI, resource,
    });
    assert.equal(tokenResponse.status, 200, 'token exchange HTTP status');
    const tokens = await tokenResponse.json();

    const before = await mcpCall(tokens.access_token);
    report(before.status === 200, 'granted token is accepted before revocation', `HTTP ${before.status}`);

    const revoked = await form('/oauth/revoke', { ...client, token: tokens.refresh_token });
    report(revoked.ok, 'revocation accepted', `HTTP ${revoked.status}`);

    const after = await mcpCall(tokens.access_token);
    report(after.status === 401, 'call after revocation refused', `HTTP ${after.status}`);

    const reused = await form('/oauth/token',
      { ...client, grant_type: 'refresh_token', refresh_token: tokens.refresh_token, resource });
    report(reused.status >= 400, 'revoked refresh token refused', `HTTP ${reused.status}`);
  }
} catch (e) {
  console.error('FAIL', e.message);
  failures += 1;
}

process.exitCode = failures === 0 ? 0 : 1;
