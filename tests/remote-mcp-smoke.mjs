#!/usr/bin/env node
// Smoke test for the remote Vocametrix MCP server.
//
// What it does
//   1. Reads a local WAV and base64-encodes it.
//   2. Speaks raw JSON-RPC to the MCP endpoint:
//        initialize
//        tools/call vocametrix_upload_audio       (base64 -> { blobUrl })
//        tools/call vocametrix_transcribe_audio   (uses returned blobUrl)
//   3. Reports per-step timing, request/response sizes, and full payloads.
//
// Run:
//   node tests/remote-mcp-smoke.mjs [--url <mcp-url>] [--wav <path>] [--locale fr-FR]
//                                   [--tool transcribe|phonemes] [--model <name>] [--timeout-ms 180000]
//
// Defaults are set for the Railway deployment and the user-supplied WAV.

import { remoteAuthHeaders } from './remote-auth.mjs';
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";

const DEFAULTS = {
  url: "https://independent-happiness-production-75b7.up.railway.app/mcp",
  wav: "D:\\Github\\aphasix-model-fine-tuning\\data\\phase3_short_words\\713 Batch de 25\\batch_ABEILLE\\wavs\\abeille___2025-11-20___001.wav",
  locale: "fr-FR",
  tool: "transcribe",  // transcribe | phonemes
  model: null,         // optional, e.g. "logatome-champion" for phonemes
  timeoutMs: 180000,
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--url") out.url = next();
    else if (a === "--wav") out.wav = next();
    else if (a === "--locale") out.locale = next();
    else if (a === "--tool") out.tool = next();
    else if (a === "--model") out.model = next();
    else if (a === "--timeout-ms") out.timeoutMs = Number(next());
    else if (a === "--help" || a === "-h") {
      console.log("Usage: node tests/remote-mcp-smoke.mjs [--url <u>] [--wav <p>] [--locale <bcp47>] [--tool transcribe|phonemes] [--model <name>] [--timeout-ms <n>]");
      process.exit(0);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

function ms(n) { return `${n.toFixed(0)}ms`; }
function kb(n) { return `${(n / 1024).toFixed(1)} KB`; }
function preview(s, n = 400) {
  if (s.length <= n) return s;
  return s.slice(0, n) + ` …(+${s.length - n} chars)`;
}

let rpcId = 0;
function nextId() { return ++rpcId; }

async function rpc(method, params, { stepLabel }) {
  const id = nextId();
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  const reqBytes = Buffer.byteLength(body, "utf8");

  console.log(`\n── ${stepLabel} ────────────────────────────────────────────`);
  console.log(`  → method=${method}  id=${id}  req=${kb(reqBytes)}`);

  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(new Error(`Client timeout after ${args.timeoutMs}ms`)), args.timeoutMs);
  const t0 = performance.now();

  let resp;
  try {
    resp = await fetch(args.url, {
      method: "POST",
      headers: { ...remoteAuthHeaders(),
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body,
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(tid);
    const dt = performance.now() - t0;
    console.log(`  ✗ fetch failed after ${ms(dt)}: ${err?.message ?? err}`);
    throw err;
  }

  const ttfb = performance.now() - t0;
  const ctype = resp.headers.get("content-type") ?? "";
  console.log(`  ← HTTP ${resp.status}  ttfb=${ms(ttfb)}  content-type=${ctype}`);

  let bodyText = "";
  let lastFrame = "";
  let frameCount = 0;
  let firstFrameAt = null;

  if (ctype.includes("text/event-stream")) {
    // Read SSE stream — collect data: frames, parse last as JSON-RPC response.
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let done = false;
    while (!done) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) buf += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, boundary);
        buf = buf.slice(boundary + 2);
        const dataLine = block.split("\n").find((l) => l.startsWith("data:"));
        if (dataLine) {
          if (firstFrameAt === null) firstFrameAt = performance.now() - t0;
          frameCount++;
          lastFrame = dataLine.slice(5).trim();
        }
      }
    }
    bodyText = lastFrame;
    console.log(`  · SSE frames=${frameCount}  firstFrame=${firstFrameAt ? ms(firstFrameAt) : "n/a"}`);
  } else {
    bodyText = await resp.text();
  }

  const total = performance.now() - t0;
  const respBytes = Buffer.byteLength(bodyText, "utf8");
  console.log(`  · total=${ms(total)}  resp=${kb(respBytes)}`);

  clearTimeout(tid);

  if (!resp.ok) {
    console.log(`  ! body: ${preview(bodyText)}`);
    throw new Error(`HTTP ${resp.status}`);
  }

  let parsed;
  try { parsed = JSON.parse(bodyText); }
  catch {
    console.log(`  ! non-JSON body: ${preview(bodyText)}`);
    throw new Error("Response was not JSON");
  }

  if (parsed.error) {
    console.log(`  ✗ JSON-RPC error: ${JSON.stringify(parsed.error)}`);
    throw new Error(`RPC error: ${parsed.error.message}`);
  }

  console.log(`  ✓ result preview: ${preview(JSON.stringify(parsed.result))}`);
  return parsed.result;
}

async function main() {
  console.log("Vocametrix remote MCP smoke test");
  console.log("================================");
  console.log(`url      : ${args.url.replace(/(key=)[^&]+/, "$1<redacted>")}`);
  console.log(`wav      : ${args.wav}`);
  console.log(`locale   : ${args.locale}`);
  console.log(`tool     : ${args.tool}${args.model ? `  model=${args.model}` : ""}`);
  console.log(`timeout  : ${args.timeoutMs}ms`);

  const stat = statSync(args.wav);
  const wavBytes = readFileSync(args.wav);
  const b64 = wavBytes.toString("base64");
  console.log(`wav size : ${kb(stat.size)} on disk  →  ${kb(b64.length)} base64`);

  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "vocametrix-mcp-smoke-test", version: "0.1.0" },
  }, { stepLabel: "STEP 1  initialize" });

  const uploadResult = await rpc("tools/call", {
    name: "vocametrix_upload_audio",
    arguments: { audioBase64: b64 },
  }, { stepLabel: "STEP 2  tools/call vocametrix_upload_audio" });

  // Extract blobUrl from MCP tool result envelope (either structuredContent or text content).
  const blobUrl = extractBlobUrl(uploadResult);
  if (!blobUrl) {
    console.log("\n✗ Could not extract blobUrl from upload result. Full result:");
    console.log(JSON.stringify(uploadResult, null, 2));
    process.exit(2);
  }
  console.log(`\n  blobUrl: ${blobUrl}`);

  if (args.tool === "phonemes") {
    const toolArgs = { audioPath: blobUrl };
    if (args.model) toolArgs.model = args.model;
    await rpc("tools/call", {
      name: "vocametrix_detect_phonemes",
      arguments: toolArgs,
    }, { stepLabel: "STEP 3  tools/call vocametrix_detect_phonemes (fr-FR)" });
  } else {
    await rpc("tools/call", {
      name: "vocametrix_transcribe_audio",
      arguments: { audioPath: blobUrl, speakerLocale: args.locale },
    }, { stepLabel: "STEP 3  tools/call vocametrix_transcribe_audio" });
  }

  console.log("\n✓ Smoke test completed without client-side timeout.");
}

function extractBlobUrl(result) {
  // MCP tool result shape: { content: [{ type:'text', text:'...' }], structuredContent?: {...} }
  if (result?.structuredContent?.blobUrl) return result.structuredContent.blobUrl;
  const text = result?.content?.find?.((c) => c.type === "text")?.text;
  if (typeof text === "string") {
    try {
      const obj = JSON.parse(text);
      if (obj.blobUrl) return obj.blobUrl;
      if (obj.result?.blobUrl) return obj.result.blobUrl;
    } catch { /* not JSON */ }
    const m = text.match(/https?:\/\/[^\s"']+/);
    if (m) return m[0];
  }
  return null;
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err?.message ?? err);
  process.exit(1);
});
