// Free cutover only: persistent plans, never provisioning, signing or broadcasting.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../db/database.mjs';
import {WALLET_GENERATION,assignCloneWallet,loadCloneWallet} from '../wallet-infrastructure.mjs';

export async function prepareReceiveAssignments(db,env=process.env){
 assert.equal(WALLET_GENERATION,2,'Receive v2 required');
 for(const flag of ['NS_WALLET_AUTO_ACTIVATE','NS_WALLET_PROVISION_ENABLED','NS_WALLET_SEND_ENABLED'])assert.equal(env[flag],'false','Paid execution must remain disabled');
 const accounts=await db.prepare('SELECT account_id,address FROM passkey_v1_assignments ORDER BY account_id').all();
 const result=[];
 for(const legacy of accounts){
  const existing=await db.prepare('SELECT account_id FROM passkey_clone_wallets WHERE account_id=$1').get(legacy.account_id);
  const assignment=await assignCloneWallet(db,legacy.account_id);
  if(!assignment){result.push({accountId:legacy.account_id,status:'blocked_missing_authorized_key'});continue;}
  const current=await loadCloneWallet(db,legacy.account_id);
  assert(current&&current.revoked_at===null,'Authorized original key required');
  assert.notEqual(current.address.toLowerCase(),legacy.address.toLowerCase(),'Legacy Receive address must not be reused');
  result.push({accountId:legacy.account_id,status:existing?'existing_v2':'reserved_v2',address:current.plan.address});
 }
 return {generation:2,accounts:result,broadcasts:0,spentQuai:'0',activationEnabled:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=await openDatabase(process.env.DATABASE_URL);
 try{console.log(JSON.stringify({receiveV2AssignmentAudit:await prepareReceiveAssignments(db)}));}
 finally{await db.close();}
}
