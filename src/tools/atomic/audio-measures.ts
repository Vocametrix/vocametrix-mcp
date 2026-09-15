import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, ANALYSIS_TOOL, STATEFUL_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";
import { audioPath } from "../../schemas/common.js";

export function registerAudioMeasureTools(server: McpServer, client: ApiClient): void {
  // ── Sound Level ──────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_measure_sound_level",
    "Measure sound level in dB SPL over a specified time window in an audio file. " +
    "Useful for environmental noise assessment, vocal loudness measurement, and calibration tasks. " +
    "Note: startSec must be > 0 (use 0.001 for the start of the file).",
    {
      audioPath: audioPath,
      startSec: z.number().min(0.001).default(0.001).describe("Start time in seconds (minimum 0.001)"),
      endSec: z.number().positive().optional().describe("End time in seconds (defaults to end of file)"),
    },
    ANALYSIS_TOOL,
    async ({ audioPath: path, startSec, endSec }) => {
      try {
        const blobUrl = await client.uploadBlobUrl(path);
        // API requires stop_sec; pass a large sentinel meaning "to end of file" when caller omits it.
        const stopSec = endSec ?? 999999;
        const result = await client.post("/api/soundLevel", { blobUrl, start_sec: startSec, stop_sec: stopSec });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── eGeMAPS ─────────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_extract_egemaps",
    "Extract the full openSMILE eGeMAPSv02 feature set (88 acoustic features) from a sustained vowel. " +
    "Features include F0, jitter, shimmer, HNR, MFCCs, formants, spectral flux, and loudness. " +
    "Commonly used as input to machine-learning voice pathology classifiers. " +
    "BEFORE CALLING: Confirm the user has a sustained vowel recording " +
    "(/a/ held at comfortable pitch for 3+ s, minimal background noise). " +
    "If not, explain what it is and ask them to record one. " +
    "Do not pass connected speech or conversational audio.",
    {
      audioPath: audioPath,
    },
    ANALYSIS_TOOL,
    async ({ audioPath: path }) => {
      try {
        const fileId = await client.uploadFileId(path);
        const result = await client.get("/api/gemaps-extract", { fileId });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Phoneme Detection ────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_detect_phonemes",
    "Detect French phonemes in an audio recording using a deep-learning classifier. " +
    "Returns phoneme labels with confidence scores and timestamps. French only. " +
    "By default uses the baseline model; pass model='logatome-champion' to use the " +
    "logatome-trained classifier (better accuracy on logatome-type utterances used in speech therapy).",
    {
      audioPath: audioPath,
      model: z.literal("logatome-champion").optional()
        .describe("Optional: pass 'logatome-champion' to use the logatome-trained classifier instead of the baseline"),
    },
    ANALYSIS_TOOL,
    async ({ audioPath: path, model }) => {
      try {
        const fileId = await client.uploadFileId(path);
        const body: Record<string, unknown> = { fileId, language: "fr-FR" };
        if (model) body["model"] = model;
        const result = await client.post("/api/analyze-phonemes-live", body);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Stuttering Classification ────────────────────────────────────────────────
  server.tool(
    "vocametrix_classify_stuttering",
    "Classify stuttering disfluency patterns in a speech recording (async, ~30–120 seconds). " +
    "Returns disfluency types (repetitions, prolongations, blocks), severity score, and fluency rate. " +
    "The tool polls the result automatically — no separate status call needed. " +
    "BEFORE CALLING: Confirm the user has a natural connected speech recording " +
    "(the patient speaking spontaneously or reading aloud). " +
    "A sustained vowel is not appropriate here — the recording must contain running speech.",
    {
      audioPath: audioPath,
      pollIntervalMs: z.number().int().min(1000).max(30000).default(5000)
        .describe("Polling interval in ms while waiting for result (default 5000)"),
      timeoutMs: z.number().int().min(10000).max(900000).default(620000)
        .describe("Maximum wait time in ms before giving up (default 620000 = ~10 min)"),
    },
    // Opens a classification session that outlives the call, so not read-only.
    STATEFUL_TOOL,
    async ({ audioPath: path, pollIntervalMs, timeoutMs }) => {
      try {
        const fileId = await client.uploadFileId(path);
        const startResult = await client.post("/api/classify-stuttering", { fileId }) as { session_id: string };
        const sessionId = startResult.session_id;

        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, pollIntervalMs));
          const status = await client.get(`/api/therapy-status/${sessionId}`) as Record<string, unknown>;
          const state = String(status["status"] ?? status["state"] ?? "");
          if (["completed", "succeeded", "done"].includes(state)) break;
          if (["failed", "error"].includes(state)) {
            // Only the backend's own explanation, never the whole status object:
            // its other fields are internal and would reach the model unexamined.
            const reason = typeof status["message"] === "string" ? `: ${status["message"]}` : ".";
            return { content: [{ type: "text" as const, text: `Classification failed${reason}` }], isError: true as const };
          }
        }

        const result = await client.get(`/api/therapy-result/${sessionId}`);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
