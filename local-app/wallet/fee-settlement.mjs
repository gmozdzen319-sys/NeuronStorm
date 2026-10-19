import assert from 'node:assert/strict';
import {getAddress,keccak256} from 'quais';
import {feeWalletABI,boundFeeTransaction as bound} from './fee-plan.mjs';
import {feeDigest,quotedFee} from './fee-operation.mjs';
import {walletABI,factoryABI} from './chain.mjs';
import {observeReceipt} from './receipt-confirmation.mjs';
import {validateBlock,assertCanonicalBlock} from './head-guard.mjs';
import {diagnoseSend,sendStage} from './send-diagnostics.mjs';
const low=x=>x.toLowerCase();

// Transaction-scoped proof. No signer, sendRaw, retry or private-key capability.
export async function verifyFeeSettlement({rpc,row,job,intent,infrastructure,verifyNetwork}){
 sendStage('reconcile.exact_plan');
 assert.equal(intent.broadcast_started,true,'Broadcast boundary not proven');
 assert.equal(job.tx_hash,intent.tx_hash);assert.equal(job.id,intent.operation_id);
 assert.equal(row.account_id,job.account_id);assert.equal(row.generation,3);
 const prepared=JSON.parse(job.plan),op=prepared.operation,tx=JSON.parse(intent.transaction_plan);
 assert.equal(op.digest,feeDigest(op));assert.equal(op.chainId,9);assert.equal(op.action,6);
 assert.equal(low(op.wallet),low(row.plan.address));assert.equal(job.credential_id,row.credential_id);
 assert(job.assertion,'Missing authorized assertion');
 const expected={type:0,chainId:9,from:intent.relayer,to:op.wallet,nonce:prepared.relayerNonce,value:'0',gasPrice:prepared.gasPrice,gasLimit:prepared.gasLimit,
  data:feeWalletABI.encodeFunctionData('sendQuoted',[op.quote,op.deadline,row.plan.keyId,JSON.parse(job.assertion)]),accessList:tx.accessList};
 assert.equal(intent.nonce,prepared.relayerNonce);assert.equal(low(op.quote.relayer),low(intent.relayer));
 assert.equal(op.quote.gasPrice,prepared.gasPrice);assert.deepEqual(bound(tx),bound(expected));
 const reserve=BigInt(tx.gasLimit)*BigInt(tx.gasPrice);assert.equal(String(reserve),intent.maximum_fee_wei);assert.equal(String(reserve),prepared.maximumFeeWei);
 sendStage('reconcile.canonical_receipt');
 const observed=await observeReceipt(rpc,intent.tx_hash,3);
 if(observed.status!=='confirmed')return null;
 const receipt=observed.receipt,tag=receipt.blockNumber,block=validateBlock(await rpc('quai_getBlockByNumber',[tag,false]));
 assert.equal(block.hash,receipt.blockHash);
 const mined=await rpc('quai_getTransactionByHash',[intent.tx_hash]);assert(mined);
 assert.equal(low(mined.hash),low(intent.tx_hash));assert.equal(mined.blockHash,receipt.blockHash);assert.equal(BigInt(mined.blockNumber),BigInt(tag));
 assert.equal(BigInt(mined.transactionIndex),BigInt(receipt.transactionIndex));assert.equal(BigInt(mined.chainId),9n);
 assert.deepEqual(bound({type:mined.type,chainId:mined.chainId,from:mined.from,to:mined.to,nonce:mined.nonce,value:mined.value,gasPrice:mined.gasPrice,gasLimit:mined.gas??mined.gasLimit,data:mined.input??mined.data,accessList:mined.accessList}),bound(tx));
 assert.equal(low(receipt.from),low(intent.relayer));assert.equal(low(receipt.to),low(op.wallet));
 const call=async(address,abi,name,args=[])=>abi.decodeFunctionResult(name,await rpc('quai_call',[{to:address,data:abi.encodeFunctionData(name,args)},tag]));
 // The event is authoritative only from the pinned immutable implementation,
 // behind the assigned clone. An arbitrary contract emitting this event is not proof.
 sendStage('reconcile.runtime_and_state');
 assert.equal(keccak256(await rpc('quai_getCode',[op.wallet,tag])),row.plan.runtimeHash);
 assert.equal(keccak256(await rpc('quai_getCode',[infrastructure.implementation,tag])),infrastructure.implementationHash);
 assert.equal(keccak256(await rpc('quai_getCode',[infrastructure.factory,tag])),infrastructure.factoryHash);
 assert.equal(low((await call(infrastructure.factory,factoryABI,'implementation'))[0]),low(infrastructure.implementation));
 assert.equal((await call(infrastructure.factory,factoryABI,'implementationCodeHash'))[0],infrastructure.implementationHash);
 assert.equal(low((await call(infrastructure.factory,factoryABI,'walletOf',[row.plan.keyId]))[0]),low(op.wallet));
 const success=receipt.status==='0x1';
 assert.equal((await call(op.wallet,walletABI,'nonce'))[0],BigInt(op.walletNonce)+(success?1n:0n));
 assert.equal((await call(op.wallet,walletABI,'epoch'))[0],BigInt(op.epoch));
 assert.equal(BigInt(await rpc('quai_getTransactionCount',[getAddress(intent.relayer),tag])),BigInt(intent.nonce)+1n);
 sendStage('reconcile.execution_event');
 const topic=feeWalletABI.getEvent('QuotedSend').topicHash;
 assert(Array.isArray(receipt.logs));
 const events=receipt.logs.filter(l=>low(l.address)===low(op.wallet)&&l.topics?.[0]===topic);
 assert.equal(events.length,success?1:0,'Unexpected wallet execution evidence');
 if(success){
  const log=events[0];assert.equal(log.removed,false);assert.equal(low(log.transactionHash),low(intent.tx_hash));assert.equal(log.blockHash,receipt.blockHash);
  assert.equal(BigInt(log.blockNumber),BigInt(tag));assert.equal(BigInt(log.transactionIndex),BigInt(receipt.transactionIndex));
  const e=feeWalletABI.parseLog(log).args,q=op.quote;
  assert.equal(e.requestId,q.requestId);assert.equal(low(e.token),low(q.token));assert.equal(low(e.recipient),low(q.recipient));
  assert.equal(e.amount,BigInt(q.amount));assert.equal(low(e.relayer),low(intent.relayer));assert.equal(e.networkFee,BigInt(q.networkFee));
  assert.equal(e.serviceFee,BigInt(quotedFee(1,q.networkFee).serviceFee));
  // The pinned contract emits only AFTER _auth, successful native call or exact
  // token debit/credit checks, and fee payment. No whole-account balance deltas.
 }
 const price=BigInt(tx.gasPrice),gas=BigInt(receipt.gasUsed);assert(gas>0n&&gas<=BigInt(tx.gasLimit));
 assert.equal(BigInt(receipt.effectiveGasPrice??mined.gasPrice),price);
 assert(await verifyNetwork({rpc,block,relayer:intent.relayer,wallet:op.wallet}));
 await assertCanonicalBlock(rpc,block);await assertCanonicalBlock(rpc,observed.observedHead);
 assert.deepEqual(await rpc('quai_getTransactionReceipt',[intent.tx_hash]),receipt,'Receipt changed before settlement');
 return {status:success?'confirmed':'failed',fee:gas*price,reserve,block,receipt:{transactionHash:intent.tx_hash,blockHash:receipt.blockHash,blockNumber:tag,status:receipt.status,gasUsed:String(gas),gasPrice:String(price),feeWei:String(gas*price),confirmations:observed.confirmations,finalityProven:false}};
}

export function createFeeReconciler(db,{rpc,loadWallet,infrastructure,verifyNetwork,relayer}){
 async function reconcile(id){
  const job=await db.prepare('SELECT * FROM passkey_native_operations WHERE id=$1').get(id);
  const intent=await db.prepare('SELECT * FROM passkey_relayer_intents WHERE operation_id=$1').get(id);
  if(!job||!intent||low(intent.relayer)!==low(relayer))return {status:'unavailable'};
  if(['confirmed','failed'].includes(job.phase)&&job.phase===intent.phase&&job.receipt)return {status:job.phase,alreadySettled:true};
  assert.equal(job.phase,'submitting');assert.equal(intent.phase,'submitting');
  const row=await loadWallet(db,job.account_id);assert(row);
  const proof=await verifyFeeSettlement({rpc,row,job,intent,infrastructure,verifyNetwork});
  if(!proof)return {status:'submitting'};
  sendStage('reconcile.atomic_settlement');
  return db.transaction(async()=>{
   const g=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(intent.grant_id);
   const i=await db.prepare('SELECT * FROM passkey_relayer_intents WHERE operation_id=$1 FOR UPDATE').get(id);
   const j=await db.prepare('SELECT * FROM passkey_native_operations WHERE id=$1 FOR UPDATE').get(id);
   if(j.phase===proof.status&&i.phase===proof.status&&j.receipt)return {status:j.phase,alreadySettled:true};
   assert.deepEqual(i,intent);assert.deepEqual(j,job);assert(g&&low(g.relayer)===low(relayer));
   const lane=await db.prepare('SELECT * FROM passkey_relayer_lanes WHERE relayer=$1 FOR UPDATE').get(low(relayer));
   assert(lane&&lane.reference===id&&lane.purpose==='send','Lane ownership changed');
   assert(BigInt(g.reserved_wei)>=proof.reserve,'Reservation missing');
   await assertCanonicalBlock(rpc,proof.block);
   await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei-$1 WHERE id=$2').run(String(proof.reserve-proof.fee),intent.grant_id);
   await db.prepare('UPDATE passkey_relayer_intents SET phase=$1 WHERE operation_id=$2').run(proof.status,id);
   await db.prepare('UPDATE passkey_native_operations SET phase=$1,receipt=$2 WHERE id=$3').run(proof.status,JSON.stringify(proof.receipt),id);
   await db.prepare("DELETE FROM passkey_relayer_lanes WHERE relayer=$1 AND reference=$2 AND purpose='send'").run(low(relayer),id);
   return {status:proof.status,transactionHash:intent.tx_hash,feeWei:String(proof.fee),releasedReserveWei:String(proof.reserve-proof.fee),laneReleased:true};
  });
 }
 let next=0;
 async function poll(){
  if(Date.now()<next)return;next=Date.now()+30000;
  const lane=await db.prepare("SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1 AND purpose='send'").get(low(relayer));
  if(!lane)return;
  const job=await db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1').get(lane.reference);
  if(!job||JSON.parse(job.plan).operation.action!==6)return;
  const result=await reconcile(lane.reference);
  if(['confirmed','failed'].includes(result.status))console.info('[wallet-send-reconciled]',JSON.stringify({operationId:lane.reference,...result}));
 }
 return {reconcile,poll:diagnoseSend('reconcile.receipt_and_effects',poll)};
}
