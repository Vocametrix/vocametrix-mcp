// Unit tests for resolveAudioInputToBuffer — runs each branch of the function
// without hitting the network for the URL branch.
//
// Run with:
//   npm run build
//   node --test tests/audio-input.test.mjs
//
// Or via the convenience script:
//   npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";

import { createServer } from "node:http";

import { resolveAudioInputToBuffer } from "../dist/utils/audio-input.js";
import { isBlockedAddress } from "../dist/utils/url-guard.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function clearLocalFsFlag() {
  delete process.env["VOCAMETRIX_MCP_LOCAL_FS"];
}

function withLocalFsFlag(fn) {
  process.env["VOCAMETRIX_MCP_LOCAL_FS"] = "1";
  try { return fn(); } finally { clearLocalFsFlag(); }
}

// A long, valid base64 string (≥ 512 chars) that decodes to a known byte pattern.
// Built from a 400-byte buffer so the encoded length is ~536 chars.
const KNOWN_BYTES = Buffer.from(Array.from({ length: 400 }, (_, i) => i % 256));
const KNOWN_B64 = KNOWN_BYTES.toString("base64");

// ── data: URL branch ────────────────────────────────────────────────────────

test("data: URL — decodes payload correctly", async () => {
  const dataUrl = `data:audio/wav;base64,${KNOWN_B64}`;
  const buf = await resolveAudioInputToBuffer(dataUrl);
  assert.deepEqual(buf, KNOWN_BYTES);
});

test("data: URL — rejects malformed input (no comma)", async () => {
  await assert.rejects(
    () => resolveAudioInputToBuffer("data:audio/wav;base64"),
    /Invalid data URL/
  );
});

// ── raw base64 branch ───────────────────────────────────────────────────────

test("raw base64 ≥ 512 chars — decodes correctly", async () => {
  const buf = await resolveAudioInputToBuffer(KNOWN_B64);
  assert.deepEqual(buf, KNOWN_BYTES);
});

test("raw base64 with whitespace — strips whitespace before decoding", async () => {
  // Insert newlines every 60 chars (PEM-style wrapping)
  const wrapped = KNOWN_B64.match(/.{1,60}/g).join("\n");
  const buf = await resolveAudioInputToBuffer(wrapped);
  assert.deepEqual(buf, KNOWN_BYTES);
});

test("short alphanumeric string — NOT treated as base64 (rejected as opaque)", async () => {
  clearLocalFsFlag();
  // A short opaque ID that happens to match base64 charset
  await assert.rejects(
    () => resolveAudioInputToBuffer("file-abc123XYZ"),
    /not a fetchable URL.*opaque attachment identifier/s
  );
});

// ── local path branch ───────────────────────────────────────────────────────

test("absolute path WITHOUT VOCAMETRIX_MCP_LOCAL_FS — actionable error", async () => {
  clearLocalFsFlag();
  await assert.rejects(
    () => resolveAudioInputToBuffer("/var/data/audio.wav"),
    /Local file paths are only readable in stdio\/local mode.*vocametrix_upload_audio/s
  );
});

test("absolute path WITH VOCAMETRIX_MCP_LOCAL_FS=1 — reads from disk", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "vcmx-test-"));
  const filePath = join(tmp, "fixture.wav");
  writeFileSync(filePath, KNOWN_BYTES);
  try {
    await withLocalFsFlag(async () => {
      const buf = await resolveAudioInputToBuffer(filePath);
      assert.deepEqual(buf, KNOWN_BYTES);
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Windows-style path WITHOUT flag — also rejected with same actionable error", async () => {
  clearLocalFsFlag();
  await assert.rejects(
    () => resolveAudioInputToBuffer("C:\\data\\audio.wav"),
    /Local file paths are only readable in stdio\/local mode/
  );
});

// ── opaque identifier branch ────────────────────────────────────────────────

test("opaque attachment identifier — error tells the LLM what to do", async () => {
  clearLocalFsFlag();
  await assert.rejects(
    () => resolveAudioInputToBuffer("attachment_01HXYZ"),
    /call vocametrix_upload_audio.*pass the returned blobUrl/s
  );
});

test("empty string — rejected as opaque, not crashing on path branch", async () => {
  clearLocalFsFlag();
  await assert.rejects(
    () => resolveAudioInputToBuffer(""),
    /opaque attachment identifier/
  );
});

// ── http(s) URL branch (real sockets, no external network) ──────────────

// The URL branch no longer goes through global fetch, so it cannot be stubbed:
// the point of the guard is that it validates the address the socket actually
// connects to. These tests therefore use a real loopback server, and the
// opt-in flag to reach it — the blocking itself is covered separately below,
// against literal addresses that need no server at all.

function withPrivateHosts(fn) {
  process.env["VOCAMETRIX_MCP_ALLOW_PRIVATE_HOSTS"] = "1";
  return Promise.resolve()
    .then(fn)
    .finally(() => { delete process.env["VOCAMETRIX_MCP_ALLOW_PRIVATE_HOSTS"]; });
}

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test("http URL — returns the served bytes", async () => {
  await withServer((req, res) => { res.writeHead(200); res.end(KNOWN_BYTES); }, (base) =>
    withPrivateHosts(async () => {
      const buf = await resolveAudioInputToBuffer(`${base}/audio.wav`);
      assert.deepEqual(buf, KNOWN_BYTES);
    }));
});

test("http URL with non-2xx response — surfaces the HTTP status", async () => {
  await withServer((req, res) => { res.writeHead(404); res.end(); }, (base) =>
    withPrivateHosts(() => assert.rejects(
      () => resolveAudioInputToBuffer(`${base}/missing.wav`),
      /Failed to download audio from URL: HTTP 404/
    )));
});

test("http URL — follows a redirect and returns the final bytes", async () => {
  await withServer((req, res) => {
    if (req.url === "/redirect") { res.writeHead(302, { location: "/audio.wav" }); res.end(); return; }
    res.writeHead(200); res.end(KNOWN_BYTES);
  }, (base) => withPrivateHosts(async () => {
    const buf = await resolveAudioInputToBuffer(`${base}/redirect`);
    assert.deepEqual(buf, KNOWN_BYTES);
  }));
});

test("http URL — refuses a redirect loop rather than following it forever", async () => {
  await withServer((req, res) => { res.writeHead(302, { location: "/loop" }); res.end(); },
    (base) => withPrivateHosts(() => assert.rejects(
      () => resolveAudioInputToBuffer(`${base}/loop`),
      /more than 5 redirects/
    )));
});

// ── SSRF guard — reported 2026-09-17, CWE-918 ─────────────────────────

// Before the guard, any caller-supplied URL was fetched server-side with no
// restriction on where it pointed. These are the destinations that must stay
// refused; they are literal addresses, so no name resolution and no server is
// involved — a failure here means the guard is gone, not that a host is down.

const REFUSED_TARGETS = [
  ["cloud metadata (link-local)", "http://169.254.169.254/latest/meta-data/"],
  ["loopback by address", "http://127.0.0.1:1/"],
  ["loopback by name", "http://localhost:1/"],
  ["RFC1918 10/8", "http://10.0.0.1/internal"],
  ["RFC1918 172.16/12", "http://172.16.0.1/internal"],
  ["RFC1918 192.168/16", "https://192.168.1.1/internal"],
  ["carrier-grade NAT", "http://100.64.0.1/"],
  ["IPv6 loopback", "http://[::1]:1/"],
  ["IPv6 unique-local", "http://[fc00::1]/"],
  ["IPv6 link-local", "http://[fe80::1]/"],
  ["IPv4 mapped into IPv6", "http://[::ffff:127.0.0.1]:1/"],
];

for (const [label, url] of REFUSED_TARGETS) {
  test(`SSRF guard — refuses ${label}`, async () => {
    await assert.rejects(
      () => resolveAudioInputToBuffer(url),
      /a private, loopback, link-local or otherwise reserved/,
      `${url} was not refused`
    );
  });
}

test("SSRF guard — refuses a redirect from a public host to an internal one", async () => {
  // The first hop is allowed to be loopback here only so the test needs no
  // external network; what is under test is that the SECOND hop is checked at
  // all, which is what fetch()'s automatic redirect-following would not do.
  await withServer((req, res) => {
    res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
    res.end();
  }, async (base) => {
    process.env["VOCAMETRIX_MCP_ALLOW_PRIVATE_HOSTS"] = "1";
    const first = await fetch(`${base}/r`, { redirect: "manual" });
    assert.equal(first.status, 302);          // the server really does redirect
    delete process.env["VOCAMETRIX_MCP_ALLOW_PRIVATE_HOSTS"];

    // Same URL, guard on: the first hop is refused, so reach the second hop by
    // pointing straight at the redirect target the server hands out.
    await assert.rejects(
      () => resolveAudioInputToBuffer(first.headers.get("location")),
      /a private, loopback, link-local or otherwise reserved/
    );
  });
});

test("SSRF guard — a public address is still allowed through", () => {
  // Negative control: a guard that refuses everything would pass every test above.
  assert.equal(isBlockedAddress("93.184.216.34"), false);
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946"), false);
  assert.equal(isBlockedAddress("169.254.169.254"), true);
});

test("only real audio containers pass the base64 upload check", async () => {
  const { looksLikeAudio } = await import("../dist/client.js");
  const pad = (head) => Buffer.concat([Buffer.from(head, "latin1"), Buffer.alloc(64)]);
  assert.equal(looksLikeAudio(Buffer.from("PLACEHOLDER", "base64")), false);
  assert.equal(looksLikeAudio(pad("hello, this is plain text and not a recording")), false);
  const wav = Buffer.alloc(64); wav.write("RIFF", 0, "latin1"); wav.write("WAVE", 8, "latin1");
  assert.equal(looksLikeAudio(wav), true);
  assert.equal(looksLikeAudio(pad("ID3")), true);
  assert.equal(looksLikeAudio(pad("fLaC")), true);
  assert.equal(looksLikeAudio(pad("OggS")), true);
});
