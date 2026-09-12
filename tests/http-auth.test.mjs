import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

// All downstream responses and accounts are synthetic fixtures. Network calls
// inside the child server are intercepted; these tests spend no API credits.
async function launch(t, oauth) {
  const directory = await mkdtemp(join(tmpdir(), "vocametrix-http-auth-"));
  const preload = join(directory, "fixture.mjs");
  await writeFile(preload, `
    globalThis.fetch = async (url, init) => {
      if (url === 'https://platform.example.test/oauth/mcp/introspect') {
        const { token, resource } = JSON.parse(init.body);
        return Response.json(token === 'revoked' ? { active: false } : {
          active: true, apiKey: 'fixture-key-' + token, subject: token,
          scope: 'vocametrix:api', audience: resource,
          issuer: 'https://platform.example.test', expiresAt: Date.now() / 1000 + 900,
        });
      }
      if (url === 'https://platform.vocametrix.com/api/spell-agent') {
        return Response.json({ fixture: true, key: init.headers['X-API-Key'],
          webSession: init.headers['X-Web-Session'] ?? null });
      }
      throw new Error('Unexpected network call in offline test');
    };
  `);
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const env = { ...process.env, PORT: String(port), VOCAMETRIX_API_KEY: "fixture-owner-key" };
  for (const name of Object.keys(env)) if (name.startsWith("MCP_OAUTH_")) delete env[name];
  if (oauth) Object.assign(env, {
    MCP_OAUTH_RESOURCE: "https://mcp.example.test/chatgpt/mcp",
    MCP_OAUTH_ISSUER: "https://platform.example.test",
    MCP_OAUTH_INTROSPECTION_SECRET: "fixture-introspection-secret-long-enough",
  });
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, "dist/server.js"], { env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => {
    if (child.exitCode === null) {
      await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
    }
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 10_000);
    child.once("error", (err) => { clearTimeout(timeout); reject(err); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stderr.on("data", (chunk) => {
      if (chunk.toString().includes("HTTP server listening")) { clearTimeout(timeout); resolve(); }
    });
  });
  return `http://127.0.0.1:${port}`;
}

async function rpc(base, path, method, headers = {}, params) {
  const response = await fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  const text = await response.text();
  const payload = text.startsWith("event:") ? text.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : text;
  return { response, data: payload ? JSON.parse(payload) : null };
}

const tool = { name: "vocametrix_interpret_spelling_attempt", arguments: { transcription: "c a t", targetWord: "cat" } };

test("legacy anonymous HTTP discovery never inherits the server owner's API key", async (t) => {
  const base = await launch(t, false);
  assert.equal((await rpc(base, "/mcp", "tools/list")).response.status, 200);
  const anonymous = await rpc(base, "/mcp", "tools/call", {}, tool);
  assert.equal(anonymous.data.result.isError, true);
  assert.doesNotMatch(JSON.stringify(anonymous.data), /fixture-owner-key/);
  const explicit = await rpc(base, "/mcp", "tools/call", { "X-API-Key": "fixture-user-key" }, tool);
  assert.equal(explicit.data.result.structuredContent.result.key, "fixture-user-key");
  assert.equal((await fetch(base + "/chatgpt/mcp")).status, 404);
});

test("ChatGPT endpoint authenticates independently and preserves API-credit calls", async (t) => {
  const base = await launch(t, true);
  const metadata = await (await fetch(base + "/.well-known/oauth-protected-resource/chatgpt/mcp")).json();
  assert.equal(metadata.resource, "https://mcp.example.test/chatgpt/mcp");
  for (const [path, headers] of [
    ["/chatgpt/mcp", {}],
    ["/chatgpt/mcp?key=fixture-user-key", { "X-API-Key": "fixture-user-key" }],
    ["/chatgpt/mcp", { Authorization: "Bearer revoked" }],
  ]) {
    const { response } = await rpc(base, path, "tools/list", headers);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /oauth-protected-resource/);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const results = await Promise.all(["account-a", "account-b"].map((account) =>
    rpc(base, "/chatgpt/mcp?key=wrong-account", "tools/call", {
      Authorization: `Bearer ${account}`, "X-API-Key": "wrong-account", "X-Web-Session": "fixture-web-session",
    }, tool)));
  assert.deepEqual(results.map(({ data }) => data.result.structuredContent.result), [
    { fixture: true, key: "fixture-key-account-a", webSession: null },
    { fixture: true, key: "fixture-key-account-b", webSession: null },
  ]);
  assert.equal((await fetch(base + "/chatgpt/mcp", { headers: { Authorization: "Bearer account-a" } })).status, 405);
});
