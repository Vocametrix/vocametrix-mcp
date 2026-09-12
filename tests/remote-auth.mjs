// Credentials for manually run, real-API probes. Never commit tokens or keys.
export function remoteAuthHeaders() {
  const token = process.env.VOCAMETRIX_MCP_ACCESS_TOKEN;
  if (token) return { Authorization: `Bearer ${token}` };
  const apiKey = process.env.VOCAMETRIX_API_KEY;
  if (apiKey) return { "X-API-Key": apiKey };
  throw new Error("Set VOCAMETRIX_API_KEY (legacy MCP) or VOCAMETRIX_MCP_ACCESS_TOKEN (ChatGPT MCP) before running this probe.");
}
