import { readFileSync } from "fs";

/**
 * Whether this deployment may touch the machine's filesystem at all.
 *
 * Only a stdio/local deployment opts in. On the hosted server the filesystem is
 * the server's own, never the user's, so anything reading it is at best useless
 * and at worst a way to enumerate the host — which is why tool registration
 * consults this too, not just path resolution.
 */
export function localFilesystemEnabled(): boolean {
  return process.env["VOCAMETRIX_MCP_LOCAL_FS"] === "1";
}

/**
 * Resolve an audioPath input value to raw audio bytes.
 *
 * Accepted inputs:
 *   1. http(s):// URL          — fetched
 *   2. data: URL               — base64 payload is decoded
 *   3. raw base64 string       — decoded (heuristic: long, base64 charset only)
 *   4. absolute local path     — read from disk, but ONLY when the env var
 *                                VOCAMETRIX_MCP_LOCAL_FS=1 is set (stdio/local
 *                                deployments opt in). On the hosted/remote
 *                                server this is refused with an actionable error.
 *   5. anything else           — refused with an actionable error that tells the
 *                                calling LLM to call vocametrix_upload_audio first.
 *
 * The error messages are intentionally instructive so that an LLM consuming
 * this MCP can self-correct by following the suggested next action.
 */
export async function resolveAudioInputToBuffer(input: string): Promise<Buffer> {
  // (1) HTTP(S) URL
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const resp = await fetch(input);
    if (!resp.ok) {
      throw new Error(`Failed to download audio from URL: HTTP ${String(resp.status)}`);
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  // (2) data: URL
  if (input.startsWith("data:")) {
    const comma = input.indexOf(",");
    if (comma === -1) throw new Error("Invalid data URL");
    return Buffer.from(input.slice(comma + 1), "base64");
  }

  // (3) Raw base64 (no data: prefix).
  //     Heuristic: must be long enough to plausibly be audio (≥ 512 chars ≈ 384 bytes)
  //     and contain only base64 charset characters.
  if (input.length >= 512 && /^[A-Za-z0-9+/=\s]+$/.test(input)) {
    return Buffer.from(input.replace(/\s/g, ""), "base64");
  }

  // (4) Absolute local path — only valid in stdio/local mode (opt-in).
  if (input.startsWith("/") || /^[A-Za-z]:[\\/]/.test(input)) {
    if (localFilesystemEnabled()) {
      return readFileSync(input);
    }
    throw new Error(
      `Local file paths are only readable in stdio/local mode. ` +
      `Received an absolute path, which is not echoed back because it usually ` +
      `carries a user name or a patient file name. ` +
      `On the hosted Vocametrix MCP server, you MUST first call vocametrix_upload_audio ` +
      `with the file content base64-encoded, then pass the returned blobUrl as audioPath.`
    );
  }

  // (5) Anything else — almost certainly an opaque attachment identifier from the
  //     chat client. Refuse with a message that tells the LLM what to do.
  throw new Error(
    `The audioPath value (${String(input.length)} characters, not echoed back since it may ` +
    `identify a person) is not a fetchable URL, a data URL, ` +
    `raw base64, or an absolute path. This is most likely an opaque attachment ` +
    `identifier from the chat client, which the remote Vocametrix MCP server cannot ` +
    `resolve. To process an attached audio file: (1) read the file content, ` +
    `(2) base64-encode it, (3) call vocametrix_upload_audio with the base64 string, ` +
    `(4) pass the returned blobUrl as audioPath to the analysis tool.`
  );
}
