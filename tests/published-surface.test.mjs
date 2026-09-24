import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:net";

// What the hosted server publishes, checked against the running server rather
// than against the source, since registration is conditional. No network calls
// leave the child process and no API credits are spent.

const OAUTH = {
  MCP_OAUTH_RESOURCE: "https://mcp.example.test/chatgpt/mcp",
  MCP_OAUTH_ISSUER: "https://platform.example.test",
  MCP_OAUTH_INTROSPECTION_SECRET: "synthetic-introspection-secret-for-tests",
};

async function launch(t, { localFilesystem, oauth = false }) {
  const directory = await mkdtemp(join(tmpdir(), "vocametrix-surface-"));
  const preload = join(directory, "fixture.mjs");
  await writeFile(preload, `
    globalThis.fetch = async (url) => {
      // Synthetic introspection so the ChatGPT endpoint can be listed offline.
      if (String(url) === ${JSON.stringify(OAUTH.MCP_OAUTH_ISSUER + "/oauth/mcp/introspect")}) {
        return new Response(JSON.stringify({
          active: true, issuer: ${JSON.stringify(OAUTH.MCP_OAUTH_ISSUER)}, audience: ${JSON.stringify(OAUTH.MCP_OAUTH_RESOURCE)},
          scope: "vocametrix:api", subject: "fixture-user", apiKey: "fixture-oauth-key",
          expiresAt: Math.floor(Date.now() / 1000) + 900,
        }));
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
  if (oauth) Object.assign(env, OAUTH);
  if (localFilesystem) env.VOCAMETRIX_MCP_LOCAL_FS = "1";
  else delete env.VOCAMETRIX_MCP_LOCAL_FS;
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

async function listTools(base, path = "/mcp") {
  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      ...(path === "/mcp" ? {} : { Authorization: "Bearer fixture-token" }),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const text = await response.text();
  const payload = text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data: "))?.slice(6) : text;
  return JSON.parse(payload).result.tools;
}

test("a tool that reads the filesystem is not published on the hosted server", async (t) => {
  // Its folder argument would name the server's disk, not the caller's.
  const hosted = await listTools(await launch(t, { localFilesystem: false }));
  assert.equal(hosted.find((tool) => tool.name === "vocametrix_batch_pronunciation"), undefined);

  const local = await listTools(await launch(t, { localFilesystem: true }));
  assert.ok(local.find((tool) => tool.name === "vocametrix_batch_pronunciation"),
    "still available where the filesystem belongs to the user");
});

test("therapy planning is not published to ChatGPT", async (t) => {
  // It takes a patient identifier and clinical history: protected health
  // information under the ChatGPT app guidelines.
  const therapy = [
    "vocametrix_generate_therapy_plan", "vocametrix_get_therapy_status", "vocametrix_get_therapy_result",
    "vocametrix_approve_therapy_plan", "vocametrix_full_therapy_workflow",
  ];
  const base = await launch(t, { localFilesystem: false, oauth: true });
  const chatgpt = (await listTools(base, "/chatgpt/mcp")).map((tool) => tool.name);
  assert.ok(chatgpt.length > 0, "the ChatGPT endpoint still lists its tools");
  assert.deepEqual(therapy.filter((name) => chatgpt.includes(name)), []);

  const direct = (await listTools(base)).map((tool) => tool.name);
  assert.deepEqual(therapy.filter((name) => !direct.includes(name)), [], "still published on /mcp");
});

test("no billed tool invites the client to replay it for free", async (t) => {
  // readOnlyHint plus idempotentHint says "costs nothing, repeat at will".
  // Only the two therapy lookups may say that; everything else spends credits.
  const free = new Set(["vocametrix_get_therapy_status", "vocametrix_get_therapy_result"]);
  const tools = await listTools(await launch(t, { localFilesystem: false }));
  const claiming = tools
    .filter((tool) => tool.annotations?.readOnlyHint === true)
    .map((tool) => tool.name)
    .filter((name) => !free.has(name));
  assert.deepEqual(claiming, [], `these spend API credits but claim to be read-only: ${claiming.join(", ")}`);
});

test("tools that change nothing are not announced as destructive", async (t) => {
  // destructiveHint defaults to true once readOnlyHint is false, so every
  // additive tool has to say otherwise explicitly.
  const tools = await listTools(await launch(t, { localFilesystem: false }));
  const destructive = tools
    .filter((tool) => tool.annotations?.readOnlyHint === false && tool.annotations?.destructiveHint !== false)
    .map((tool) => tool.name);
  assert.deepEqual(destructive, ["vocametrix_approve_therapy_plan"],
    "only plan rejection actually destroys anything");
});

test("every tool states each hint the ChatGPT review asks for", async (t) => {
  // The plugin portal refuses to submit a tool that leaves a hint implicit,
  // including destructiveHint on read-only tools.
  const tools = await listTools(await launch(t, { localFilesystem: false }));
  const missing = tools.flatMap((tool) =>
    ["readOnlyHint", "destructiveHint", "openWorldHint"]
      .filter((hint) => typeof tool.annotations?.[hint] !== "boolean")
      .map((hint) => `${tool.name}.${hint}`));
  assert.deepEqual(missing, []);
});

test("ChatGPT attachments reach the hosted server as a file parameter", async (t) => {
  // ChatGPT only passes an attachment when the tool lists the parameter in
  // openai/fileParams and its schema matches the Apps SDK file object exactly.
  const hosted = await listTools(await launch(t, { localFilesystem: false }));
  const tool = hosted.find((x) => x.name === "vocametrix_upload_attachment");
  assert.ok(tool, "published on the hosted server");
  assert.deepEqual(tool._meta?.["openai/fileParams"], ["file"]);
  const file = tool.inputSchema.properties.file;
  assert.deepEqual(Object.keys(file.properties).sort(), ["download_url", "file_id", "file_name", "mime_type"]);
  assert.deepEqual([...file.required].sort(), ["download_url", "file_id"]);
  assert.equal(file.additionalProperties, false);

  const local = await listTools(await launch(t, { localFilesystem: true }));
  assert.equal(local.find((x) => x.name === "vocametrix_upload_attachment"), undefined,
    "no client sends file parameters to a local server");
});
