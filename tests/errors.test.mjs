import test from "node:test";
import assert from "node:assert/strict";
import { ApiHttpError, translateError } from "../dist/errors.js";

// Endpoints called directly rather than through the SDK used to reach the model
// as "Unexpected error: HTTP 429: {raw backend JSON}". These tests pin both
// halves of the fix: the condition is named, and the payload stays server-side.

const QUOTA_BODY = JSON.stringify({
  error: "Quota exceeded",
  details: "You have no Voca Credits remaining. Purchase more to continue.",
  upgrade_url: "https://www.vocametrix.com/pricing",
});

function textOf(err) {
  const result = translateError(err);
  assert.equal(result.isError, true);
  return result.content[0].text;
}

test("an exhausted quota is not reported as an unexpected error", () => {
  const text = textOf(new ApiHttpError(429, QUOTA_BODY));
  assert.match(text, /No Vocametrix API credits remaining/);
  assert.doesNotMatch(text, /Unexpected error/);
  assert.match(text, /nothing was charged/);
});

test("the raw backend body never reaches the model", () => {
  const text = textOf(new ApiHttpError(429, QUOTA_BODY));
  assert.doesNotMatch(text, /upgrade_url/);
  assert.doesNotMatch(text, /[{}]/);
});

test("an HTML error page is not echoed back", () => {
  const text = textOf(new ApiHttpError(502, "<html><body>Bad Gateway</body></html>"));
  assert.doesNotMatch(text, /html/i);
  assert.match(text, /server error \(502\)/);
});

test("a validation message is passed through, an oversized one is not", () => {
  assert.match(
    textOf(new ApiHttpError(400, JSON.stringify({ error: "fileId is required" }))),
    /Invalid parameters: fileId is required/,
  );
  const long = textOf(new ApiHttpError(400, JSON.stringify({ details: "x".repeat(301) })));
  assert.equal(long, "Invalid parameters.");
});

test("each documented status is named rather than numbered", () => {
  assert.match(textOf(new ApiHttpError(401, "")), /API key is invalid or missing/);
  assert.match(textOf(new ApiHttpError(402, "")), /subscription has ended/);
  assert.match(textOf(new ApiHttpError(403, "")), /Access forbidden/);
  assert.match(textOf(new ApiHttpError(404, "")), /Resource not found/);
});

test("a plain Error is still reported as unexpected", () => {
  assert.match(textOf(new Error("socket hang up")), /Unexpected error: socket hang up/);
});
