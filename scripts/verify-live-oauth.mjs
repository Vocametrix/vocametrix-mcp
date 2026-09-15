import {randomBytes, createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Explicit manual production probe. Secrets remain in memory; no tokens are logged.
const c = JSON.parse(process.env.VOCAMETRIX_OAUTH_CONFIG);
const issuer = c.MCP_OAUTH_ISSUER;
const resource = c.MCP_OAUTH_RESOURCE;
const client = {client_id:c.MCP_OAUTH_CLIENT_ID, client_secret:c.MCP_OAUTH_CLIENT_SECRET};
const verifier = randomBytes(32).toString('base64url');
const state = randomBytes(16).toString('hex');
let refresh;
async function form(path, body, extra = {}) {
  return fetch(issuer+path, {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded', ...extra}, body:new URLSearchParams(body), signal:AbortSignal.timeout(30000)});
}
try {
  const url = new URL(issuer+'/oauth/authorize');
  Object.entries({response_type:'code', client_id:client.client_id, redirect_uri:c.MCP_OAUTH_REDIRECT_URI, scope:'vocametrix:api', resource, state, code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const page = await fetch(url, {signal:AbortSignal.timeout(30000)});
  assert.equal(page.status,200,'consent HTTP status');
  assert.equal(page.headers.get('referrer-policy'),'strict-origin');
  const html = await page.text();
  assert.ok(html.includes('#7b2cbf'),'deployed purple consent page');
  const csrf = html.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf,'consent CSRF field');
  console.log('PASS deployed consent page and Origin policy');
  const cookie = page.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const approval = await form('/oauth/authorize', {csrf,decision:'approve',api_key:process.env.VOCAMETRIX_API_KEY}, {Origin:issuer,Cookie:cookie});
  assert.equal(approval.status,302,'approve redirect HTTP status');
  const redirect = new URL(approval.headers.get('location'));
  assert.equal(redirect.searchParams.get('state'),state);
  assert.equal(redirect.searchParams.get('error'),null,'approval OAuth error');
  const code = redirect.searchParams.get('code');
  assert.ok(code,'authorization code');
  console.log('PASS real account approval and callback construction');
  const tokenResponse = await form('/oauth/token', {...client,grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:c.MCP_OAUTH_REDIRECT_URI,resource});
  assert.equal(tokenResponse.status,200,'token exchange HTTP status');
  const tokens = await tokenResponse.json();
  refresh = tokens.refresh_token;
  assert.ok(tokens.access_token && refresh);
  console.log('PASS PKCE authorization code exchange');
  const mcp = await fetch(resource,{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}}),signal:AbortSignal.timeout(30000)});
  assert.equal(mcp.status,200,'authenticated MCP HTTP status');
  const raw = await mcp.text();
  const payload = raw.startsWith('data:') || raw.includes('\ndata:') ? JSON.parse(raw.split('\n').find(l=>l.startsWith('data:')).slice(5)) : JSON.parse(raw);
  assert.ok(payload.result?.tools?.length > 0,'MCP tools discovery');
  console.log(`PASS authenticated MCP discovery: ${payload.result.tools.length} tools`);
  if (process.argv.includes('--call')) {
    const called = await fetch(resource,{method:'POST',headers:{Authorization:`Bearer ${tokens.access_token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'vocametrix_convert_french_to_ipa',arguments:{input:'bonjour',includeSyllableMarks:false}}}),signal:AbortSignal.timeout(60000)});
    assert.equal(called.status,200,'real tool invocation HTTP status');
    const rawCall = await called.text();
    const result = rawCall.includes('data:') ? JSON.parse(rawCall.split('\n').find(l=>l.startsWith('data:')).slice(5)) : JSON.parse(rawCall);
    assert.ok(result.result && !result.result.isError && !result.error,'real tool execution');
    console.log('PASS real French-to-IPA tool call:', JSON.stringify(result.result.structuredContent ?? result.result.content));
  }
  const rotated = await form('/oauth/token', {...client,grant_type:'refresh_token',refresh_token:refresh,resource});
  assert.equal(rotated.status,200,'refresh HTTP status');
  const next = await rotated.json();
  assert.ok(next.refresh_token && next.refresh_token!==refresh);
  refresh = next.refresh_token;
  console.log('PASS real SQL refresh rotation');
} catch (e) {
  console.error('FAIL',e.message);
  process.exitCode=1;
} finally {
  if (refresh) {
    const revoked = await form('/oauth/revoke',{...client,token:refresh});
    console.log(revoked.ok ? 'PASS probe-only authorization revoked' : `FAIL probe revocation HTTP ${revoked.status}`);
    if (!revoked.ok) process.exitCode=1;
  }
}
