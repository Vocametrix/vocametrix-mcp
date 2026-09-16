import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { STATEFUL_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

export function registerFullTherapyWorkflow(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_full_therapy_workflow",
    "End-to-end therapy plan generation with automatic polling and human-in-the-loop approval. " +
    "Generates a therapy plan from session data, polls until complete, and presents it for approval. " +
    "Returns the approved plan or the pending plan awaiting your approval action. " +
    "After reviewing, call vocametrix_approve_therapy_plan with 'approve', 'modify', or 'reject'. " +
    "BEFORE CALLING: Confirm that wav2vecOutput comes from vocametrix_classify_stuttering's " +
    "summary_statistics — do not pass invented or placeholder data.",
    {
      sessionMetadata: z.record(z.unknown()).describe("Session metadata (must include patient_id)"),
      wav2vecOutput: z.record(z.unknown()).describe("wav2vec embeddings (must include summary_statistics)"),
      patientAnamnesis: z.string().optional().describe("Patient demographics and clinical history"),
      pollIntervalMs: z.number().int().min(2000).default(5000).describe("Polling interval in ms"),
      timeoutMs: z.number().int().default(120000).describe("Max wait time in ms"),
    },
    STATEFUL_TOOL,
    async ({ sessionMetadata, wav2vecOutput, patientAnamnesis, pollIntervalMs, timeoutMs }) => {
      try {
        const body: Record<string, unknown> = {
          session_metadata: sessionMetadata,
          wav2vec_output: wav2vecOutput,
        };
        if (patientAnamnesis) body["patient_anamnesis"] = patientAnamnesis;

        const startResult = await client.post("/api/therapy-planning-agent", body) as Record<string, unknown>;
        const sessionId = String(startResult["threadId"] ?? startResult["session_id"] ?? "");

        if (!sessionId) {
          // Dumping the whole response here sent the backend's internals to the
          // model on a path where nothing useful could be done with them anyway.
          return {
            content: [{ type: "text" as const, text: "Therapy planning did not return a session identifier, so there is nothing to poll." }],
            isError: true as const,
          };
        }

        const deadline = Date.now() + timeoutMs;
        let lastStatus: unknown = null;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, pollIntervalMs));
          const status = await client.get(`/api/therapy-status/${sessionId}`) as Record<string, unknown>;
          lastStatus = status;
          const state = String(status["status"] ?? "");
          if (["complete", "pending_approval"].includes(state)) break;
          if (state === "failed") {
            const reason = typeof status["message"] === "string" ? `: ${status["message"]}` : ".";
            return { content: [{ type: "text" as const, text: `Therapy plan generation failed${reason}` }], isError: true as const };
          }
        }

        const result = await client.get(`/api/therapy-result/${sessionId}`);
        return {
          content: [{
            type: "text" as const,
            // The session id is needed for the approval call, so it stays; the
            // polling status was internal bookkeeping and is dropped.
            text: `## Therapy Plan Generated\n\nSession ID: ${sessionId}\nStatus: ${String((lastStatus as Record<string, unknown> | null)?.["status"] ?? "unknown")}\n\n### Plan\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\`\n\nCall vocametrix_approve_therapy_plan with sessionId="${sessionId}" to approve, modify, or reject.`,
          }],
        };
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
