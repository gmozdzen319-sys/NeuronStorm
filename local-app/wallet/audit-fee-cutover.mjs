// Operator-only READ-ONLY audit. No migrations, grants, keys or broadcast.
import assert from 'node:assert/strict';
import pg from 'pg';
for(const name of ['NS_WALLET_AUTO_ACTIVATE','NS_WALLET_SEND_ENABLED','NS_WALLET_PROVISION_ENABLED'])assert.equal(process.env[name],'false');
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'neuron-storm-readonly-cutover-audit'});
try{
 await client.connect();await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const count=async sql=>Number((await client.query(sql)).rows[0].n);
 const lanes=await count('SELECT count(*) AS n FROM passkey_relayer_lanes');
 let unresolvedApprovals=0,runningAutoActivations=0,unresolvedTransfers=0;
 for(const suffix of ['', '_v2']){
  unresolvedApprovals+=await count(`SELECT count(*) AS n FROM passkey_clone_approvals${suffix} WHERE phase IN ('preparing','submitting') OR (phase='quoted' AND approved)`);
  runningAutoActivations+=await count(`SELECT count(*) AS n FROM passkey_auto_activations${suffix} WHERE phase IN ('running','ambiguous')`);
  unresolvedTransfers+=await count(`SELECT count(*) AS n FROM passkey_native_operations${suffix} WHERE phase IN ('verifying','authorized','submitting') OR (phase='awaiting_confirmation' AND expires_at>EXTRACT(EPOCH FROM now())*1000)`);
 }
 await client.query('COMMIT');
 console.log(JSON.stringify({feeCutoverAudit:{at:new Date().toISOString(),automatic:false,send:false,provision:false,relayerLaneEmpty:lanes===0,unresolvedApprovals,runningAutoActivations,unresolvedTransfers,ready:lanes===0&&unresolvedApprovals===0&&runningAutoActivations===0&&unresolvedTransfers===0},broadcasts:0}));
}finally{await client.end();}
