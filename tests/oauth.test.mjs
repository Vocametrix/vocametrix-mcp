import { test } from "node:test";
import assert from "node:assert/strict";
import { API_SCOPE, OAuthError, readOAuthConfig, protectedResourceMetadata, authenticationChallenge, resolveOAuthApiKey } from "../dist/oauth.js";
import { createClient } from "../dist/client.js";

// Synthetic authentication fixtures only; no real accounts, credentials or API calls.
const config = {
  resource: "https://mcp.example.test/chatgpt/mcp",
  issuer: "https://platform.example.test",
  introspectionSecret: "synthetic-introspection-secret-for-tests",
};
const active = {
  active: true, issuer: config.issuer, audience: config.resource,
  scope: API_SCOPE, subject: "test-user-a", apiKey: "synthetic-api-key-a",
  expiresAt: Math.floor(Date.now() / 1000) + 900,
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("OAuth is opt-in, but incomplete or unsafe configuration fails closed", () => {
  assert.equal(readOAuthConfig({}), undefined);
  const env = { MCP_OAUTH_RESOURCE: config.resource, MCP_OAUTH_ISSUER: config.issuer, MCP_OAUTH_INTROSPECTION_SECRET: config.introspectionSecret };
  assert.deepEqual(readOAuthConfig(env), config);
  for (const overrides of [
    { MCP_OAUTH_INTROSPECTION_SECRET: "short" },
    { MCP_OAUTH_RESOURCE: "http://mcp.example.test/chatgpt/mcp" },
    { MCP_OAUTH_RESOURCE: "https://user:password@mcp.example.test/chatgpt/mcp" },
    { MCP_OAUTH_RESOURCE: "https://mcp.example.test/chatgpt/mcp?key=secret" },
    { MCP_OAUTH_RESOURCE: "https://mcp.example.test/mcp" },
    { MCP_OAUTH_ISSUER: "https://platform.example.test/" },
    { MCP_OAUTH_ISSUER: "https://platform.example.test/path" },
  ]) assert.throws(() => readOAuthConfig({ ...env, ...overrides }));
  assert.throws(() => readOAuthConfig({ MCP_OAUTH_RESOURCE: config.resource }));
});

test("metadata and challenge describe the exact API-only resource", () => {
  assert.deepEqual(protectedResourceMetadata(config), {
    resource: config.resource, authorization_servers: [config.issuer],
    scopes_supported: [API_SCOPE], bearer_methods_supported: ["header"], resource_name: "Vocametrix API",
  });
  assert.match(authenticationChallenge(config), /oauth-protected-resource\/chatgpt\/mcp/);
  assert.match(authenticationChallenge(config), /scope="vocametrix:api"/);
});

test("missing or malformed bearer credentials never contact introspection", async () => {
  for (const header of [undefined, "", "Basic secret", "Bearer", "Bearer token extra", "Bearer token, Bearer second"]) {
    await assert.rejects(resolveOAuthApiKey(header, config, () => assert.fail("must not fetch")), { status: 401 });
  }
});

test("introspection uses confidential server credentials, exact resource and no redirects", async () => {
  const key = await resolveOAuthApiKey("Bearer synthetic-access-token", config, async (url, init) => {
    assert.equal(url, `${config.issuer}/oauth/mcp/introspect`);
    assert.equal(init.headers.Authorization, `Bearer ${config.introspectionSecret}`);
    assert.deepEqual(JSON.parse(init.body), { token: "synthetic-access-token", resource: config.resource });
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.equal(init.headers["X-Web-Session"], undefined);
    return json(active);
  });
  assert.equal(key, active.apiKey);
});

test("rejects inactive, expired, wrong issuer/resource/scope and malformed identities", async () => {
  for (const overrides of [
    { active: false }, { expiresAt: 0 }, { expiresAt: "9999999999" },
    { issuer: "https://attacker.example.test" }, { audience: "https://other.example.test/mcp" },
    { scope: "vocametrix:web" }, { apiKey: "" }, { subject: "" }, { subject: 1 },
  ]) {
    await assert.rejects(resolveOAuthApiKey("Bearer fixture", config, async () => json({ ...active, ...overrides })), { status: 401 });
  }
  await assert.rejects(resolveOAuthApiKey("Bearer fixture", config, async () => json(null)), { status: 401 });
});

test("introspection failures return a generic unavailable error without leaking payloads", async () => {
  for (const fetcher of [
    async () => { throw new Error("private server failure"); },
    async () => json({ secret: "private" }, 500),
    async () => json({ secret: "private" }, 401),
    async () => new Response("not JSON"),
  ]) {
    await assert.rejects(resolveOAuthApiKey("Bearer fixture", config, fetcher), (err) =>
      err instanceof OAuthError && err.status === 503 && !err.message.includes("private"));
  }
});

test("two accounts stay isolated and revocation is checked on every request", async () => {
  let revoked = false;
  const fetcher = async (_url, init) => {
    const { token } = JSON.parse(init.body);
    return json(revoked ? { active: false } : { ...active, apiKey: `key-for-${token}`, subject: token });
  };
  assert.deepEqual(await Promise.all([
    resolveOAuthApiKey("Bearer account-a", config, fetcher),
    resolveOAuthApiKey("Bearer account-b", config, fetcher),
  ]), ["key-for-account-a", "key-for-account-b"]);
  revoked = true;
  await assert.rejects(resolveOAuthApiKey("Bearer account-a", config, fetcher), { status: 401 });
});

test("resolved account calls use its API key and never website subscription headers", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.VOCAMETRIX_API_KEY;
  process.env.VOCAMETRIX_API_KEY = "synthetic-server-owner-key";
  const requests = [];
  globalThis.fetch = async (_url, init) => { requests.push(init); return json({ fixture: true }); };
  try {
    await createClient(active.apiKey).post("/api/test-fixture", { input: "fixture" });
    assert.equal(requests[0].headers["X-API-Key"], active.apiKey);
    assert.equal(requests[0].headers["X-Web-Session"], undefined);
    assert.equal(requests[0].headers.Authorization, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VOCAMETRIX_API_KEY;
    else process.env.VOCAMETRIX_API_KEY = originalKey;
  }
});
