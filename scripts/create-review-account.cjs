// Creates the metered review account used for the ChatGPT submission, in one
// transaction. Run it only after an Azure password confirmation.
//
// The normal signup path cannot produce this account: its reCAPTCHA is not
// scriptable, and email verification grants a seven-day web trial, which makes
// hasWebAccess() true and bills zero seconds. A review account must be metered,
// so it is written directly with web_sub_status 'expired' and no trial.
//
// Credentials arrive on stdin as JSON; nothing is read from a file or a literal.
// Windows PowerShell 5.1 prefixes a BOM when piping to a native executable, so
// redirect from a BOM-free file through cmd:
//   cmd /c "node scripts/create-review-account.cjs < payload.json"
//
// stdin: { server, database, user, password, accountEmail, accountPassword,
//          planId, credits }
// stdout: the generated API key, once. It is not stored anywhere else.

const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const platformRequire = createRequire(resolve(__dirname, '../../vocametrix-platform/package.json'));
const sql = platformRequire('mssql');
const bcrypt = platformRequire('bcryptjs');

const SALT_ROUNDS = 10; // matches routes/user/account.service.js

(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const {
    server, database, user, password,
    accountEmail, accountPassword, planId, credits,
  } = JSON.parse(input.replace(/^﻿/, ''));

  for (const [name, value] of Object.entries({ accountEmail, accountPassword, planId, credits })) {
    if (value === undefined || value === null || value === '') throw new Error(`missing ${name}`);
  }

  const pool = await new sql.ConnectionPool({
    server, database, user, password, options: { encrypt: true },
    connectionTimeout: 15000, requestTimeout: 15000,
  }).connect();

  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin();

    const existing = await new sql.Request(transaction)
      .input('email', sql.VarChar, accountEmail)
      .query('SELECT user_id FROM dbo.accounts WHERE email = @email');
    if (existing.recordset.length > 0) {
      throw new Error(`${accountEmail} already exists (user_id ${existing.recordset[0].user_id}); refusing to overwrite it`);
    }

    const plan = await new sql.Request(transaction)
      .input('planId', sql.Int, planId)
      .query('SELECT id, name FROM dbo.ApiPlans WHERE id = @planId');
    if (plan.recordset.length === 0) throw new Error(`plan id ${planId} not found in ApiPlans`);

    const apiKey = `vcmx_${randomBytes(32).toString('hex')}`;
    const hashed = await bcrypt.hash(accountPassword, SALT_ROUNDS);

    const inserted = await new sql.Request(transaction)
      .input('email', sql.VarChar, accountEmail)
      .input('password', sql.VarChar, hashed)
      .input('keyValue', sql.VarChar, apiKey)
      .input('planId', sql.Int, planId)
      .input('planName', sql.VarChar, plan.recordset[0].name)
      .input('credits', sql.Int, credits)
      .input('registration', sql.VarChar, new Date().toISOString().slice(0, 10))
      .query(`
        INSERT INTO dbo.accounts
          (first_name, last_name, email, password, language, languageCode, account_type,
           registration, email_verified, status, key_value, plan_id, plan_name,
           credits, max_seconds, used_seconds, current_billing_period_start,
           web_sub_status, newsletter, nbOfConnections,
           terms_accepted_at, privacy_accepted_at, marketing_consent)
        OUTPUT INSERTED.user_id
        VALUES
          ('OpenAI', 'Review', @email, @password, 'English', 'en', 'other',
           @registration, 1, 'active', @keyValue, @planId, @planName,
           @credits, 0, 0, SYSUTCDATETIME(),
           'expired', 0, 0,
           SYSUTCDATETIME(), SYSUTCDATETIME(), 0)`);

    const userId = inserted.recordset[0].user_id;

    // Read the row back inside the transaction: the account must be metered,
    // which means hasWebAccess() has to be false on what was actually written.
    const check = await new sql.Request(transaction)
      .input('userId', sql.Int, userId)
      .query(`
        SELECT status, email_verified, credits, max_seconds, used_seconds,
               web_sub_status, web_trial_ends_at, web_sub_current_period_end,
               web_stripe_subscription_id
        FROM dbo.accounts WHERE user_id = @userId`);
    const row = check.recordset[0];
    const unmetered = row.web_sub_status === 'comped'
      || (['trialing', 'active'].includes(row.web_sub_status)
          && (row.web_trial_ends_at || row.web_sub_current_period_end));
    if (unmetered) throw new Error(`written account would not be metered: web_sub_status=${row.web_sub_status}`);

    await transaction.commit();
    console.log(JSON.stringify({
      userId, plan: plan.recordset[0].name, account: row, apiKey,
    }, null, 2));
  } catch (error) {
    await transaction.rollback().catch(() => {});
    throw error;
  } finally {
    await pool.close();
  }
})().catch(error => { console.error('ERR', error.message); process.exitCode = 1; });
