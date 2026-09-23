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
    "In ChatGPT, use vocametrix_upload_attachment instead: it receives the attached file directly. " +
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

/**
 * ChatGPT does not hand attachment bytes to the model, so it cannot base64 them
 * for vocametrix_upload_audio. Declaring the parameter in openai/fileParams makes
 * ChatGPT pass the attachment as a short-lived download URL instead, which is
 * fetched here once and re-stored like any other audio URL.
 */
export function registerUploadAttachmentTool(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_upload_attachment",
    "Upload an audio file the user attached in ChatGPT and obtain a blobUrl. " +
    "Use this whenever the user attaches a recording in the conversation: pass the attachment as `file`. " +
    "Then pass the returned blobUrl as the audioPath parameter to any analysis tool.",
    {
      file: z.object({
        download_url: z.string().describe("Download URL of the attached file, provided by ChatGPT"),
        file_id: z.string().describe("Identifier of the attached file, provided by ChatGPT"),
        mime_type: z.string().optional(),
        file_name: z.string().optional(),
      }).strict().describe("The audio file attached by the user"),
    },
    STATEFUL_TOOL,
    async ({ file }) => {
      try {
        const blobUrl = await client.uploadBlobUrl(file.download_url);
        return ok({ blobUrl });
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA, _meta: { "openai/fileParams": ["file"] } });
}
