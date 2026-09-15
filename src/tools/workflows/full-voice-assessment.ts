import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, ANALYSIS_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";
import { age, gender, AVQI_VERSION } from "../../schemas/common.js";

export function registerFullVoiceAssessment(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_full_voice_assessment",
    "Run a comprehensive clinical voice assessment in a single call. " +
    "Executes AVQI, CPP, multi-band HNR, jitter/shimmer, and spectral analysis in parallel, " +
    "then returns a unified JSON report with all metrics and clinical severity interpretation. " +
    "AVQI version is derived automatically from the patient language (en/nl/de → v02.03; fr/es/it → v03.01). " +
    "BEFORE CALLING: (1) Ask for or infer the patient language (en/fr/nl/es/de/it). " +
    "(2) Show the user the correct connected speech reference sentence for that language " +
    "(read vocametrix://recording-guide to get it) and ask them to record it. " +
    "(3) Confirm they also have a sustained /a/ vowel recording of 5+ s. " +
    "Only call once both recordings are confirmed ready.",
    {
      sustainedVowelPath: z.string().describe("Absolute path to sustained vowel WAV (/a/ held 5+ s)"),
      connectedSpeechPath: z.string().describe("Absolute path to connected speech WAV — patient reads the language-specific reference sentence (see vocametrix://recording-guide)"),
      language: z.enum(["en", "fr", "nl", "es", "de", "it"]).describe("Patient language — determines AVQI version and the correct reference sentence"),
      patientAge: age,
      patientGender: gender,
    },
    ANALYSIS_TOOL,
    async ({ sustainedVowelPath, connectedSpeechPath, language, patientAge, patientGender }) => {
      try {
        // Upload both files (shared across multiple endpoints)
        const [svId, csId] = await Promise.all([
          client.uploadFileId(sustainedVowelPath),
          client.uploadFileId(connectedSpeechPath),
        ]);

        const ageStr = String(patientAge);
        const g = patientGender;
        const version = AVQI_VERSION[language] ?? "v03.01";

        // Run all analyses in parallel
        const [avqi, cpp, hnr, jitterShimmer, spectral] = await Promise.all([
          client.get("/api/calculate-avqi", { svFileId: svId, csFileId: csId, version }),
          client.get("/api/calculate-cpp", { svFileId: svId }),
          client.get("/api/calculate-hnr-multiband", { svFileId: svId, age: ageStr, gender: g }),
          client.get("/api/jitter-shimmer", { svFileId: svId }),
          client.get("/api/calculate-spectral-advanced", { svFileId: svId, age: ageStr, gender: g }),
        ]);

        const report = {
          summary: "Full Voice Assessment Report",
          patient: { age: patientAge, gender: patientGender },
          avqi,
          cpp,
          hnr,
          jitterShimmer,
          spectral,
        };

        return ok(report);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
