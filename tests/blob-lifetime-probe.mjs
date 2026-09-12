#!/usr/bin/env node
// Probe: does the Vocametrix API consume/delete the audio blob after one tool call?
// Strategy: upload once, then GET the blob URL twice — once directly, once after each tool call.
//
// Run:
//   node tests/blob-lifetime-probe.mjs [--url <mcp-url>] [--wav <path>]

import { remoteAuthHeaders } from './remote-auth.mjs';
import { readFileSync } from "node:fs";

const ARGS = {
  url: "https://independent-happiness-production-75b7.up.railway.app/mcp",
  wav: "D:\\Github\\aphasix-model-fine-tuning\\data\\phase3_short_words\\713 Batch de 25\\batch_ABEILLE\\wavs\\abeille___2025-11-20___001.wav",
};
for (let i = 0; i < process.argv.length - 2; i++) {
  const a = process.argv[2 + i];
  if (a === "--url") ARGS.url = process.argv[2 + ++i];
  if (a === "--wav") ARGS.wav = process.argv[2 + ++i];
}

let rpcId = 0;
async function rpc(method, params) {
  const id = ++rpcId;
  const resp = await fetch(ARGS.url, {
    method: "POST",
    headers: { ...remoteAuthHeaders(), "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const ctype = resp.headers.get("content-type") ?? "";
  let text = "";
  if (ctype.includes("text/event-stream")) {
    const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = "", done = false;
    while (!done) {
      const { value, done: d } = await reader.read(); done = d;
      if (value) buf += dec.decode(value, { stream: true });
      let b;
      while ((b = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, b); buf = buf.slice(b + 2);
        const dl = block.split("\n").find(l => l.startsWith("data:"));
        if (dl) text = dl.slice(5).trim();
      }
    }
  } else { text = await resp.text(); }
  return JSON.parse(text);
}
const textOf = (r) => r?.content?.find?.(c => c.type === "text")?.text ?? "";

async function probeBlob(label, url) {
  const r = await fetch(url, { method: "HEAD" });
  console.log(`  ${label}: HTTP ${r.status} ${r.statusText}`);
  return r.ok;
}

async function main() {
  console.log("Initialize…");
  await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "0.1.0" } });

  console.log("\nUpload…");
  const b64 = readFileSync(ARGS.wav).toString("base64");
  const upRes = await rpc("tools/call", { name: "vocametrix_upload_audio", arguments: { audioBase64: b64 } });
  const blobUrl = JSON.parse(textOf(upRes.result)).blobUrl;
  console.log(`  blobUrl: ${blobUrl.slice(0, 100)}…`);

  console.log("\nBlob alive immediately after upload?");
  await probeBlob("HEAD #1 (post-upload, pre-any-tool)", blobUrl);

  console.log("\nCall vocametrix_detect_phonemes (uses uploadFileId → downloads blob, gets fileId)…");
  const r1 = await rpc("tools/call", { name: "vocametrix_detect_phonemes", arguments: { audioPath: blobUrl } });
  console.log(`  result: ${textOf(r1.result).slice(0, 80)}…`);

  console.log("\nBlob still alive after one tool call?");
  await probeBlob("HEAD #2 (post-detect_phonemes)", blobUrl);

  console.log("\nCall vocametrix_calculate_cpp (uploadFileId again)…");
  const r2 = await rpc("tools/call", { name: "vocametrix_calculate_cpp", arguments: { sustainedVowelPath: blobUrl } });
  console.log(`  result: ${textOf(r2.result).slice(0, 80)}…`);

  console.log("\nBlob alive after second tool?");
  await probeBlob("HEAD #3 (post-calculate_cpp)", blobUrl);

  console.log("\nCall vocametrix_calculate_hnr (third tool)…");
  const r3 = await rpc("tools/call", { name: "vocametrix_calculate_hnr", arguments: { sustainedVowelPath: blobUrl, patientAge: 41, patientGender: "1" } });
  console.log(`  result: ${textOf(r3.result).slice(0, 80)}…`);

  console.log("\nBlob alive after third tool?");
  await probeBlob("HEAD #4 (post-calculate_hnr)", blobUrl);
}
main().catch(e => { console.error("fatal:", e); process.exit(1); });
