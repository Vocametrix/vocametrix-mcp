import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiClient } from "../../client.js";
import { translateError } from "../../errors.js";
import { ok, STATEFUL_TOOL, GENERIC_OUTPUT_SCHEMA } from "../../utils/mcp.js";

export function registerIngestUrlTool(server: McpServer, client: ApiClient): void {
  server.tool(
    "vocametrix_ingest_url",
    "Ingest a publicly fetchable audio URL into Vocametrix cloud storage and return a stable blobUrl. " +
    "Use this whenever the user provides a direct HTTPS URL pointing to a WAV file — Google Drive " +
    "direct-download links, S3 public objects, Dropbox links with ?dl=1, signed/presigned URLs, etc. " +
    "The URL is fetched once and re-stored on Vocametrix; the returned blobUrl is what you pass as " +
    "audioPath to any analysis tool. " +
    "This is the right tool when the user's input is a URL. " +
    "For files attached directly in the conversation (binary content, no URL), use " +
    "vocametrix_upload_audio with base64 instead.",
    {
      audioUrl: z.string().url().describe(
        "Public HTTPS URL pointing to a WAV file. Must be directly fetchable — no auth headers, " +
        "no login redirects, no HTML preview pages. For Google Drive use the direct-download form: " +
        "'https://drive.google.com/uc?export=download&id=FILE_ID'. For Dropbox append '?dl=1'."
      ),
    },
    STATEFUL_TOOL,
    async ({ audioUrl }) => {
      try {
        const blobUrl = await client.uploadBlobUrl(audioUrl);
        return ok({ blobUrl });
      } catch (e) { return translateError(e); }
    },
  ).update({ outputSchema: GENERIC_OUTPUT_SCHEMA });
}
