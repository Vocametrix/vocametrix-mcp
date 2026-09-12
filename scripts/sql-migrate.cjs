// Production WRITE: run only after the Azure confirmation password check.
// Database credentials arrive on stdin; no credentials are stored in this file.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { readFileSync } = require('node:fs');
const platformRoot = resolve(__dirname, '../../vocametrix-platform');
const sql = createRequire(resolve(platformRoot, 'package.json'))('mssql');

(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { server, database, user, password } = JSON.parse(input);
  const pool = await new sql.ConnectionPool({ server, database, user, password,
    options: { encrypt: true }, connectionTimeout: 15000, requestTimeout: 30000 }).connect();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();
    try {
      await new sql.Request(transaction).batch(readFileSync(resolve(platformRoot, 'sql/mcp_oauth.sql'), 'utf8'));
      const result = await new sql.Request(transaction).query("SELECT name FROM sys.tables WHERE name IN ('McpOAuthCodes','McpOAuthFamilies','McpOAuthTokens')");
      if (result.recordset.length !== 3) throw new Error('Migration verification failed');
      await transaction.commit();
      console.log(JSON.stringify({ migrated: true, tables: result.recordset.map(row => row.name) }));
    } catch (error) { await transaction.rollback(); throw error; }
  } finally { await pool.close(); }
})().catch(error => { console.error(JSON.stringify({ error: error.code || 'MIGRATION_FAILED' })); process.exitCode = 1; });
