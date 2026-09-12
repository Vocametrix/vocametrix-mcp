export const API_SCOPE = "vocametrix:api";
export const CHATGPT_PATH = "/chatgpt/mcp";

export interface OAuthConfig {
  resource: string;
  issuer: string;
  introspectionSecret: string;
}

export function readOAuthConfig(env: NodeJS.ProcessEnv = process.env): OAuthConfig | undefined {
  const resource = env.MCP_OAUTH_RESOURCE;
  const issuer = env.MCP_OAUTH_ISSUER;
  const introspectionSecret = env.MCP_OAUTH_INTROSPECTION_SECRET;
  if (!resource && !issuer && !introspectionSecret) return undefined;
  if (!resource || !issuer || !introspectionSecret || introspectionSecret.length < 32) {
    throw new Error("Set MCP_OAUTH_RESOURCE, MCP_OAUTH_ISSUER and MCP_OAUTH_INTROSPECTION_SECRET (at least 32 characters) together.");
  }
  const resourceUrl = new URL(resource);
  const issuerUrl = new URL(issuer);
  for (const url of [resourceUrl, issuerUrl]) {
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error("OAuth URLs must use HTTPS without credentials, query strings or fragments.");
    }
  }
  if (resourceUrl.pathname !== CHATGPT_PATH || resourceUrl.href !== resource) {
    throw new Error(`MCP_OAUTH_RESOURCE must be a canonical HTTPS URL ending in ${CHATGPT_PATH}.`);
  }
  if (issuerUrl.origin !== issuer) {
    throw new Error("MCP_OAUTH_ISSUER must be an HTTPS origin without a trailing slash.");
  }
  return { resource, issuer, introspectionSecret };
}

export function protectedResourceMetadata(config: OAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [API_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Vocametrix API",
  };
}

export function authenticationChallenge(config: OAuthConfig): string {
  const origin = new URL(config.resource).origin;
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource${CHATGPT_PATH}", scope="${API_SCOPE}"`;
}

export class OAuthError extends Error {
  constructor(public readonly status: 401 | 503) {
    super(status === 401 ? "Connect your Vocametrix API account to continue." : "Account authorization is temporarily unavailable.");
  }
}

/** Resolve only this request's account; never fall back to a server-owned API key. */
export async function resolveOAuthApiKey(
  authorization: string | undefined,
  config: OAuthConfig,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]{1,4096})$/i);
  if (!match) throw new OAuthError(401);

  let response: Response;
  try {
    response = await fetcher(`${config.issuer}/oauth/mcp/introspect`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.introspectionSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token: match[1], resource: config.resource }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OAuthError(503);
  }
  if (!response.ok) throw new OAuthError(503);

  let data: Record<string, unknown>;
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {
    throw new OAuthError(503);
  }
  if (!data || data.active !== true || data.issuer !== config.issuer || data.audience !== config.resource ||
      typeof data.scope !== "string" || !data.scope.split(" ").includes(API_SCOPE) ||
      typeof data.expiresAt !== "number" || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now() / 1000 ||
      typeof data.subject !== "string" || !data.subject || typeof data.apiKey !== "string" || !data.apiKey) {
    throw new OAuthError(401);
  }
  return data.apiKey;
}
