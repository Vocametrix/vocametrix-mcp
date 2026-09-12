#!/usr/bin/env node
// Batch test of every single-audio-input MCP tool against a remote MCP server.
//
// Strategy: upload once via vocametrix_upload_audio, then call every analysis
// tool with the returned blobUrl. Print a pass/fail/timing table at the end.
//
// Run:
//   node tests/batch-audio-tools.mjs [--url <mcp-url>] [--wav <path>] [--timeout-ms 240000]

import { remoteAuthHeaders } from './remote-auth.mjs';
import { readFileSync, statSync } from "node:fs";
import { performance } from "node:perf_hooks";

const DEFAULTS = {
  url: "https://independent-happiness-production-75b7.up.railway.app/mcp",
  wav: "D:\\Github\\aphasix-model-fine-tuning\\data\\phase3_short_words\\713 Batch de 25\\batch_ABEILLE\\wavs\\abeille___2025-11-20___001.wav",
  timeoutMs: 240000,
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--url") out.url = next();
    else if (a === "--wav") out.wav = next();
    else if (a === "--timeout-ms") out.timeoutMs = Number(next());
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
let rpcId = 0;

async function rpc(method, params, perCallTimeoutMs) {
  const id = ++rpcId;
  const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(new Error(`Timeout ${perCallTimeoutMs ?? args.timeoutMs}ms`)), perCallTimeoutMs ?? args.timeoutMs);
  const t0 = performance.now();
  let resp;
  try {
    resp = await fetch(args.url, {
      method: "POST",
      headers: { ...remoteAuthHeaders(), "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
      body, signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(tid);
    return { ok: false, dt: performance.now() - t0, error: e?.message ?? "fetch-error", body: "" };
  } finally { clearTimeout(tid); }
  const ctype = resp.headers.get("content-type") ?? "";
  let bodyText = "";
  if (ctype.includes("text/event-stream")) {
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = "", done = false, last = "";
    while (!done) {
      const { value, done: d } = await reader.read(); done = d;
      if (value) buf += dec.decode(value, { stream: true });
      let b;
      while ((b = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, b); buf = buf.slice(b + 2);
        const dl = block.split("\n").find(l => l.startsWith("data:"));
        if (dl) last = dl.slice(5).trim();
      }
    }
    bodyText = last;
  } else { bodyText = await resp.text(); }
  const dt = performance.now() - t0;
  if (!resp.ok) return { ok: false, dt, error: `HTTP ${resp.status}`, body: bodyText.slice(0, 300) };
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { return { ok: false, dt, error: "non-JSON", body: bodyText.slice(0, 300) }; }
  if (parsed.error) return { ok: false, dt, error: `RPC ${parsed.error.code}`, body: parsed.error.message };
  return { ok: true, dt, result: parsed.result };
}

function isToolError(result) {
  return result?.isError === true;
}

function extractText(result) {
  return result?.content?.find?.(c => c.type === "text")?.text ?? "";
}

function pad(s, n) { return (s + " ".repeat(n)).slice(0, n); }
function ms(n) { return `${n.toFixed(0)}ms`; }

async function main() {
  console.log(`url: ${args.url.replace(/(key=)[^&]+/, "$1<redacted>")}`);
  console.log(`wav: ${args.wav}`);

  const stat = statSync(args.wav);
  const b64 = readFileSync(args.wav).toString("base64");
  console.log(`wav size: ${(stat.size/1024).toFixed(1)} KB  base64: ${(b64.length/1024).toFixed(1)} KB\n`);

  console.log("── initialize ──");
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "batch-audio-tools", version: "0.1.0" },
  });
  if (!init.ok) { console.error("initialize failed:", init); process.exit(1); }
  console.log(`  ok (${ms(init.dt)})`);

  console.log("\n── upload ──");
  const up = await rpc("tools/call", { name: "vocametrix_upload_audio", arguments: { audioBase64: b64 } });
  if (!up.ok || isToolError(up.result)) { console.error("upload failed:", JSON.stringify(up).slice(0,500)); process.exit(1); }
  let blobUrl;
  try {
    const t = extractText(up.result);
    const parsed = JSON.parse(t);
    blobUrl = parsed.blobUrl ?? parsed.result?.blobUrl;
  } catch { blobUrl = up.result?.structuredContent?.result?.blobUrl ?? up.result?.structuredContent?.blobUrl; }
  if (!blobUrl) { console.error("no blobUrl in upload result"); process.exit(1); }
  console.log(`  ok (${ms(up.dt)})  blobUrl extracted`);

  // Tools to test: only single-audio analyses, audioPath-based.
  // For clip "abeille" (short word, ~1s), sustained-vowel tools will give nonsense
  // numbers, but they should not crash or loop.
  const tests = [
    { name: "vocametrix_measure_sound_level",    args: { audioPath: blobUrl, startSec: 0.1 } },
    { name: "vocametrix_extract_egemaps",        args: { audioPath: blobUrl } },
    { name: "vocametrix_detect_phonemes",        args: { audioPath: blobUrl } },
    { name: "vocametrix_detect_phonemes",        label: "detect_phonemes (logatome)", args: { audioPath: blobUrl, model: "logatome-champion" } },
    { name: "vocametrix_classify_stuttering",    args: { audioPath: blobUrl, pollIntervalMs: 3000, timeoutMs: 120000 }, perToolTimeoutMs: 150000 },
    { name: "vocametrix_calculate_cpp",          args: { sustainedVowelPath: blobUrl } },
    { name: "vocametrix_calculate_hnr",          args: { sustainedVowelPath: blobUrl, patientAge: 41, patientGender: "1" } },
    { name: "vocametrix_calculate_jitter_shimmer", args: { sustainedVowelPath: blobUrl } },
    { name: "vocametrix_calculate_spectral",     args: { sustainedVowelPath: blobUrl, patientAge: 41, patientGender: "1" } },
    { name: "vocametrix_calculate_formants",     args: { sustainedVowelPath: blobUrl, patientAge: 41, patientGender: "1" } },
    { name: "vocametrix_calculate_gne",          args: { sustainedVowelPath: blobUrl } },
    { name: "vocametrix_calculate_h1_h2",        args: { sustainedVowelPath: blobUrl } },
    { name: "vocametrix_calculate_voice_dynamics", args: { sustainedVowelPath: blobUrl, patientAge: 41, patientGender: "1" } },
    { name: "vocametrix_transcribe_audio",       args: { audioPath: blobUrl, speakerLocale: "fr-FR" } },
    { name: "vocametrix_assess_pronunciation",   args: { audioPath: blobUrl, referenceText: "abeille", speakerLocale: "fr-FR" } },
  ];

  console.log(`\n── batch (${tests.length} tools) ──`);
  const rows = [];
  for (const t of tests) {
    const label = t.label ?? t.name.replace(/^vocametrix_/, "");
    process.stdout.write(`  ${pad(label, 38)} … `);
    const r = await rpc("tools/call", { name: t.name, arguments: t.args }, t.perToolTimeoutMs);
    const toolErr = isToolError(r.result);
    const status = !r.ok ? "RPC-ERR" : toolErr ? "TOOL-ERR" : "OK";
    let detail = "";
    if (status !== "OK") {
      const txt = extractText(r.result) || r.error || JSON.stringify(r.result).slice(0,200);
      detail = txt.slice(0, 160).replace(/\s+/g, " ");
    }
    console.log(`${status}  ${ms(r.dt)}  ${detail}`);
    rows.push({ label, status, ms: r.dt, detail });
  }

  console.log("\n── summary ──");
  const okN = rows.filter(r => r.status === "OK").length;
  const failN = rows.length - okN;
  console.log(`  ${okN}/${rows.length} OK, ${failN} failed`);
  if (failN) {
    console.log("\n  Failures:");
    for (const r of rows.filter(r => r.status !== "OK")) {
      console.log(`    - ${r.label}: ${r.status} — ${r.detail}`);
    }
  }
  process.exit(failN === 0 ? 0 : 2);
}

main().catch(e => { console.error("fatal:", e?.message ?? e); process.exit(1); });
