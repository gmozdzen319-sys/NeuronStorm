// Explicit read-only production diagnosis: no signer, mutation or broadcast.
import pg from 'pg';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:10000});
const account='914c577f-226c-4f1e-a7bb-2a4235f4a1a3';
try{
 await client.connect();await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const rows=async(sql,args=[]) => (await client.query(sql,args)).rows;
 const grant=await rows('SELECT id,enabled,budget_wei,reserved_wei,expires_at,expires_at>EXTRACT(EPOCH FROM now())*1000 AS unexpired FROM passkey_relayer_grants WHERE id=$1',[process.env.NS_FEE_GRANT_ID]);
 const operations=await rows('SELECT id,phase,created_at,expires_at,tx_hash,expires_at>EXTRACT(EPOCH FROM now())*1000 AS unexpired FROM passkey_native_operations WHERE account_id=$1 ORDER BY created_at DESC LIMIT 6',[account]);
 const lanes=await rows('SELECT reference,purpose FROM passkey_relayer_lanes WHERE relayer=$1',[process.env.NS_WALLET_RELAYER_ADDRESS.toLowerCase()]);
 await client.query('COMMIT');
 console.log(JSON.stringify({feeSendReadOnlyAudit:{at:new Date().toISOString(),configured:process.env.NS_FEE_SEND_ENABLED==='true',scopeMatches:process.env.NS_FEE_ALLOWED_ACCOUNT_ID===account,grant,operations,lanes},broadcasts:0}));
}finally{await client.end();}
