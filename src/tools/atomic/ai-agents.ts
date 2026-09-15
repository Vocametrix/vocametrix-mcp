import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, ANALYSIS_TOOL, STATEFUL_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

export function registerAiAgentTools(server: McpServer, client: ApiClient): void {
  // ── Interpret Voice Metrics ──────────────────────────────────────────────────
  server.tool(
    "vocametrix_interpret_voice_metrics",
    "Translate raw voice metrics (jitter, shimmer, HNR, CPPS, F0, etc.) into clinical-language interpretation " +
    "with severity classification (normal / mild / moderate / severe) and actionable recommendations. " +
    "Useful when you have metric values from other tools and want a clinician-readable summary. " +
    "BEFORE CALLING: Pass metrics that come from Vocametrix measurement tools " +
    "(e.g. vocametrix_calculate_jitter_shimmer, vocametrix_calculate_hnr, vocametrix_calculate_cpp). " +
    "Do not invent or estimate values — passing arbitrary numbers produces misleading clinical output.",
    {
      metrics: z.record(z.unknown()).describe("Voice metrics object (e.g. { jitter: 1.2, shimmer: 3.5, hnr: 18.0 })"),
      patientAge: z.number().int().min(0).max(120).describe("Patient age in years (0–120)"),
      patientGender: z.enum(["male", "female", "other"]).default("male").describe("Patient biological sex for norm reference"),
      languageCode: z.string().optional().default("en").describe("Language for the report (en, fr, etc.)"),
    },
    ANALYSIS_TOOL,
    async ({ metrics, patientAge, patientGender, languageCode }) => {
      try {
        const result = await client.post("/api/voice-metrics-interpreter", {
          metrics,
          age: patientAge,
          gender: patientGender,
          languageCode,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Generate Exercises ───────────────────────────────────────────────────────
  server.tool(
    "vocametrix_generate_exercises",
    "Generate personalized speech therapy exercises tailored to patient profile, pathology, and language. " +
    "Returns structured exercises with instructions, target phonemes, difficulty level, and therapist tips.",
    {
      message: z.string().min(1).describe("Describe what exercises you need (e.g. 'breathing exercises for aphonia patient, age 45')"),
      ageLevel: z.string().describe("Patient age group (e.g. 'adult', 'child-6-10', 'elderly')"),
      speechChallenge: z.string().describe("Target speech challenge (e.g. 'stuttering', 'aphonia', 'dysarthria', 'articulation')"),
      language: z.string().default("en").describe("Exercise language (e.g. 'en', 'fr', 'es')"),
    },
    ANALYSIS_TOOL,
    async ({ message, ageLevel, speechChallenge, language }) => {
      try {
        const result = await client.post("/api/speech-exercise-generator", {
          message,
          ageLevel,
          speechChallenge,
          language,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Word List Generator ──────────────────────────────────────────────────────
  server.tool(
    "vocametrix_generate_word_list",
    "Generate a word list targeting a specific phoneme with pronunciation hints and difficulty progression. " +
    "Useful for articulation therapy, phonological awareness drills, and accent training.",
    {
      language: z.string().describe("Language for word list (e.g. 'en', 'fr', 'es', 'et')"),
      patientAge: z.number().int().min(0).max(120).describe("Patient age in years — used to select age-appropriate vocabulary"),
      targetSound: z.object({
        symbol: z.string().describe("IPA or orthographic symbol (e.g. 'r', 'θ', 's')"),
        position: z.enum(["initial", "medial", "final"]).describe("Position of the sound in words"),
      }),
    },
    ANALYSIS_TOOL,
    async ({ language, patientAge, targetSound }) => {
      try {
        const result = await client.post("/api/word-list-generator", {
          language,
          age: patientAge,
          selectedSound: targetSound,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Speech Therapist Assistant ───────────────────────────────────────────────
  server.tool(
    "vocametrix_chat_speech_therapist",
    "Expert speech therapy assistant providing role-based guidance. " +
    "Adapts its answers depending on whether the user is a therapist (clinical detail), " +
    "a patient (accessible explanation), or a parent/caregiver (practical home tips). " +
    "Maintains conversation context via threadId for multi-turn dialogue.",
    {
      message: z.string().min(1).describe("Your question or message"),
      accountType: z.enum(["slt", "patient", "parent"]).describe("Your role: slt = speech-language therapist, patient, parent (caregiver)"),
      threadId: z.string().describe("Conversation thread ID. Use a UUID; reuse the same ID to continue a conversation"),
    },
    STATEFUL_TOOL,
    async ({ message, accountType, threadId }) => {
      try {
        const result = await client.post("/api/speech-therapist-assistant", {
          input: message,
          accountType,
          threadId,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── French to IPA ────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_convert_french_to_ipa",
    "Convert French words or phrases to International Phonetic Alphabet (IPA) transcription. " +
    "Accepts a single string or an array of up to 20 words. " +
    "Returns IPA transcription per word with optional syllable boundary marks. " +
    "French only — passing non-French text will return incorrect phonetic output.",
    {
      input: z.union([
        z.string().min(1).describe("Single French word or phrase"),
        z.array(z.string()).max(20).describe("Array of up to 20 French words"),
      ]),
      includeSyllableMarks: z.boolean().optional().default(false).describe("If true, adds syllable boundary marks (·) to the IPA output"),
    },
    ANALYSIS_TOOL,
    async ({ input, includeSyllableMarks }) => {
      try {
        const result = await client.post("/api/french-to-ipa-agent", {
          phoneticInput: input,
          includeSyllableMarks,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Spell Agent ──────────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_interpret_spelling_attempt",
    "Interpret a speech-to-text transcription of a spelling attempt and give intelligent feedback. " +
    "Returns whether the spelling matches, an explanation of differences, and correction guidance. " +
    "Useful for spelling therapy apps where children spell words aloud.",
    {
      transcription: z.string().min(1).describe("What the STT system heard (the spoken spelling)"),
      targetWord: z.string().min(1).describe("The correct target word"),
      language: z.string().default("en-US").describe("Language code (e.g. en-US, fr-FR)"),
    },
    ANALYSIS_TOOL,
    async ({ transcription, targetWord, language }) => {
      try {
        const result = await client.post("/api/spell-agent", {
          text: transcription,
          word: targetWord,
          language,
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Syntax Checker ───────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_check_syntax",
    "Analyze text for grammar and syntax errors with severity classification (error/warning/info). " +
    "Returns overall score, per-issue breakdown, corrected text, and readability statistics. " +
    "Useful for evaluating written language samples in speech-language assessments.",
    {
      text: z.string().min(1).max(5000).describe("Text to analyze (max 5000 characters)"),
      locale: z.string().describe("Language code (e.g. en-US, fr-FR)"),
    },
    ANALYSIS_TOOL,
    async ({ text, locale }) => {
      try {
        const result = await client.post("/api/syntax-checker-agent", { text, locale });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Vocabulary Tutor ─────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_vocabulary_tutor",
    "Conversational vocabulary tutor adapting to learner profile (native language, target language, age, topic). " +
    "Uses spaced repetition principles. Maintain conversation context via threadId.",
    {
      message: z.string().min(1).describe("Learner message or answer"),
      nativeLanguage: z.string().describe("Learner's native language (e.g. 'French', 'Arabic')"),
      targetLanguage: z.string().describe("Language being learned (e.g. 'English', 'Spanish')"),
      ageGroup: z.string().describe("Learner age group (e.g. 'child', 'teenager', 'adult')"),
      topic: z.string().describe("Vocabulary topic (e.g. 'animals', 'food', 'body parts')"),
      threadId: z.string().optional().describe("Conversation thread ID for multi-turn sessions"),
    },
    STATEFUL_TOOL,
    async ({ message, nativeLanguage, targetLanguage, ageGroup, topic, threadId }) => {
      try {
        const body: Record<string, unknown> = { message, nativeLanguage, targetLanguage, ageGroup, topic };
        if (threadId) body["threadId"] = threadId;
        const result = await client.post("/api/vocabulary-tutor-agent", body);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Adaptive Exercise ────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_adapt_exercise",
    "Adapt a speech therapy exercise to a specific learner profile (ADHD, dyslexia, dysgraphia, dyspraxia, Tourette, autism). " +
    "Returns an HTML-formatted adapted version of the exercise with profile-specific tips.",
    {
      exerciseText: z.string().min(1).describe("The base exercise to adapt"),
      learnerProfile: z.enum(["adhd", "dyslexia", "dysgraphia", "dyspraxia", "tourette", "autism"])
        .describe("Learning profile to adapt for"),
      includeTips: z.boolean().optional().default(true).describe("Include therapist tips in output"),
    },
    ANALYSIS_TOOL,
    async ({ exerciseText, learnerProfile, includeTips }) => {
      try {
        const result = await client.post("/api/adaptive-exercise-agent", {
          exerciseText,
          profile: learnerProfile,
          includeTips: String(includeTips),
        });
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
