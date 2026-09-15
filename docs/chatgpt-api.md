# ChatGPT API-credit integration

## Scope and status

Initial version: link an existing Vocametrix API key, then run MCP tools using
that account's API credits. A website subscription or trial never supplies
API entitlement. An account with no remaining credits may connect; the existing
platform API quota checks decide whether an analysis call can run.

The consent form is hosted by `vocametrix-platform`. No landing-page change is
needed. The first version uses a predefined confidential OAuth client, rather
than dynamic client registration.

The production database migration is applied and the MCP application is deployed.
Production OAuth configuration, platform application rollout, real OAuth/audio
checks, and ChatGPT review remain pending.
Test accounts and service responses are explicitly
synthetic fixtures, not measured production results.

### Deployment preflight, 12 September 2026

The production database was checked read-only: expected account columns are
present (`user_id` is `int`). The three OAuth tables were absent at preflight
and were subsequently created as recorded below.
The user-authorized test key belongs to an active, verified, nonexpired account
with API credits. A real `/api/spell-agent` request using synthetic test text
returned HTTP 200. This validates the existing API, not the new OAuth flow.
All 35 offline tests passed again.

The platform's last deployment is healthy, and its deployed Git revision matches
the local base. Its OAuth environment variables are not configured. The MCP
GitHub deployment points to Railway project `1a04bd7e-4064-4e75-b309-92074f2758bb`,
production environment `c801129b-0a05-4e21-9b1c-784a19732ea0`.
Railway browser access is authenticated and the user upgraded the plan after
the trial expired. After the user installed the Railway GitHub App for the
transferred repository, the source was changed to `Vocametrix/vocametrix-mcp`
on `master`. Deployment `14b05420-c2f6-4903-ab15-0777c669b644` is active,
using MCP revision `a04ea58`. Its configured public host is
`independent-happiness-production-75b7.up.railway.app`.
Live checks returned HTTP 200 for `/health` and anonymous `/mcp` `tools/list`
(40 tools). `/chatgpt/mcp` still returns 404 because OAuth is not configured.
These checks did not consume API credits. Platform revision `72a37ac3` is
committed locally but not pushed or deployed. The available ChatGPT browser
session is signed out; its management callback has not been obtained.

After the user's Azure password confirmation, `scripts/sql-migrate.cjs` was
executed successfully against the production database. Its transaction committed
and verified `McpOAuthCodes`, `McpOAuthFamilies`, and `McpOAuthTokens`.
It reads credentials from stdin and applies the platform SQL file in a transaction.
`scripts/sql-preflight.cjs` is read-only. Neither script contains credentials.
Both read JSON from stdin, and Windows PowerShell 5.1 prefixes a UTF-8 BOM when
piping to a native executable, which makes `JSON.parse` fail. The failure is
reported as the script's generic error, not as a parse error, so it looks like a
connection problem. Redirect from a BOM-free file through `cmd` instead:
`cmd /c "node scripts/sql-preflight.cjs < payload.json"`.

## Request flow

1. ChatGPT discovers the protected resource at
   `/.well-known/oauth-protected-resource/chatgpt/mcp` on the MCP host.
2. The platform presents a consent form. The user enters their API key and
   explicitly approves API-credit usage.
3. The platform issues a short-lived, single-use authorization code bound to
   the client, exact callback, MCP resource and S256 PKCE challenge.
4. ChatGPT exchanges the code and verifier for access and refresh tokens.
5. On each `/chatgpt/mcp` request the MCP server validates the access token with
   the platform's confidential introspection endpoint. Only the MCP server
   receives the linked account's API key.
6. Calls to the analysis API carry that key in `X-API-Key`. They never forward
   `X-Web-Session` or substitute a server owner's credentials.

Access tokens expire after 15 minutes. Refresh tokens expire after 30 days and
rotate on use; replay revokes the token family. Revocation, API-key rotation,
account deactivation, deletion requests and loss of eligibility invalidate the
connection. The OAuth store keeps credential hashes, not plaintext API keys or
plaintext access/refresh tokens.

## Files to deploy together

In `vocametrix-platform`:

- `routes/oauth/core.js`: authorization and token rules.
- `routes/oauth/store.js`: parameterized SQL storage and atomic refresh rotation.
- `routes/oauth/oauth.router.js`: metadata, consent, token, revoke and confidential introspection endpoints.
- `routes/index.js`: OAuth router mount.
- `sql/mcp_oauth.sql`: additive tables; apply manually before enabling OAuth.

In `vocametrix-mcp`:

- `src/oauth.ts`: metadata and per-request token validation.
- `src/server.ts`: protected `/chatgpt/mcp` endpoint.

The legacy `/mcp` endpoint remains available for API-key clients. Anonymous
legacy discovery cannot inherit `VOCAMETRIX_API_KEY` from the server environment.

## Configuration

The following are operator-provided configuration values, not sample credentials.
Set secrets through the hosting environment's secret configuration; never commit
them or put them in a URL.

| Variable | Platform | MCP server | Value |
| --- | --- | --- | --- |
| `MCP_OAUTH_ISSUER` | Required | Required | `https://platform.vocametrix.com`, without a trailing slash |
| `MCP_OAUTH_RESOURCE` | Required | Required | Your chosen public MCP HTTPS origin followed by `/chatgpt/mcp`; identical on both services |
| `MCP_OAUTH_INTROSPECTION_SECRET` | Required | Required | The same independently generated random secret on both services; at least 32 characters |
| `MCP_OAUTH_CLIENT_ID` | Required | No | The predefined client ID entered in ChatGPT's OAuth configuration |
| `MCP_OAUTH_CLIENT_SECRET` | Required | No | A separate random secret, at least 32 characters; entered in ChatGPT's OAuth configuration |
| `MCP_OAUTH_REDIRECT_URI` | Required | No | The exact HTTPS callback shown by ChatGPT for this connection |
| `PORT` | Existing configuration | Required for HTTP mode | Hosting environment's assigned port |

Both services leave OAuth disabled when their OAuth variables are absent and
fail startup on partial or invalid configuration. Do not set a shared
`VOCAMETRIX_API_KEY` to provide public ChatGPT access.

The authorization server advertises `client_secret_post`, S256 PKCE and the
`vocametrix:api` scope. Configure those in ChatGPT. Copy the callback from its
management screen; do not guess it. The platform sends the exact issuer in
authorization callbacks.

This initial flow does not implement OpenID Connect or UserInfo. Enterprise
workspace restrictions based on a linked account's verified email domain are
not supported by this version.

Either implement it or state plainly in the submission that it is unsupported —
but decide, rather than leave the claim unmade. The gap is narrower than it
looks, measured against the current platform code rather than estimated: the
grant already requires `a.email_verified` (`routes/oauth/core.js`), so the
verified-email condition holds today; what is missing is the address itself,
which `routes/oauth/store.js` does not select, a `/oauth/userinfo` endpoint
returning `sub`, `email` and `email_verified` for a bearer token, `openid` and
`email` alongside `vocametrix:api` in `scopes_supported`, and an
`/.well-known/openid-configuration` advertising that endpoint. All of it lives in
`vocametrix-platform`; the MCP server needs no change, since ChatGPT would call
UserInfo directly. Releasing an email address to the client is a privacy decision
in its own right and belongs in the consent wording, not only in the metadata.

## Rollout checks

### Production verification — 2026-09-12

Platform deployment `34690775906` succeeded (commit `8c6676bd`). Live checks
passed for both metadata endpoints, the purple consent page with `strict-origin`,
real account approval, PKCE code exchange, authenticated discovery of 40 MCP tools,
and refresh rotation against the production SQL store. A real
`vocametrix_convert_french_to_ipa` call for `bonjour` returned success and
`/b ɔ̃ ʒ u ʁ/`. Each probe's own grant was revoked afterward.

These initial checks used a direct HTTP client. Later the user completed OAuth
linking in ChatGPT: settings confirmed the connection, and clicking Refresh loaded
the tool definitions. A real French-to-IPA invocation from ChatGPT then succeeded
for `bonjour`, returning `/b ɔ̃ ʒ u ʁ/`, with Vocametrix shown as a source and a
completed tool activity in the UI. Test conversation:
https://chatgpt.com/c/6aa541fc-6180-83eb-a439-d1664551182a
Audio upload/analysis and public directory availability remain unverified. The
plugin is still in development mode and its listing logo still needs configuration.
Reproduction: `scripts/verify-live-oauth.mjs` with the documented OAuth config and
API key supplied through environment variables; `--call` invokes the real API and
may consume credits. The script logs no authentication secrets.

- [ ] Select the final HTTPS MCP origin and obtain the exact ChatGPT callback.
- [x] Review and apply `sql/mcp_oauth.sql` to the intended database. Check that
  `dbo.accounts.user_id` is an integer primary/unique key, and that the account
  columns referenced by the adapter exist. No migration runs at app startup.
- [ ] Set matching configuration and separate random secrets on both services.
- [ ] Deploy the platform routes and MCP build. Confirm both metadata endpoints
  advertise the same exact resource and issuer.
- [x] Connect the authorized test account in ChatGPT and approve API access.
- [x] Prepare a separate metered review account — `review@vocametrix.com`,
  created 15 September 2026, see the review account section below.
- [x] Use a real, consented WAV sample to test upload and analysis — done on
  15 September 2026, see the audio verification section below.
- [x] Confirm on a metered account that an analysis increases `used_seconds`.
- [x] Document the negative cases: rejected API key, call after revocation,
  exhausted credits.
- [x] Fix the error text returned on an exhausted quota, which reached the model
  as `Unexpected error` carrying the raw backend JSON. Fixed in the working tree
  on 15 September 2026; not deployed, so the live server still sends the old text.
### Audio verification — 2026-09-15

A real 25.0 s WAV recording (PCM 16-bit mono 16 kHz, 800 044 bytes, supplied by
its owner) was sent through the authenticated `/chatgpt/mcp` endpoint using an
OAuth grant obtained for the probe and revoked afterwards.
`vocametrix_upload_audio` accepted the base64 payload and returned a
`vocametrixstorageaccount.blob.core.windows.net` blobUrl; passing that blobUrl to
`vocametrix_extract_egemaps` returned a successful chunked analysis, four chunks
covering the whole 25 s, each with its eGeMAPS feature set. This is the first
end-to-end proof that audio reaches the analysis API over the ChatGPT OAuth path.
Reproduction: `scripts/verify-live-audio.mjs <file> --tool egemaps`, with the
OAuth configuration and API key supplied through environment variables. It calls
the real API and may consume the linked account's audio quota.

Metering could not be observed on the first account used, and the reason was
structural rather than a defect. Read-only checks of `dbo.accounts` before and
after a billed call showed `used_seconds` unchanged at 811 290 and `credits`
unchanged at 7 804. The route does meter — `gemapsExtract` calls
`recordAudioUsage` in `routes/audio/audio.controller.js` — but that account
carries `web_sub_status = comped`, so `hasWebAccess` is true and
`checkApiAudioLimits` sets `webUnlimited`, which bills zero seconds by design
(`helpers/apiUtils.js`). Any account holding an active website entitlement
behaves this way on the programmatic API too; this is the deliberate trade-off
recorded in that file. A separate metered account was created for this reason,
and the measurement below was taken on it.

### Review account — 2026-09-15

`review@vocametrix.com` (`user_id` 608) was written directly to `dbo.accounts` by
`scripts/create-review-account.cjs`, in one transaction, after an Azure password
confirmation. The normal signup path cannot produce this account: its reCAPTCHA
is not scriptable, and email verification grants a seven-day web trial
(`TRIAL_DAYS = 7`, `routes/login/login.service.js`), which would make it
unmetered for a week. `grantWebAccess.js --revoke` cannot fix that either — its
`UPDATE` only matches `web_sub_status = 'comped'`.

The account is `status = active`, `email_verified = 1`, plan `Platform Pack`
(id 15), `credits = 100`, `max_seconds = 0`, `web_sub_status = 'expired'` with no
trial and no Stripe subscription, so `hasWebAccess` is false and every analysis
is billed. The script refuses to overwrite an existing address, and re-reads the
written row inside its transaction, rolling back if the account would not be
metered. Its mailbox does not exist: verification was set directly rather than
by email, so password reset and any automated mail to that address will bounce.

A second review account, `review-nocredits@vocametrix.com` (`user_id` 609), was
created the same way with `credits = 0`. It exists so that reviewers can observe
the out-of-credit refusal themselves, without anyone writing to the database:
`checkApiAudioLimits` blocks on `combinedBalance <= 0`, and a zero balance
satisfies that. Verified on 15 September 2026 — the account connects over OAuth
and discovers the tools normally, since consent checks `status`, `email_verified`
and `expires_at` but not the balance, and every analysis is then refused with
HTTP 429 at upload. Submit it as the fixture for the out-of-credit test case.

With the first account, two consecutive 25.0 s analyses moved `used_seconds` from 0 to
25 and then to 50 — the exact recording duration each time — while `credits`
stayed at 100, since `used_seconds` and `credits` are two terms of one balance
(`credits + (max_seconds - used_seconds) / 60`, `helpers/apiUtils.js`). The
website subscription is not involved: this account has none.

`vocametrix_extract_egemaps` answered in 13.2 s on the second run. On the first,
the same call exceeded a 300 s client timeout and was still billed 25 s, because
metering happens when the worker finishes, not when the client reads the reply.
A client that gives up early therefore pays for the analysis anyway.

### Negative cases — 2026-09-15

`scripts/verify-live-negative.mjs`, run against the review account:

- a nonexistent API key at consent yields no authorization code;
- a freshly granted access token is accepted on `/chatgpt/mcp` (HTTP 200);
- revocation is accepted (HTTP 200);
- the same access token is refused afterwards (HTTP 401);
- the revoked refresh token is refused (HTTP 400).

The out-of-credit case was measured separately by `scripts/verify-live-quota.mjs`,
which drives the review account's balance below zero, makes the call, and
restores the original credits in a `finally` block, printing the restored value
so a failed run cannot be mistaken for a clean one. With `credits` set to 0 and
`used_seconds` at 50 the balance was −0.83, and the call was refused with
HTTP 429 `Quota exceeded`. Two findings worth keeping:

- the refusal happens at **upload**, not at analysis: `/api/get-blob-url` is
  behind `checkApiAudioLimits` too, so an exhausted account never reaches the
  analysis stage;
- `used_seconds` stayed at 50 across the blocked attempt, so a refused call
  costs nothing.

The message ChatGPT received was `Unexpected error: HTTP 429: {"error":"Quota
exceeded","details":...,"upgrade_url":...}` — wrong on two counts: an exhausted
quota is an expected condition, not an unexpected error, and the raw backend JSON
reached the model verbatim. The cause was in `src/client.ts`, whose `apiFetch`
threw a plain `Error("HTTP <status>: <body>")`, while `translateError` in
`src/errors.ts` recognised only the SDK's typed errors — so every direct
`client.get`/`client.post` failure landed in its `Unexpected error` branch, not
just this one. This is the same concern as the submission item about not
returning debugging information unnecessarily.

Fixed at the source rather than by parsing that message: `apiFetch` now throws
`ApiHttpError(statusCode, body)`, and `translateError` names the condition per
status — 429 says no credits remain and that nothing was charged, 401/402/403/404
each get their own wording, 5xx says to retry. The body is logged server-side and
never returned; a `details` or `error` string of at most 300 characters may be
quoted, so a validation message still reaches the caller while an HTML error page
or a long payload does not. `tests/errors.test.mjs` pins both halves. The live
server still returns the old text until this is deployed.

- [ ] Verify refresh and revocation against the real SQL store, including
  concurrent refresh attempts. Offline store fixtures do not prove database
  locking or migration compatibility.
- [ ] Revoke the API keys previously embedded in manual probe files. Removing
  those strings from current files does not revoke keys or erase Git history.

Manual probe scripts now read `VOCAMETRIX_API_KEY` for `/mcp` or
`VOCAMETRIX_MCP_ACCESS_TOKEN` for `/chatgpt/mcp`. These probes call real APIs and
may spend credits; they are not part of `npm test`. Do not share their full
audio/result output publicly.

## Verification

MCP tests:

```powershell
Set-Location D:\Github\vocametrix-mcp
npm test
```

Platform tests:

```powershell
Set-Location D:\Github\vocametrix-platform
node --test tests/oauth.test.js tests/oauth.router.test.js tests/oauth.store.test.js
```

The offline tests cover token binding, isolation of two synthetic accounts,
unauthenticated requests, invalid and expired tokens, unavailable introspection,
consent/CSRF, code redemption, refresh/revocation, and absence of website-session
headers on downstream requests. The SQL-adapter test checks parameter binding
against recorded query fixtures; it does not execute a real database migration.

Current platform limits are 600 introspection requests per minute and 60 token
requests per minute, per source IP. Multiple accounts may share the MCP host's
or ChatGPT's outbound IP, so these are aggregate limits. Reaching the
introspection limit makes authorization temporarily unavailable for that IP.
Automatic approval review rejected a proposed adjustment; the limits remain
in place. Reassess this capacity before a broader rollout.

## Public submission remains separate

Prepare the verified publisher identity, real logo, descriptions, support and
policy links, review credentials and production domain verification. Review all
tool annotations and returned data before scanning tools. The existing clinical
and therapy capabilities need review against the current plugin guidelines;
this account-linking work does not establish eligibility or approval.

Use these five positive cases with real review fixtures: connect an eligible
account; upload a consented WAV; assess pronunciation; run a voice measurement;
refresh the connection and repeat a permitted call. Negative cases: invalid
credentials; exhausted API credits; access after revocation. Record actual
expected/observed behavior without fabricating scores.

Sources: [OpenAI authentication](https://developers.openai.com/plugins/build/auth),
[submission flow](https://developers.openai.com/plugins/deploy/submission),
[remote MCP review](https://developers.openai.com/plugins/deploy/app-review).
