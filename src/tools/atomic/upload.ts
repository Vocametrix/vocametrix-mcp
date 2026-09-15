import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, STATEFUL_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

export function registerUploadTool(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_upload_audio",
    "Upload an audio file to Vocametrix cloud storage and obtain a blobUrl. " +
    "THIS IS THE MANDATORY FIRST STEP whenever the user attaches an audio file in the " +
    "conversation — the remote Vocametrix MCP server cannot read your local filesystem or " +
    "resolve chat-client attachment identifiers. " +
    "Workflow: (1) read the attached audio file's binary content, (2) base64-encode it, " +
    "(3) call this tool with that base64 string, (4) take the returned blobUrl and pass it " +
    "as the audioPath parameter to any analysis tool (assessment, classification, metrics, " +
    "transcription, etc.). " +
    "Never pass attachment IDs, file references, or local paths directly to analysis tools.",
    {
      audioBase64: z.string().describe(
        "Base64-encoded audio file content. Accepts raw base64 OR data URL format " +
        "(data:audio/wav;base64,...). Read the attached file's bytes and encode them yourself " +
        "before calling — do not pass an attachment identifier or filename."
      ),
    },
    STATEFUL_TOOL,
    async ({ audioBase64 }) => {
      try {
        const result = await client.uploadAudioFromBase64(audioBase64);
        return ok(result);
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
