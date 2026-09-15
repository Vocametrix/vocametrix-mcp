import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, ANALYSIS_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";
import { audioPath, gender, age } from "../../schemas/common.js";

export function registerAdvancedVoiceTools(server: McpServer, client: ApiClient): void {
  // ── Spectral Advanced ────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_spectral",
    "Extract advanced spectral measures from a sustained vowel: center of gravity, skewness/kurtosis, " +
    "H1-H2 (breathiness indicator), H1-A1, H1-A3, LTAS slope and tilt, alpha ratio. " +
    "Returns age/gender-normalized norms and voice pattern classification. " +
    "BEFORE CALLING: Confirm the user has a sustained vowel recording " +
    "(/a/ held at comfortable pitch for 3+ s, minimal background noise). " +
    "If not, explain what it is and ask them to record one. " +
    "Do not pass connected speech or conversational audio.",
    {
      sustainedVowelPath: audioPath.describe("Sustained vowel /a/ WAV file (/a/ held 3+ s at comfortable pitch)"),
      patientAge: age,
      patientGender: gender,
      version: z.string().optional().default("v01").describe("Algorithm version (default: 'v01')"),
    },
    ANALYSIS_TOOL,
    async ({ sustainedVowelPath, patientAge, patientGender, version }) => {
      try {
        const svId = await client.uploadFileId(sustainedVowelPath);
        const result = await client.get("/api/calculate-spectral-advanced", {
          svFileId: svId,
          age: String(patientAge),
          gender: patientGender,
          version: version ?? "v01",
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Formant Statistics ───────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_formants",
    "Compute F1–F4 formant statistics (mean, SD, range, CV, IQR) from a sustained vowel " +
    "with vowel-space stability and articulatory precision scores. " +
    "Useful for dysarthria assessment, vowel space analysis, and cleft palate evaluation. " +
    "BEFORE CALLING: Confirm the user has a sustained vowel recording " +
    "(/a/ held at comfortable pitch for 3+ s, minimal background noise). " +
    "If not, explain what it is and ask them to record one. " +
    "Do not pass connected speech or conversational audio.",
    {
      sustainedVowelPath: audioPath.describe("Sustained vowel /a/ WAV file (/a/ held 3+ s at comfortable pitch)"),
      patientAge: age,
      patientGender: gender,
    },
    ANALYSIS_TOOL,
    async ({ sustainedVowelPath, patientAge, patientGender }) => {
      try {
        const svId = await client.uploadFileId(sustainedVowelPath);
        const result = await client.get("/api/calculate-formant-statistics", {
          svFileId: svId,
          age: String(patientAge),
          gender: patientGender,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── S/Z Ratio ───────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_sz_ratio",
    "Calculate the S/Z phonation ratio (duration of sustained /s/ vs /z/). " +
    "Normal ratio ≈ 1.0. Ratio > 1.4 suggests vocal fold pathology (the /z/ is shorter). " +
    "Requires two separate recordings: one of sustained /s/ and one of sustained /z/. " +
    "BEFORE CALLING: Confirm the user has TWO separate recordings — " +
    "one of sustained /s/ (voiceless hiss, like a snake) and one of /z/ (voiced buzz, like a bee), " +
    "each 3–5 s. If not, explain the difference between them and ask the user to record both.",
    {
      sFilePath: audioPath.describe("Recording of sustained /s/ phonation (voiceless)"),
      zFilePath: audioPath.describe("Recording of sustained /z/ phonation (voiced)"),
      patientAge: age,
      patientGender: gender.default("1"),
      clinicalContext: z
        .enum(["screening", "therapy", "neurological", "post-surgical"])
        .optional()
        .describe("Clinical context for threshold interpretation"),
    },
    ANALYSIS_TOOL,
    async ({ sFilePath, zFilePath, patientAge, patientGender, clinicalContext }) => {
      try {
        const sId = await client.uploadFileId(sFilePath);
        const zId = await client.uploadFileId(zFilePath);
        const params: Record<string, string> = {
          sFileId: sId,
          zFileId: zId,
          patientAge: String(patientAge),
          gender: patientGender,
        };
        if (clinicalContext) params["clinicalContext"] = clinicalContext;
        const result = await client.get("/api/calculate-sz-ratio", params);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── GNE ─────────────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_gne",
    "Calculate the Glottal-to-Noise Excitation (GNE) ratio from a sustained vowel. " +
    "GNE ranges 0–1; values < 0.5 suggest increased noise (breathiness/hoarseness). " +
    "Computed via native Praat algorithm for clinical reliability. " +
    "BEFORE CALLING: Confirm the user has a sustained vowel recording " +
    "(/a/ held at comfortable pitch for 3+ s, minimal background noise). " +
    "If not, explain what it is and ask them to record one. " +
    "Do not pass connected speech or conversational audio.",
    {
      sustainedVowelPath: audioPath.describe("Sustained vowel /a/ WAV file (/a/ held 3+ s at comfortable pitch)"),
    },
    ANALYSIS_TOOL,
    async ({ sustainedVowelPath }) => {
      try {
        const svId = await client.uploadFileId(sustainedVowelPath);
        const result = await client.get("/api/calculate-gne", { svFileId: svId });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── H1-H2 ───────────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_h1_h2",
    "Calculate the formant-corrected H1*–H2* voice source measure from a sustained vowel. " +
    "H1*–H2* is sensitive to breathiness: positive values indicate breathy voice, " +
    "negative values indicate pressed/tense voice. Normal range: −2 to +2 dB. " +
    "BEFORE CALLING: Confirm the user has a sustained vowel recording " +
    "(/a/ held at comfortable pitch for 3+ s, minimal background noise). " +
    "If not, explain what it is and ask them to record one. " +
    "Do not pass connected speech or conversational audio.",
    {
      sustainedVowelPath: audioPath.describe("Sustained vowel /a/ WAV file (/a/ held 3+ s at comfortable pitch)"),
      patientGender: gender.default("1"),
    },
    ANALYSIS_TOOL,
    async ({ sustainedVowelPath, patientGender }) => {
      try {
        const svId = await client.uploadFileId(sustainedVowelPath);
        const result = await client.get("/api/calculate-h1-h2", {
          svFileId: svId,
          gender: patientGender,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── ABI ─────────────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_abi",
    "Calculate the Acoustic Breathiness Index (ABI) combining connected speech and sustained vowel. " +
    "ABI aggregates CPPS, jitter, GNE approximation, HNR (6 kHz), H1-H2, shimmer, and period SD. " +
    "Sensitive to the full spectrum from breathy to pressed phonation. " +
    "BEFORE CALLING: (1) Ask for or infer the patient language (en/fr/nl/es/de/it). " +
    "(2) Show the user the correct connected speech sentence for that language " +
    "(read vocametrix://recording-guide to get it) and ask them to record it. " +
    "(3) Confirm they also have a sustained /a/ vowel recording of 5+ s. " +
    "Only call once both recordings are confirmed ready.",
    {
      connectedSpeechPath: audioPath.describe("Connected speech WAV file — patient reads the language-specific reference sentence (see vocametrix://recording-guide)"),
      sustainedVowelPath: audioPath.describe("Sustained vowel /a/ WAV file (5+ s)"),
      language: z.enum(["en", "fr", "nl", "es", "de", "it"]).describe("Patient language — determines the correct connected speech reference sentence"),
    },
    ANALYSIS_TOOL,
    async ({ connectedSpeechPath, sustainedVowelPath, language: _language }) => {
      try {
        const csId = await client.uploadFileId(connectedSpeechPath);
        const svId = await client.uploadFileId(sustainedVowelPath);
        const result = await client.get("/api/calculate-abi", {
          csFileId: csId,
          svFileId: svId,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Voice Dynamics ───────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_calculate_voice_dynamics",
    "Compute intensity dynamics, pitch-intensity correlation, and composite scores for " +
    "voice control, projection, stability, effort, and monotonicity. " +
    "Useful for voice training, public speaking coaching, and vocal fatigue assessment. " +
    "BEFORE CALLING: Confirm the user has a sustained vowel recording " +
    "(/a/ held at comfortable pitch for 3+ s, minimal background noise). " +
    "If not, explain what it is and ask them to record one. " +
    "Do not pass connected speech or conversational audio.",
    {
      sustainedVowelPath: audioPath.describe("Sustained vowel /a/ WAV file (/a/ held 3+ s at comfortable pitch)"),
      patientAge: age,
      patientGender: gender.default("1"),
    },
    ANALYSIS_TOOL,
    async ({ sustainedVowelPath, patientAge, patientGender }) => {
      try {
        const svId = await client.uploadFileId(sustainedVowelPath);
        const result = await client.get("/api/calculate-voice-dynamics", {
          svFileId: svId,
          age: String(patientAge),
          gender: patientGender,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
