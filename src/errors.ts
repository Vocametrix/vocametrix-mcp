import {
  VocametrixAuthError,
  VocametrixForbiddenError,
  VocametrixNotFoundError,
  VocametrixRateLimitError,
  VocametrixValidationError,
  VocametrixServerError,
  VocametrixError,
} from "vocametrix";

export interface McpToolError {
  [key: string]: unknown;
  content: [{ type: "text"; text: string }];
  isError: true;
}

/**
 * A non-OK response from a Vocametrix endpoint called directly rather than
 * through the SDK. Carries the status so translateError can say what happened;
 * the body is kept for the server log only, never for the model.
 */
export class ApiHttpError extends Error {
  constructor(readonly statusCode: number, readonly body: string) {
    super(`HTTP ${String(statusCode)}`);
    this.name = "ApiHttpError";
  }

  /** The backend's own explanation, when it sent JSON and nothing else. */
  get detail(): string | undefined {
    try {
      const parsed: unknown = JSON.parse(this.body);
      if (parsed === null || typeof parsed !== "object") return undefined;
      const { details, error } = parsed as { details?: unknown; error?: unknown };
      const text = typeof details === "string" ? details : typeof error === "string" ? error : undefined;
      return text && text.length <= 300 ? text : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * An exhausted account and an invalid key are expected conditions, not
 * unexpected errors, and the raw backend payload must not reach the model.
 */
function describeHttpError(err: ApiHttpError): string {
  const detail = err.detail;
  switch (err.statusCode) {
    case 400:
      return `Invalid parameters${detail ? `: ${detail}` : "."}`;
    case 401:
      return "Authentication failed: your API key is invalid or missing.\n" +
        "Get a key at https://www.vocametrix.com/registration";
    case 402:
      return "This account's website subscription has ended.\n" +
        "See https://www.vocametrix.com/pricing";
    case 403:
      return `Access forbidden${detail ? `: ${detail}` : ": your account does not have permission for this operation."}\n` +
        "Check your plan at https://www.vocametrix.com/pricing";
    case 404:
      return `Resource not found${detail ? `: ${detail}` : "."}`;
    case 429:
      return "No Vocametrix API credits remaining on the connected account, so this " +
        "analysis was not run and nothing was charged.\n" +
        "Add credits at https://www.vocametrix.com/pricing";
    default:
      return err.statusCode >= 500
        ? `Vocametrix server error (${String(err.statusCode)}). Try again shortly.`
        : `Request refused (HTTP ${String(err.statusCode)})${detail ? `: ${detail}` : "."}`;
  }
}

export function translateError(err: unknown): McpToolError {
  let message: string;

  if (err instanceof ApiHttpError) {
    message = describeHttpError(err);
    // The body stays here, where an operator can read it, and goes no further.
    console.error("[vocametrix-mcp]", `HTTP ${String(err.statusCode)}`, err.body.slice(0, 500));
    return { content: [{ type: "text", text: message }], isError: true };
  } else if (err instanceof VocametrixAuthError) {
    message =
      "Authentication failed: your API key is invalid or missing.\n" +
      "Get a key at https://www.vocametrix.com/registration";
  } else if (err instanceof VocametrixForbiddenError) {
    message =
      "Access forbidden: your account does not have permission for this operation.\n" +
      "Check your plan at https://www.vocametrix.com/pricing";
  } else if (err instanceof VocametrixRateLimitError) {
    const wait = err.retryAfter ? ` Retry in ${String(err.retryAfter)} seconds.` : "";
    message = `Rate limit reached.${wait} The SDK retries automatically up to 3 times.`;
  } else if (err instanceof VocametrixValidationError) {
    message = `Invalid parameters: ${err.message}`;
  } else if (err instanceof VocametrixNotFoundError) {
    message = `Resource not found: ${err.message}`;
  } else if (err instanceof VocametrixServerError) {
    message = `Vocametrix server error (${String(err.statusCode ?? 500)}): ${err.message}`;
  } else if (err instanceof VocametrixError) {
    message = `Vocametrix error: ${err.message}`;
  } else if (err instanceof Error) {
    message = `Unexpected error: ${err.message}`;
  } else {
    message = `Unexpected error: ${String(err)}`;
  }

  console.error("[vocametrix-mcp]", message);
  return { content: [{ type: "text", text: message }], isError: true };
}
