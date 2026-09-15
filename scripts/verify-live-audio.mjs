import { randomBytes, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Explicit manual production probe for the ChatGPT audio path.
// It performs a real OAuth grant, uploads a real recording through
// vocametrix_upload_audio, then runs one analysis tool on the returned blobUrl.
// This calls the real API and consumes the linked account's audio quota.
// Secrets stay in memory; no tokens or API keys are logged.

const audioPath = process.argv[2];
if (!audioPath) {
  console.error('Usage: node scripts/verify-live-audio.mjs <audio file> [--locale fr-FR] [--tool transcribe|egemaps|cpp]');
  process.exit(2);
}
const locale = process.argv.includes('--locale')
  ? process.argv[process.argv.indexOf('--locale') + 1]
  : 'fr-FR';
const analysis = process.argv.includes('--tool')
  ? process.argv[process.argv.indexOf('--tool') + 1]
  : 'transcribe';

const c = JSON.parse(process.env.VOCAMETRIX_OAUTH_CONFIG);
const issuer = c.MCP_OAUTH_ISSUER;
const resource = c.MCP_OAUTH_RESOURCE;
const client = { client_id: c.MCP_OAUTH_CLIENT_ID, client_secret: c.MCP_OAUTH_CLIENT_SECRET };
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(16).toString('hex');
let refresh;

function form(path, body, extra = {}) {
  return fetch(issuer + path, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...extra },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30000),
  });
}

async function callTool(accessToken, name, args, timeoutMs) {
  const response = await fetch(resource, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert.equal(response.status, 200, `${name} HTTP status`);
  const raw = await response.text();
  const line = raw.includes('data:') ? raw.split('\n').find(l => l.startsWith('data:')).slice(5) : raw;
  const payload = JSON.parse(line);
  assert.ok(!payload.error, `${name} JSON-RPC error: ${JSON.stringify(payload.error)}`);
  assert.ok(!payload.result?.isError, `${name} tool error: ${JSON.stringify(payload.result?.content)}`);
  const structured = payload.result.structuredContent;
  const text = payload.result.content?.find(p => p.type === 'text')?.text;
  return structured ?? (text ? JSON.parse(text) : payload.result);
}

try {
  const bytes = await readFile(audioPath);
  // Duration is only reported for a plain 16-bit PCM WAV header; the API bills
  // whatever duration it measures itself.
  const header = bytes.subarray(0, 44);
  const isPcmWav = header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE';
  const seconds = isPcmWav ? (bytes.length - 44) / (header.readUInt32LE(28) || 1) : null;
  console.log(`INPUT ${audioPath}: ${bytes.length} bytes${seconds ? `, about ${seconds.toFixed(1)} s` : ''}`);

  const url = new URL(issuer + '/oauth/authorize');
  Object.entries({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: c.MCP_OAUTH_REDIRECT_URI,
    scope: 'vocametrix:api',
    resource,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  const page = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(page.status, 200, 'consent HTTP status');
  const html = await page.text();
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf, 'consent CSRF field');
  const cookie = page.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  const approval = await form('/oauth/authorize',
    { csrf, decision: 'approve', api_key: process.env.VOCAMETRIX_API_KEY },
    { Origin: issuer, Cookie: cookie });
  assert.equal(approval.status, 302, 'approve redirect HTTP status');
  const redirect = new URL(approval.headers.get('location'));
  assert.equal(redirect.searchParams.get('error'), null, 'approval OAuth error');
  const code = redirect.searchParams.get('code');
  assert.ok(code, 'authorization code');
  const tokenResponse = await form('/oauth/token', {
    ...client, grant_type: 'authorization_code', code,
    code_verifier: verifier, redirect_uri: c.MCP_OAUTH_REDIRECT_URI, resource,
  });
  assert.equal(tokenResponse.status, 200, 'token exchange HTTP status');
  const tokens = await tokenResponse.json();
  refresh = tokens.refresh_token;
  console.log('PASS OAuth grant for the audio probe');

  const uploaded = await callTool(tokens.access_token, 'vocametrix_upload_audio',
    { audioBase64: bytes.toString('base64') }, 180000);
  const blobUrl = uploaded.blobUrl ?? uploaded.result?.blobUrl ?? uploaded.data?.blobUrl;
  assert.ok(typeof blobUrl === 'string' && blobUrl.startsWith('https://'),
    `blobUrl in ${JSON.stringify(uploaded).slice(0, 300)}`);
  console.log(`PASS vocametrix_upload_audio returned a blobUrl (host ${new URL(blobUrl).host})`);

  const tools = {
    transcribe: ['vocametrix_transcribe_audio', { audioPath: blobUrl, speakerLocale: locale }],
    egemaps: ['vocametrix_extract_egemaps', { audioPath: blobUrl }],
    cpp: ['vocametrix_calculate_cpp', { sustainedVowelPath: blobUrl }],
  };
  assert.ok(tools[analysis], `unknown --tool ${analysis}`);
  const [toolName, toolArgs] = tools[analysis];
  // Analysis latency is worth reporting: the tool bills the recording as soon
  // as the worker finishes, so a client that gives up early still pays for it.
  const startedAt = Date.now();
  const result = await callTool(tokens.access_token, toolName, toolArgs, 900000);
  console.log(`PASS ${toolName} on the uploaded recording in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(result, null, 2).slice(0, 4000));
} catch (e) {
  console.error('FAIL', e.message);
  process.exitCode = 1;
} finally {
  if (refresh) {
    const revoked = await form('/oauth/revoke', { ...client, token: refresh });
    console.log(revoked.ok ? 'PASS probe-only authorization revoked' : `FAIL probe revocation HTTP ${revoked.status}`);
    if (!revoked.ok) process.exitCode = 1;
  }
}
