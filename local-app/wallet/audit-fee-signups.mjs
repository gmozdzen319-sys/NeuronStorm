// Read-only rollout audit. No wallet assignment, signing, grants or broadcasts.
import pg from 'pg';
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:10000});
try{
 await db.connect();await db.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const {rows}=await db.query(`SELECT
  (SELECT count(*) FROM passkey_accounts) AS accounts,
  (SELECT count(*) FROM passkey_fee_wallets) AS fee_wallets,
  (SELECT count(*) FROM passkey_fee_signup_queue) AS new_signup_queue,
  (SELECT count(*) FROM passkey_fee_auto_activations) AS activation_attempts,
  (SELECT count(*) FROM passkey_fee_approvals WHERE tx_hash IS NOT NULL) AS fee_provisioning_transactions,
  (SELECT count(*) FROM passkey_fee_signup_queue q JOIN passkey_fee_auto_activations j USING(account_id) WHERE j.phase='confirmed') AS confirmed_new_signups`);
 await db.query('COMMIT');
 console.log(JSON.stringify({feeSignupAudit:rows[0],newSignupAutoActivation:process.env.NS_FEE_AUTO_ACTIVATE==='true',feeSendEnabled:process.env.NS_FEE_SEND_ENABLED==='true',legacyAutoActivation:process.env.NS_WALLET_AUTO_ACTIVATE==='true',legacyProvisioning:process.env.NS_WALLET_PROVISION_ENABLED==='true',allAccountsAllowed:!process.env.NS_FEE_ALLOWED_ACCOUNT_ID,auditBroadcasts:0}));
}finally{await db.end();}
