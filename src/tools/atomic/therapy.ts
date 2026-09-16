import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, READONLY_TOOL, STATEFUL_TOOL, DESTRUCTIVE_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

export function registerTherapyTools(server: McpServer, client: ApiClient): void {
  // ── Generate Therapy Plan ────────────────────────────────────────────────────
  server.tool(
    "vocametrix_generate_therapy_plan",
    "Launch an asynchronous LangGraph-powered therapy plan generation from session audio embeddings. " +
    "Returns a therapy_session_id. Use vocametrix_get_therapy_status to poll progress, " +
    "then vocametrix_get_therapy_result to retrieve the plan once complete (~30–120 seconds). " +
    "BEFORE CALLING: Confirm that wav2vecOutput comes from vocametrix_classify_stuttering's " +
    "summary_statistics — do not pass invented or placeholder data. " +
    "Passing arbitrary values will produce a clinically meaningless therapy plan.",
    {
      sessionMetadata: z.record(z.unknown()).describe("Session metadata object (must include patient_id)"),
      wav2vecOutput: z.record(z.unknown()).describe("wav2vec embeddings output (must include summary_statistics)"),
      patientAnamnesis: z.string().optional().describe("Demographics, clinical history, and therapy background"),
    },
    STATEFUL_TOOL,
    async ({ sessionMetadata, wav2vecOutput, patientAnamnesis }) => {
      try {
        const body: Record<string, unknown> = {
          session_metadata: sessionMetadata,
          wav2vec_output: wav2vecOutput,
        };
        if (patientAnamnesis) body["patient_anamnesis"] = patientAnamnesis;
        const result = await client.post("/api/therapy-planning-agent", body);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Therapy Status ───────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_get_therapy_status",
    "Poll the status of an async therapy plan generation or stuttering classification session. " +
    "Statuses: pending → processing → pending_approval → complete (or failed). " +
    "result_available = true means you can call vocametrix_get_therapy_result.",
    {
      sessionId: z.string().min(1).describe("Session ID returned by vocametrix_generate_therapy_plan or vocametrix_classify_stuttering"),
    },
    READONLY_TOOL,
    async ({ sessionId }) => {
      try {
        const result = await client.get(`/api/therapy-status/${sessionId}`);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Therapy Result ───────────────────────────────────────────────────────────
  server.tool(
    "vocametrix_get_therapy_result",
    "Retrieve the completed therapy plan result. Only call when vocametrix_get_therapy_status " +
    "returns result_available = true or status = 'complete'. " +
    "Returns the full therapy session with exercise plans, clinical narrative, and HTML report path.",
    {
      sessionId: z.string().min(1).describe("Session ID from vocametrix_generate_therapy_plan"),
    },
    READONLY_TOOL,
    async ({ sessionId }) => {
      try {
        const result = await client.get(`/api/therapy-result/${sessionId}`);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });

  // ── Approve Therapy Plan ─────────────────────────────────────────────────────
  server.tool(
    "vocametrix_approve_therapy_plan",
    "Human-in-the-loop approval gate for generated therapy plans. " +
    "Actions: 'approve' (locks and delivers plan), 'reject' (discards), 'modify' (requires feedback, re-generates). " +
    "This action is irreversible — once approved, the plan is sent for delivery. " +
    "BEFORE CALLING with action='approve': always show the plan content to the user and get explicit confirmation first.",
    {
      sessionId: z.string().min(1).describe("Session ID from vocametrix_generate_therapy_plan"),
      action: z.enum(["approve", "modify", "reject"]).describe("Approval decision"),
      feedback: z.string().optional().describe("Required when action = 'modify': describe the changes needed"),
    },
    DESTRUCTIVE_TOOL,
    async ({ sessionId, action, feedback }) => {
      try {
        const body: Record<string, string> = { action };
        if (feedback) body["feedback"] = feedback;
        if (action === "modify" && !feedback) {
          return {
            content: [{ type: "text" as const, text: "feedback is required when action is 'modify'" }],
            isError: true as const,
          };
        }
        const result = await client.post(`/api/therapy-approve/${sessionId}`, body);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
