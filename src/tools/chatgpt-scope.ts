import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// OpenAI rejected the ChatGPT plugin on 8 October 2026 because healthcare use
// cases are out of scope for third-party distribution. ChatGPT therefore gets
// an allowlist limited to pronunciation, language learning and voice coaching;
// /mcp and stdio keep every tool. An allowlist, so a new tool stays off
// ChatGPT until someone decides it belongs there.
const CHATGPT_TOOLS = new Set([
  "vocametrix_upload_audio",
  "vocametrix_upload_attachment",
  "vocametrix_ingest_url",
  "vocametrix_assess_pronunciation",
  "vocametrix_assess_pronunciation_with_pitch",
  "vocametrix_transcribe_audio",
  "vocametrix_synthesize_speech",
  "vocametrix_calculate_prosody_similarity",
  "vocametrix_measure_sound_level",
  "vocametrix_detect_phonemes",
  "vocametrix_convert_french_to_ipa",
  "vocametrix_check_syntax",
  "vocametrix_vocabulary_tutor",
]);

// Kept tools whose shared description names a clinical use.
const CHATGPT_DESCRIPTIONS: Record<string, string> = {
  vocametrix_detect_phonemes:
    "Detect French phonemes in an audio recording using a deep-learning classifier. " +
    "Returns phoneme labels with confidence scores and timestamps. French only. " +
    "Useful for French pronunciation practice. " +
    "By default uses the baseline model; pass model='logatome-champion' to use the classifier " +
    "trained on logatomes (short nonsense syllables).",
  vocametrix_check_syntax:
    "Analyze text for grammar and syntax errors with severity classification (error/warning/info). " +
    "Returns overall score, per-issue breakdown, corrected text, and readability statistics. " +
    "Useful for checking written practice in a language being learned.",
};

/** The same server, minus the tools ChatGPT must not list. */
export function chatgptScope(server: McpServer): McpServer {
  const tool = ((name: string, description: string, ...rest: unknown[]) => {
    // Registration chains .update({ outputSchema }), so a skipped tool still answers it.
    if (!CHATGPT_TOOLS.has(name)) return { update: () => {} };
    return (server.tool as (...args: unknown[]) => unknown).call(server, name, CHATGPT_DESCRIPTIONS[name] ?? description, ...rest);
  }) as McpServer["tool"];
  return new Proxy(server, {
    get: (target, prop) => (prop === "tool" ? tool : Reflect.get(target, prop, target)),
  });
}
