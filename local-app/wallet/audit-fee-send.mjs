// Explicit read-only production diagnosis: no signer, mutation or broadcast.
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain} from './chain.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:10000});
const account='914c577f-226c-4f1e-a7bb-2a4235f4a1a3';
try{
 await client.connect();await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const rows=async(sql,args=[]) => (await client.query(sql,args)).rows;
 const grant=await rows('SELECT id,enabled,budget_wei,reserved_wei,expires_at,expires_at>EXTRACT(EPOCH FROM now())*1000 AS unexpired FROM passkey_relayer_grants WHERE id=$1',[process.env.NS_FEE_GRANT_ID]);
 const operations=[];
 for(const suffix of ['', '_v2'])operations.push({journal:suffix||'v1',rows:await rows(`SELECT id,phase,created_at,expires_at,tx_hash,assertion IS NOT NULL AS assertion_saved,expires_at>EXTRACT(EPOCH FROM now())*1000 AS unexpired FROM passkey_native_operations${suffix} WHERE account_id=$1 ORDER BY created_at DESC LIMIT 6`,[account])});
 const lanes=await rows('SELECT reference,purpose FROM passkey_relayer_lanes WHERE relayer=$1',[process.env.NS_WALLET_RELAYER_ADDRESS.toLowerCase()]);
 await client.query('COMMIT');
 console.log(JSON.stringify({feeSendReadOnlyAudit:{at:new Date().toISOString(),configured:process.env.NS_FEE_SEND_ENABLED==='true',scopeMatches:process.env.NS_FEE_ALLOWED_ACCOUNT_ID===account,grant,operations,lanes},broadcasts:0}));
 const registry=createFeeAssignments(JSON.parse(await readFile(process.env.NS_FEE_WALLET_MANIFEST,'utf8')));
 const row=await registry.load({prepare:sql=>({get:async(...args)=>(await client.query(sql,args)).rows[0]})},account);
 try{const view=await createWalletChain({infrastructure:registry.infrastructure}).snapshot(row.plan);console.log(JSON.stringify({feeSnapshotAudit:{deployed:view.deployed,nonce:view.nonce,balanceWei:view.balanceWei},broadcasts:0}));}
 catch(error){console.log(JSON.stringify({feeSnapshotAudit:{verified:false,code:error.code,message:String(error.message).slice(0,400),rpc:error.walletRPC??null},broadcasts:0}));}
}finally{await client.end();}
