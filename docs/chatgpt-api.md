# ChatGPT API-credit integration

## Scope and status

Initial version: link an existing Vocametrix API key, then run MCP tools using
that account's API credits. A website subscription or trial never supplies
API entitlement. An account with no remaining credits may connect; the existing
platform API quota checks decide whether an analysis call can run.

The consent form is hosted by `vocametrix-platform`. No landing-page change is
needed. The first version uses a predefined confidential OAuth client, rather
than dynamic client registration.

The production database migration is applied. Production OAuth configuration,
application rollout, real OAuth/audio checks, and ChatGPT review remain pending.
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
Railway browser access is now authenticated and the user upgraded the plan
after the trial expired. The service has no active deployment and needs a new
rollout. Its configured public host is
`independent-happiness-production-75b7.up.railway.app`.

After the user's Azure password confirmation, `scripts/sql-migrate.cjs` was
executed successfully against the production database. Its transaction committed
and verified `McpOAuthCodes`, `McpOAuthFamilies`, and `McpOAuthTokens`.
It reads credentials from stdin and applies the platform SQL file in a transaction.
`scripts/sql-preflight.cjs` is read-only. Neither script contains credentials.

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

## Rollout checks

- [ ] Select the final HTTPS MCP origin and obtain the exact ChatGPT callback.
- [x] Review and apply `sql/mcp_oauth.sql` to the intended database. Check that
  `dbo.accounts.user_id` is an integer primary/unique key, and that the account
  columns referenced by the adapter exist. No migration runs at app startup.
- [ ] Set matching configuration and separate random secrets on both services.
- [ ] Deploy the platform routes and MCP build. Confirm both metadata endpoints
  advertise the same exact resource and issuer.
- [ ] Connect a dedicated review account in ChatGPT and approve API access.
- [ ] Use a real, consented WAV sample to test upload and analysis. Confirm its
  API credits change and the website subscription is not used.
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
