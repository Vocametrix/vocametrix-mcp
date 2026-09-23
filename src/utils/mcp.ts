import { z } from "zod";

export const GENERIC_OUTPUT_SCHEMA = { result: z.unknown() };

export function ok(data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result: data },
  };
}

/**
 * Reads and returns; changes nothing and costs nothing. A client may replay it
 * freely, which is exactly why an analysis that spends the account's credits
 * must not claim it. destructiveHint is spelled out because the ChatGPT plugin
 * review asks for every hint explicitly, even where the MCP spec ignores it.
 */
export const READONLY_TOOL = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

/**
 * Runs an analysis: it destroys nothing, but it uploads the recording, spends
 * the connected account's credits, and two identical calls are two charges —
 * so neither readOnlyHint nor idempotentHint would be true.
 */
export const ANALYSIS_TOOL = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

/**
 * Creates or extends server-side state. destructiveHint is spelled out because
 * the MCP default for it is true once readOnlyHint is false, which would
 * announce these additive tools as destructive.
 */
export const STATEFUL_TOOL = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const;

export const DESTRUCTIVE_TOOL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } as const;
