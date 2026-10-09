import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {formatUnits} from 'quais';
import {loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {nativeAmount,nativeRecipient,operationDigest,verifyTransferAssertion} from './operation.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const SEND_UNAVAILABLE='Sending is temporarily unavailable. Your funds remain in your wallet.';
// The executor is server-only. No HTTP parameter can install or enable one.
// This service commits a consumed request before any verification/network action.
export function createNativeSend(db,{chain,executor=null,now=Date.now}){
 const requireAccount=a=>{if(!a||a.method!=='passkey')throw fail(401,'Sign in with your passkey.');};
 async function available(){return Boolean(executor&&await executor.available());}
 async function prepare(account,input){
  requireAccount(account);if(!await available())throw fail(423,SEND_UNAVAILABLE);
  const row=await loadCloneWallet(db,account.id);if(!row||row.revoked_at!==null)throw fail(423,SEND_UNAVAILABLE);
  let recipient,amount;
  try{recipient=nativeRecipient(input.recipient,row.plan.address);amount=nativeAmount(input.amount);}catch{throw fail(400,'Enter a valid Cyprus-1 Quai recipient and a positive amount with up to 18 decimals.');}
  const view=await chain.snapshot(row.plan);if(!view.deployed||BigInt(view.balanceWei)<BigInt(amount))throw fail(409,'The wallet is not ready or has insufficient QUAI.');
  const id=randomUUID(),expires=now()+120000;
  // A counter-zero/synced passkey must not replay an assertion against a later
  // request with identical parameters in the same second. Every persisted
  // challenge is unique, even after STOP or an unused/expired request.
  const prior=await db.prepare("SELECT MAX((plan::jsonb->'operation'->>'deadline')::BIGINT) AS deadline FROM passkey_native_operations WHERE account_id=$1").get(account.id);
  const deadline=Math.max(Math.floor(expires/1000),Number(prior.deadline||0)+1);
  if(deadline>Math.floor(now()/1000)+180)throw fail(429,'Please wait a minute before preparing another transfer.');
  const op={chainId:9,wallet:row.plan.address,recipient,amount,action:5,epoch:view.epoch,walletNonce:view.nonce,deadline:String(deadline)};op.digest=operationDigest(op);
  // Before user presence: frozen fee ceiling and fresh relayer state. Exact signed
  // bytes cannot be simulated until the real assertion exists.
  const prepared=await executor.prepare(row,op,view);
  assert.deepEqual(prepared.operation,op,'Executor changed the requested operation');
  await db.transaction(async()=>{
   await db.prepare('SELECT id FROM passkey_accounts WHERE id=$1 FOR UPDATE').get(account.id);
   await db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE account_id=$1 AND phase='awaiting_confirmation' AND expires_at<=$2").run(account.id,now());
   const pending=await db.prepare("SELECT id FROM passkey_native_operations WHERE account_id=$1 AND phase IN ('awaiting_confirmation','verifying','authorized','submitting')").get(account.id);
   if(pending)throw fail(409,'An earlier transfer is still being checked. Do not send it again.');
   await db.prepare('INSERT INTO passkey_native_operations(id,account_id,credential_id,phase,plan,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)').run(id,account.id,row.credential_id,'awaiting_confirmation',JSON.stringify(prepared),now(),expires);
  });
  return {id,review:{wallet:op.wallet,recipient,amount:formatUnits(amount,18),network:'Quai Mainnet · Cyprus-1',maximumFee:formatUnits(prepared.maximumFeeWei,18),feePaidBy:'Neuron Storm relayer'},options:{challenge:Buffer.from(op.digest.slice(2),'hex').toString('base64url'),rpId:infra.rpID,userVerification:'required',timeout:120000,allowCredentials:[{type:'public-key',id:row.credential_id}]}};
 }
 async function confirm(account,input){
  requireAccount(account);if(!await available())throw fail(423,SEND_UNAVAILABLE);
  const job=await db.prepare("UPDATE passkey_native_operations SET phase='verifying' WHERE id=$1 AND account_id=$2 AND phase='awaiting_confirmation' AND expires_at>$3 RETURNING *").get(input.id,account.id,now());
  if(!job)throw fail(409,'This confirmation expired or was already used. No retry was sent.');
  try{
   const row=await loadCloneWallet(db,account.id);assert(row&&row.credential_id===job.credential_id);
   const prepared=JSON.parse(job.plan),op=prepared.operation;assert.equal(op.wallet,row.plan.address);assert(BigInt(op.deadline)>BigInt(Math.floor(now()/1000))+30n);
   const verified=await verifyTransferAssertion(op,input.response,row);
   await db.transaction(async()=>{
    const c=await db.prepare('SELECT counter,revoked_at FROM passkey_credentials WHERE id=$1 FOR UPDATE').get(row.credential_id);
    assert.equal(c.revoked_at,null);assert.equal(c.counter,row.counter,'Credential changed during confirmation');
    await db.prepare('UPDATE passkey_credentials SET counter=$1,last_used=$2 WHERE id=$3').run(verified.counter,now(),row.credential_id);
    await db.prepare("UPDATE passkey_native_operations SET phase='authorized',assertion=$1 WHERE id=$2 AND phase='verifying'").run(JSON.stringify(verified.auth),job.id);
   });
   // Executor must commit submitting + hash BEFORE broadcast. An exception after
   // that point keeps 'submitting' durable; neither login nor polling resends it.
   await executor.execute({id:job.id,accountId:account.id,row,prepared,auth:verified.auth});
   return status(account,job.id);
  }catch{
   await db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE id=$1 AND phase IN ('verifying','authorized')").run(job.id);
   throw fail(409,'Transfer stopped. Check its status before creating another transfer. Nothing will be retried automatically.');
  }
 }
 async function status(account,id){requireAccount(account);const r=await db.prepare('SELECT id,phase,tx_hash,receipt FROM passkey_native_operations WHERE id=$1 AND account_id=$2').get(id,account.id);if(!r)throw fail(404,'Transfer not found.');return {id:r.id,status:r.phase,transactionHash:r.tx_hash,receipt:r.receipt?JSON.parse(r.receipt):null};}
 return {prepare,confirm,status,available};
}
