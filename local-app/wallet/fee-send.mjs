import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {formatUnits} from 'quais';
import {feeAddress,feeDigest,quotedFee,tokenAmount,ZERO_TOKEN} from './fee-operation.mjs';
import {verifyQuotedAssertion} from './operation.mjs';

const fail=(status,message)=>Object.assign(new Error(message),{status});
const unavailable=()=>fail(423,'Sending is temporarily unavailable. Your funds remain in your wallet.');
// Deliberately not enabled by environment or HTTP parameters. A pinned v3
// assignment loader and a reviewed fee executor must be wired server-side.
// Shares the durable operation table/lane with native Send, preventing the two
// send paths from independently accepting concurrent operations for one user.
export function createFeeSend(db,{loadWallet,chain,executor=null,now=Date.now}){
 const accountRequired=a=>{if(a?.method!=='passkey')throw fail(401,'Sign in with your passkey.');};
 async function available(){return Boolean(executor&&await executor.available());}
 async function wallet(account){
  const row=await loadWallet(db,account.id);
  if(!row||row.generation!==3||row.revoked_at!==null)throw unavailable();
  assert.equal(row.account_id,account.id);
  return row;
 }
 async function prepare(account,input){
  accountRequired(account);if(!await available())throw unavailable();
  const row=await wallet(account);let recipient,token;
  try{recipient=feeAddress(input.recipient);token=input.token===ZERO_TOKEN?ZERO_TOKEN:feeAddress(input.token);}
  catch{throw fail(400,'Enter a valid Cyprus-1 recipient and token address.');}
  if([row.plan.address,row.plan.implementation,row.plan.factory,token].some(a=>a?.toLowerCase()===recipient.toLowerCase()))throw fail(400,'This recipient is not supported.');
  // Metadata and balances are read by the server, never accepted from the UI.
  const view=await chain.snapshot(row.plan);if(!view.deployed)throw unavailable();
  const asset=token===ZERO_TOKEN?{decimals:18,symbol:'QUAI',balanceWei:view.balanceWei}:await chain.token(row.plan,token,view.block);
  let amount;try{amount=tokenAmount(input.amount,asset.decimals);}catch{throw fail(400,'Enter a positive amount within the token’s decimal precision.');}
  if(BigInt(asset.balanceWei)<BigInt(amount))throw fail(409,'Insufficient token balance.');
  const id=randomUUID();let expires=now()+120000;
  const op={chainId:9,action:6,wallet:row.plan.address,epoch:view.epoch,walletNonce:view.nonce,deadline:String(Math.floor(expires/1000)),quote:{token,recipient,amount,requestId:'0x'+randomBytes(32).toString('hex')}};
  // Executor quotes without a signature. Final exact-assertion preflight is
  // mandatory after user presence; it must stop if this quote is insufficient.
  const pricing=await executor.quote(row,structuredClone(op),view);
  // User-presence time starts after the read-only estimate, not while RPC and
  // native simulation are running. Nothing has been signed at this point.
  expires=now()+120000;op.deadline=String(Math.floor(expires/1000));
  op.quote={...op.quote,relayer:feeAddress(pricing.relayer),networkFee:String(pricing.networkFee),gasPrice:String(pricing.gasPrice)};
  op.digest=feeDigest(op);
  const fee=quotedFee(1,op.quote.networkFee);
  if(BigInt(view.balanceWei)<BigInt(fee.totalFee)+(token===ZERO_TOKEN?BigInt(amount):0n))throw fail(409,'Insufficient QUAI for the amount and quoted fee.');
  const prepared=await executor.prepare(row,structuredClone(op),view,pricing);
  assert.deepEqual(prepared.operation,op,'Executor changed the requested operation');
  await db.transaction(async()=>{
   await db.prepare('SELECT id FROM passkey_accounts WHERE id=$1 FOR UPDATE').get(account.id);
   await db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE account_id=$1 AND phase='awaiting_confirmation' AND expires_at<=$2").run(account.id,now());
   const pending=await db.prepare("SELECT id FROM passkey_native_operations WHERE account_id=$1 AND phase IN ('awaiting_confirmation','verifying','authorized','submitting')").get(account.id);
   if(pending)throw fail(409,'An earlier transfer is still being checked. Do not send it again.');
   await db.prepare('INSERT INTO passkey_native_operations(id,account_id,credential_id,phase,plan,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)').run(id,account.id,row.credential_id,'awaiting_confirmation',JSON.stringify(prepared),now(),expires);
  });
  return {id,review:{wallet:op.wallet,token,recipient,amount:formatUnits(amount,asset.decimals),symbol:asset.symbol,network:'Quai Mainnet · Cyprus-1',networkFee:formatUnits(fee.networkFee,18),serviceFee:formatUnits(fee.serviceFee,18),totalFee:formatUnits(fee.totalFee,18),feeCurrency:'QUAI',feePaidBy:'Your wallet',feeDescription:'Quoted network fee plus 5% service fee. The recipient receives the full amount.'},options:{challenge:Buffer.from(op.digest.slice(2),'hex').toString('base64url'),rpId:row.rp_id,userVerification:'required',timeout:120000,allowCredentials:[{type:'public-key',id:row.credential_id}]}};
 }
 async function confirm(account,input){
  accountRequired(account);if(!await available())throw unavailable();
  const job=await db.prepare("UPDATE passkey_native_operations SET phase='verifying' WHERE id=$1 AND account_id=$2 AND phase='awaiting_confirmation' AND expires_at>$3 RETURNING *").get(input.id,account.id,now());
  if(!job)throw fail(409,'This confirmation expired or was already used. No retry was sent.');
  try{
   const row=await wallet(account),prepared=JSON.parse(job.plan),op=prepared.operation;
   assert.equal(row.credential_id,job.credential_id);assert.equal(op.wallet,row.plan.address);assert(BigInt(op.deadline)>BigInt(Math.floor(now()/1000))+30n);
   const verified=await verifyQuotedAssertion(op,input.response,row);
   await db.transaction(async()=>{
    const c=await db.prepare('SELECT counter,revoked_at FROM passkey_credentials WHERE id=$1 AND account_id=$2 FOR UPDATE').get(row.credential_id,account.id);
    assert(c&&c.revoked_at===null);assert.equal(c.counter,row.counter);
    await db.prepare('UPDATE passkey_credentials SET counter=$1,last_used=$2 WHERE id=$3').run(verified.counter,now(),row.credential_id);
    await db.prepare("UPDATE passkey_native_operations SET phase='authorized',assertion=$1 WHERE id=$2 AND phase='verifying'").run(JSON.stringify(verified.auth),job.id);
   });
   // Executor retains submitting on an ambiguous result. Neither status reads,
   // login nor a second confirmation can send the same operation again.
   await executor.execute({id:job.id,accountId:account.id,row,prepared,auth:verified.auth});
   return status(account,job.id);
  }catch{
   await db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE id=$1 AND phase IN ('verifying','authorized')").run(job.id);
   throw fail(409,'Transfer stopped. Check its status before creating another transfer. Nothing will be retried automatically.');
  }
 }
 async function status(account,id){
  accountRequired(account);const row=await db.prepare('SELECT id,phase,tx_hash,receipt FROM passkey_native_operations WHERE id=$1 AND account_id=$2').get(id,account.id);
  if(!row)throw fail(404,'Transfer not found.');
  return {id:row.id,status:row.phase,transactionHash:row.tx_hash,receipt:row.receipt?JSON.parse(row.receipt):null};
 }
 return {available,prepare,confirm,status};
}
