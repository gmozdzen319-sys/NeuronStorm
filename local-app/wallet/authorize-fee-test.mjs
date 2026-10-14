// Explicit one-time operator grant for the already approved controlled test.
// Does not load a signer, request a passkey, fund anything or broadcast.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openDatabase} from '../db/database.mjs';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain} from './chain.mjs';
import {assertUnusedExpiredGrant} from './unused-test-grant.mjs';
const previousId='fee-v3-controlled-1000-manual';
const replaceUnused=process.argv[3]==='--replace-unused-expired-20261014';
assert(process.argv.length===3||replaceUnused);
const id=replaceUnused?'fee-v3-controlled-1000-manual-20261014':previousId;
const accountId='914c577f-226c-4f1e-a7bb-2a4235f4a1a3';
const wallet='0x00587af2ac5fd9fc6caff4c74eb0b3c8c47efb52';
const relayer='0x001893151cdcc11372f6dd067e3424f47ad8534a';
const budget=100n*10n**18n;
assert.equal(process.argv[2],'--approved-1000-quai-controlled-test');
for(const name of ['NS_WALLET_AUTO_ACTIVATE','NS_WALLET_SEND_ENABLED','NS_WALLET_PROVISION_ENABLED'])assert.equal(process.env[name],'false');
assert.notEqual(process.env.NS_FEE_SEND_ENABLED,'true');
assert.equal(process.env.NS_WALLET_RELAYER_ADDRESS.toLowerCase(),relayer);
const registry=createFeeAssignments(JSON.parse(await readFile(new URL('./fee-v3-deployment.json',import.meta.url),'utf8')));
const chain=createWalletChain({infrastructure:registry.infrastructure}),db=await openDatabase(process.env.DATABASE_URL);
try{
 const row=await registry.load(db,accountId);assert(row&&row.address===wallet&&row.revoked_at===null);
 const view=await chain.snapshot(row.plan);assert(view.deployed&&view.nonce==='0'&&view.epoch==='0');
 const balance=BigInt(await chain.rpc('quai_getBalance',[process.env.NS_WALLET_RELAYER_ADDRESS,'latest']));assert(balance>=budget+10n**19n);
 await db.transaction(async()=>{
  await db.lock('fee-v3-controlled-grant');
  assert(!await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(relayer));
  if(replaceUnused){
   const previous=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(previousId);
   const history=await db.prepare('SELECT COUNT(*) AS count FROM passkey_relayer_intents WHERE grant_id=$1').get(previousId);
   assertUnusedExpiredGrant(previous,{relayer,budget,now:Date.now(),intentCount:history.count});
   await db.prepare('UPDATE passkey_relayer_grants SET enabled=FALSE WHERE id=$1').run(previousId);
  }
  const existing=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(id);
  if(existing){assert(existing.relayer===relayer&&BigInt(existing.budget_wei)===budget&&existing.enabled&&existing.expires_at>Date.now());}
  else await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run(id,relayer,String(budget),Date.now()+7200000);
  const grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1').get(id);
  console.log(JSON.stringify({controlledFeeGrant:id,accountId,budgetQuai:'100',reservedWei:grant.reserved_wei,expiresAt:new Date(grant.expires_at).toISOString(),broadcasts:0}));
 });
}finally{await db.close();}
