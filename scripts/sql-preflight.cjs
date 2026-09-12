// Read-only deployment check. Receive credentials via stdin, never from a file.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const platformRequire = createRequire(resolve(__dirname, '../../vocametrix-platform/package.json'));
const sql = platformRequire('mssql');

(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { server, database, user, password, apiKey } = JSON.parse(input);
  const pool = await new sql.ConnectionPool({
    server, database, user, password, options: { encrypt: true },
    connectionTimeout: 15000, requestTimeout: 15000,
  }).connect();
  try {
    const schema = await pool.request().query(`
      SELECT COLUMN_NAME AS name, DATA_TYPE AS type
      FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='accounts'
        AND COLUMN_NAME IN ('user_id','key_value','status','email_verified','expires_at','deletion_requested','plan_id');
      SELECT name FROM sys.tables WHERE name IN ('McpOAuthCodes','McpOAuthFamilies','McpOAuthTokens');
    `);
    const account = await pool.request().input('key', sql.VarChar, apiKey).query(`
      SELECT a.status, a.email_verified, a.deletion_requested,
        CASE WHEN a.expires_at IS NULL OR a.expires_at>SYSUTCDATETIME() THEN 1 ELSE 0 END AS keyNotExpired,
        CASE WHEN p.id IS NOT NULL THEN 1 ELSE 0 END AS planExists,
        a.credits, a.max_seconds, a.used_seconds
      FROM dbo.accounts a LEFT JOIN dbo.ApiPlans p ON p.id=a.plan_id WHERE a.key_value=@key;
    `);
    console.log(JSON.stringify({ columns: schema.recordsets[0], oauthTables: schema.recordsets[1],
      testAccount: account.recordset[0] ?? { found: false } }));
  } finally { await pool.close(); }
})().catch(error => { console.error(JSON.stringify({ error: error.code || 'PREFLIGHT_FAILED' })); process.exitCode = 1; });
