import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync } from "fs";
import { join, extname } from "path";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ANALYSIS_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

interface PronunciationRow {
  file: string;
  accuracyScore: number | null;
  fluencyScore: number | null;
  completenessScore: number | null;
  prosodyScore: number | null;
  error?: string;
}

export function registerBatchPronunciation(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_batch_pronunciation",
    "Assess pronunciation for all WAV files in a folder against a common reference text. " +
    "Returns a table (Markdown + JSON) with accuracy, fluency, completeness, and prosody scores per file. " +
    "Files are processed sequentially to stay within rate limits. " +
    "Useful for classroom assessments, research cohorts, and batch L2 evaluation.",
    {
      folderPath: z.string().describe("Absolute path to a folder containing WAV files"),
      referenceText: z.string().min(1).describe("The text all speakers were reading aloud"),
      locale: z.string().default("en-US").describe("BCP-47 locale code"),
    },
    ANALYSIS_TOOL,
    async ({ folderPath, referenceText, locale }) => {
      try {
        const files = readdirSync(folderPath).filter(f => extname(f).toLowerCase() === ".wav");
        if (files.length === 0) {
          return { content: [{ type: "text" as const, text: "No WAV files found in the specified folder." }] };
        }

        const rows: PronunciationRow[] = [];

        for (const file of files) {
          const filePath = join(folderPath, file);
          try {
            const blobURL = await client.uploadBlobUrl(filePath);
            const result = await client.post("/api/pronunciation-assessment", {
              blobURL,
              referenceText,
              locale,
            }) as Record<string, unknown>;

            rows.push({
              file,
              accuracyScore: (result["accuracyScore"] as number | undefined) ?? null,
              fluencyScore: (result["fluencyScore"] as number | undefined) ?? null,
              completenessScore: (result["completenessScore"] as number | undefined) ?? null,
              prosodyScore: (result["prosodyScore"] as number | undefined) ?? null,
            });
          } catch (err) {
            rows.push({
              file,
              accuracyScore: null,
              fluencyScore: null,
              completenessScore: null,
              prosodyScore: null,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          // Small delay to respect rate limits
          await new Promise(r => setTimeout(r, 200));
        }

        // Markdown table
        const header = "| File | Accuracy | Fluency | Completeness | Prosody |";
        const sep = "|------|----------|---------|--------------|---------|";
        const tableRows = rows.map(r =>
          `| ${r.file} | ${r.error ? `ERROR: ${r.error}` : `${String(r.accuracyScore ?? "-")} | ${String(r.fluencyScore ?? "-")} | ${String(r.completenessScore ?? "-")} | ${String(r.prosodyScore ?? "-")}`} |`,
        );
        const markdown = [header, sep, ...tableRows].join("\n");

        const output = `## Batch Pronunciation Results\n\n${markdown}\n\n### Raw JSON\n\`\`\`json\n${JSON.stringify(rows, null, 2)}\n\`\`\``;
        return { content: [{ type: "text" as const, text: output }] };
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
