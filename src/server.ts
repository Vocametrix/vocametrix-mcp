#!/usr/bin/env node
import { createRequire } from "module";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createClient } from "./client.js";
import { registerAllTools } from "./tools/index.js";
import { registerResources } from "./resources.js";
import { registerPrompts } from "./prompts.js";
import { runSetup } from "./setup.js";
import { CHATGPT_PATH, OAuthError, authenticationChallenge, protectedResourceMetadata, readOAuthConfig, resolveOAuthApiKey } from "./oauth.js";

const cliArgs = process.argv.slice(2);
if (cliArgs.includes("--setup")) {
  const keyArg = cliArgs.find(a => a.startsWith("--key="));
  const key = keyArg ? keyArg.slice("--key=".length) : process.env["VOCAMETRIX_API_KEY"];
  if (!key) {
    console.error("Usage: npx @vocametrix/mcp-server --setup --key=YOUR_API_KEY");
    process.exit(1);
  }
  runSetup(key);
  process.exit(0);
}

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

function buildServer(client: ReturnType<typeof createClient>) {
  const server = new McpServer({ name: "vocametrix", version });
  registerAllTools(server, client);
  registerResources(server);
  registerPrompts(server);
  return server;
}

function createDummyClient(): ReturnType<typeof createClient> {
  const missing = (): never => {
    throw new Error("Vocametrix API key required. Provide your key via the x-api-key header. Get one at https://www.vocametrix.com/registration");
  };
  return { sdk: null as never, apiKey: "", uploadFileId: missing, uploadBlobUrl: missing, uploadAudioFromBase64: missing, get: missing, post: missing };
}

function extractKeyFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const q = url.indexOf("?");
  if (q === -1) return undefined;
  return new URLSearchParams(url.slice(q + 1)).get("key") ?? undefined;
}

async function handleMcpRequest(req: IncomingMessage, res: ServerResponse, oauthApiKey?: string) {
  const apiKey = oauthApiKey ?? (req.headers["x-api-key"] as string | undefined) ?? extractKeyFromUrl(req.url);
  let client: ReturnType<typeof createClient>;
  try {
    // Anonymous HTTP discovery must never inherit the stdio owner's credentials.
    client = apiKey ? createClient(apiKey) : createDummyClient();
  } catch {
    client = createDummyClient();
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const mcpServer = buildServer(client);
  await mcpServer.connect(transport);
  res.on("close", () => { void mcpServer.close(); });

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve) => {
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", resolve);
  });

  let body: unknown;
  if (chunks.length > 0) {
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* non-JSON body */ }
  }

  await transport.handleRequest(req, res, body);
}

const port = process.env.PORT ? parseInt(process.env.PORT) : null;

if (port) {
  const oauth = readOAuthConfig();
  const httpServer = createServer((req, res) => {
    const url = req.url ?? "";
    const path = url.split("?")[0];
    if (oauth && (path === "/.well-known/oauth-protected-resource" || path === `/.well-known/oauth-protected-resource${CHATGPT_PATH}`)) {
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET" });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(protectedResourceMetadata(oauth)));
      return;
    }
    if (path === CHATGPT_PATH && oauth) {
      res.setHeader("Cache-Control", "no-store");
      // Credentials for this endpoint come exclusively from OAuth introspection.
      resolveOAuthApiKey(req.headers.authorization, oauth).then(async (apiKey) => {
        if (req.method !== "POST") {
          res.writeHead(405, { Allow: "POST" });
          res.end();
          return;
        }
        await handleMcpRequest(req, res, apiKey);
      }).catch((err: unknown) => {
        if (res.headersSent) { res.end(); return; }
        const status = err instanceof OAuthError ? err.status : 500;
        res.writeHead(status, {
          "Content-Type": "application/json",
          ...(status === 401 ? { "WWW-Authenticate": authenticationChallenge(oauth) } : {}),
        });
        res.end(JSON.stringify({ error: err instanceof OAuthError ? err.message : "Internal server error" }));
      });
      return;
    }
    if (path === "/mcp") {
      // Stateless mode: we create a fresh McpServer per HTTP request, so the
      // standalone GET SSE notification stream the SDK would open has no producer.
      // Per the MCP spec, returning 405 here tells clients that no server-initiated
      // notification channel is offered — they should rely on POST request/response
      // only. Without this, clients (e.g. Claude Desktop) hold the GET stream open
      // and may wait for notifications that will never arrive.
      if (req.method === "GET") {
        res.writeHead(405, { "Allow": "POST", "Content-Type": "text/plain" });
        res.end("Method Not Allowed: this server does not offer a notification SSE stream.");
        return;
      }
      handleMcpRequest(req, res).catch((err) => {
        console.error("[vocametrix-mcp] Request error:", err);
        if (!res.headersSent) { res.writeHead(500); res.end("Internal server error"); }
      });
    } else if (url === "/" || url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: "vocametrix-mcp", version, status: "ok" }));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  httpServer.listen(port, () => {
    console.error(`[vocametrix-mcp] HTTP server listening on port ${port}`);
  });
} else {
  let client: ReturnType<typeof createClient>;
  try {
    client = createClient();
  } catch (err) {
    console.error("[vocametrix-mcp] Startup error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const server = buildServer(client!);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
