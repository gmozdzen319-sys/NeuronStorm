// Explicit operator command. Never imported by the server or run automatically.
// A fresh fully checked transaction may spend at most AUTO_MAXIMUM per account.
import assert from 'node:assert/strict';
import {openDatabase} from '../db/database.mjs';
import {createWalletChain} from './chain.mjs';
import {configuredAutoActivation,AUTO_MAXIMUM} from './auto-activation.mjs';
import {activationFailure} from './activation-failure.mjs';

assert.equal(process.argv[2],'--execute-reviewed','Explicit operator review required');
const accounts=process.argv.slice(3);
assert(accounts.length>0&&accounts.length<=10&&new Set(accounts).size===accounts.length);
assert(accounts.every(id=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)));
assert.equal(AUTO_MAXIMUM,15000000000000000000n);
assert.equal(process.env.NS_WALLET_AUTO_ACTIVATE,'true');
assert.notEqual(process.env.NS_WALLET_SEND_ENABLED,'true');
assert.notEqual(process.env.NS_WALLET_PROVISION_ENABLED,'true');
const db=await openDatabase(process.env.DATABASE_URL);
try{
 const worker=configuredAutoActivation(db,createWalletChain());assert(worker);
 for(const accountId of accounts){
  try{
   const result=await worker.runReviewed(accountId);
   const evidence=await db.prepare(`SELECT w.address,p.phase,p.tx_hash,p.receipt::jsonb->>'feeQuai' AS actual_fee_quai
    FROM passkey_clone_wallets w JOIN passkey_clone_approvals p ON p.account_id=w.account_id WHERE w.account_id=$1`).get(accountId);
   console.log(JSON.stringify({reviewedActivation:{...result,...evidence}}));
   if(result.status!=='confirmed')break; // Never continue a batch after any STOP.
  }catch(error){console.log(JSON.stringify({reviewedActivation:{accountId,status:'stopped',...activationFailure(error,'APPROVAL')}}));break;}
 }
}finally{await db.close();}
