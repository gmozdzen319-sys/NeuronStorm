import {getAddress} from 'quais';
// One explicitly reviewed incident, NOT generic recovery from a missing receipt.
// Render 2026-10-17 15:54:00 UTC, commit 58d9692, recorded
// execute.locked_state / head-guard:12:124. That code path throws BEFORE sendRaw.
// The sole reserved lane must match the user's exact hash. No signing capability.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {openDatabase} from '../db/database.mjs';
import {createWalletRPC,walletABI} from './chain.mjs';
import {assertCanonicalBlock,validateBlock} from './head-guard.mjs';
import {releaseUnbroadcastSend} from './send-reservation.mjs';
const HASH='0x00330077752e324f5b14f17f197d6b20915c59c099b04819c4c8a4592994b32f';
export async function releaseReviewedSend(db,rpc){
 const intent=await db.prepare('SELECT * FROM passkey_relayer_intents WHERE tx_hash=$1').get(HASH);
 assert(intent,'Reviewed intent not found');
 if(intent.phase==='failed'&&intent.broadcast_started===false)return {alreadyReleased:true};
 assert.equal(intent.phase,'submitting');assert.equal(intent.broadcast_started,null,'Not the historical incident');
 const operation=await db.prepare('SELECT * FROM passkey_native_operations WHERE id=$1').get(intent.operation_id);
 assert(operation?.phase==='submitting'&&operation.tx_hash===HASH&&!operation.receipt);
 assert(operation.created_at>=Date.parse('2026-10-17T15:47:16Z')&&operation.created_at<=Date.parse('2026-10-17T15:54:00Z'));
 assert(operation.expires_at<Date.now(),'Original attempt not expired');
 const prepared=JSON.parse(operation.plan),tx=JSON.parse(intent.transaction_plan),op=prepared.operation;
 assert.equal(op.chainId,9);assert.equal(op.action,6);assert.equal(tx.from.toLowerCase(),intent.relayer);
 assert.equal(tx.to.toLowerCase(),op.wallet.toLowerCase());assert.equal(String(tx.nonce),intent.nonce);
 assert.equal(BigInt(await rpc('quai_chainId',[])),9n);
 const block=validateBlock(await rpc('quai_getBlockByNumber',['latest',false])),tag=block.woHeader.number;
 const [receipt,transaction,nonce,pending,walletNonce]=await Promise.all([
  rpc('quai_getTransactionReceipt',[HASH]),rpc('quai_getTransactionByHash',[HASH]),
  rpc('quai_getTransactionCount',[getAddress(tx.from),tag]),rpc('quai_getTransactionCount',[getAddress(tx.from),'pending']),
  rpc('quai_call',[{to:op.wallet,data:walletABI.encodeFunctionData('nonce',[])},tag])
 ]);
 assert.equal(receipt,null);assert.equal(transaction,null);
 assert.equal(BigInt(nonce),BigInt(intent.nonce));assert.equal(BigInt(pending),BigInt(intent.nonce));
 assert.equal(walletABI.decodeFunctionResult('nonce',walletNonce)[0],BigInt(op.walletNonce));
 await assertCanonicalBlock(rpc,block);
 return db.transaction(async()=>{
  await db.prepare('SELECT id FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(intent.grant_id);
  const current=await db.prepare('SELECT * FROM passkey_relayer_intents WHERE operation_id=$1 FOR UPDATE').get(intent.operation_id);
  assert.deepEqual(current,intent,'Incident changed during review');
  // Historical proof comes from the reviewed pre-broadcast STOP, not RPC absence.
  await db.prepare('UPDATE passkey_relayer_intents SET broadcast_started=FALSE WHERE operation_id=$1').run(intent.operation_id);
  const released=await releaseUnbroadcastSend(db,{id:intent.operation_id,grantId:intent.grant_id,relayer:intent.relayer,hash:HASH});
  return {released,broadcasts:0};
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.argv[2],'--reviewed-2026-10-17','Explicit incident selection required');
 const db=await openDatabase(process.env.DATABASE_URL);
 try{console.log('Reviewed pre-broadcast recovery:',JSON.stringify(await releaseReviewedSend(db,createWalletRPC())));}
 finally{await db.close();}
}
