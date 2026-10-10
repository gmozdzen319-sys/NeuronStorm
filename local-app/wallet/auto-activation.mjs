import assert from 'node:assert/strict';
import {parseUnits,getAddress} from 'quais';
import {configuredExecutor} from './configured-executor.mjs';
import {WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {activationFailure} from './activation-failure.mjs';
import {randomUUID} from 'node:crypto';

export const AUTO_MAXIMUM=15000000000000000000n;
export function validateAutoQuote(q,{accountId,address,relayer,now=Date.now()}){
 assert.equal(q.accountId,accountId);assert.equal(q.address.toLowerCase(),address.toLowerCase());
 assert.equal(q.chainId,9);assert.equal(q.factory,infra.factory);assert.equal(q.implementation,infra.implementation);
 assert.equal(q.transaction.from.toLowerCase(),relayer.toLowerCase());assert.equal(q.transaction.to.toLowerCase(),infra.factory.toLowerCase());
 assert.equal(BigInt(q.transaction.value),0n);assert.equal(BigInt(q.transaction.gas),330000n);assert.equal(BigInt(q.gasLimit),330000n);
 const reserve=BigInt(q.transaction.gasPrice)*330000n;
 assert(reserve>0n&&reserve<=AUTO_MAXIMUM,'Activation exceeds 15 QUAI');
 assert.equal(parseUnits(q.maximumCostQuai,18),reserve);assert(parseUnits(q.balanceQuai,18)>=reserve+10000000000000000000n);
 assert(q.native&&!q.nativePreflightRequired&&q.approvalRequired&&q.broadcastAllowed===false);
 const age=now-Date.parse(q.quotedAt);assert(Number.isFinite(age)&&age>=0&&age<60000);
 return reserve;
}

export function createAutoActivation(db,{relayer,makeProvisioner,now=Date.now}){
 relayer=getAddress(relayer).toLowerCase();
 async function blocked(){
  return await db.prepare("SELECT account_id FROM passkey_auto_activations WHERE relayer=$1 AND phase IN ('running','ambiguous') LIMIT 1").get(relayer)
   ||await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(relayer)
   ||await db.prepare("SELECT account_id FROM passkey_clone_approvals WHERE phase IN ('preparing','submitting') OR (phase='quoted' AND approved=TRUE) LIMIT 1").get();
 }
 async function runNext(){
  // Claim before any quote/signing. The permanent attempt is never recycled.
  const job=await db.transaction(async()=>{
   await db.lock('neuron-storm:auto-activation:'+relayer);
   if(await blocked())return null;
   const candidate=await db.prepare(`SELECT w.account_id,w.address FROM passkey_clone_wallets w
    JOIN passkey_accounts a ON a.id=w.account_id
    JOIN passkey_credentials c ON c.id=w.credential_id AND c.account_id=w.account_id
    LEFT JOIN passkey_clone_approvals p ON p.account_id=w.account_id
    WHERE a.rp_id=$1 AND a.origin=$2 AND c.revoked_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM passkey_auto_activations j WHERE j.account_id=w.account_id)
    AND (p.account_id IS NULL OR (p.phase='quoted' AND p.approved=FALSE AND p.tx_hash IS NULL AND p.receipt IS NULL AND p.expires_at<=$3))
    AND NOT EXISTS(SELECT 1 FROM passkey_clone_approval_history h WHERE h.account_id=w.account_id
      AND ((h.evidence::jsonb->>'phase')<>'quoted' OR (h.evidence::jsonb->>'approved')='true' OR (h.evidence::jsonb->>'tx_hash') IS NOT NULL))
    ORDER BY w.created_at,w.account_id LIMIT 1 FOR UPDATE OF w`).get(infra.rpID,infra.origin,now());
   if(!candidate)return null;
   const grantId='auto-activation-v1:'+candidate.account_id;
   await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,FALSE)').run(grantId,relayer,String(AUTO_MAXIMUM),now()+300000);
   await db.prepare("INSERT INTO passkey_auto_activations VALUES($1,$2,$3,'running',$4)").run(candidate.account_id,relayer,grantId,now());
   return {...candidate,grantId};
  });
  if(!job)return null;
  return runClaimed(job);
 }
 // Operator-only, explicit ONE new attempt after reviewing pre-broadcast STOP.
 // Never called by the worker timer; no public route exposes this capability.
 async function runReviewed(accountId){
  const job=await db.transaction(async()=>{
   await db.lock('neuron-storm:auto-activation:'+relayer);assert(!await blocked(),'Relayer has unresolved work');
   const previous=await db.prepare('SELECT * FROM passkey_auto_activations WHERE account_id=$1 FOR UPDATE').get(accountId);
   assert(previous&&previous.phase==='stopped'&&previous.relayer===relayer,'Only a reviewed pre-broadcast STOP can resume');
   const wallet=await db.prepare(`SELECT w.* FROM passkey_clone_wallets w JOIN passkey_accounts a ON a.id=w.account_id
    JOIN passkey_credentials c ON c.id=w.credential_id AND c.account_id=w.account_id
    WHERE w.account_id=$1 AND a.rp_id=$2 AND a.origin=$3 AND c.revoked_at IS NULL`).get(accountId,infra.rpID,infra.origin);assert(wallet);
   const approval=await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1 FOR UPDATE').get(accountId);
   assert(!approval||approval.phase==='stopped'&&!approval.tx_hash&&!approval.receipt,'An existing transaction requires reconciliation');
   const unsafeHistory=await db.prepare(`SELECT id FROM passkey_clone_approval_history WHERE account_id=$1 AND
    ((evidence::jsonb->>'tx_hash') IS NOT NULL OR (evidence::jsonb->>'receipt') IS NOT NULL OR
     (evidence::jsonb->>'phase') IN ('submitting','confirmed','failed')) LIMIT 1`).get(accountId);assert(!unsafeHistory,'Broadcast history cannot be retried');
   const oldGrant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(previous.grant_id);
   assert(oldGrant&&!oldGrant.enabled&&BigInt(oldGrant.reserved_wei)===0n,'Unresolved fee reservation');
   const grantId='auto-reviewed:'+accountId+':'+randomUUID();
   await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,FALSE)').run(grantId,relayer,String(AUTO_MAXIMUM),now()+300000);
   await db.prepare('INSERT INTO passkey_activation_events(account_id,stage,code,details,created_at) VALUES($1,$2,$3,$4,$5)').run(accountId,'OPERATOR_REVIEW','PRE_BROADCAST_ONLY',JSON.stringify({previousGrant:previous.grant_id,newGrant:grantId}),now());
   await db.prepare("UPDATE passkey_auto_activations SET phase='running',grant_id=$1 WHERE account_id=$2").run(grantId,accountId);
   return {account_id:accountId,address:wallet.address,grantId};
  });
  return runClaimed(job);
 }
 async function runClaimed(job){
  let phase='stopped',stage='CONFIGURATION';
  try{
   const provisioner=await makeProvisioner(job.grantId);
   stage='QUOTE';
   const quote=await provisioner.quote(job.account_id);
   stage='QUOTE_POLICY';
   validateAutoQuote(quote,{accountId:job.account_id,address:job.address,relayer,now:now()});
   stage='APPROVAL';
   await db.transaction(async()=>{
    const saved=await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1 FOR UPDATE').get(job.account_id);
    assert(saved&&saved.phase==='quoted'&&!saved.approved&&!saved.tx_hash&&!saved.receipt&&saved.expires_at>now());
    assert.equal(saved.commitment,quote.commitment);assert.deepEqual(JSON.parse(saved.quote),quote);
    await db.prepare('UPDATE passkey_relayer_grants SET enabled=TRUE WHERE id=$1').run(job.grantId);
    await db.prepare('UPDATE passkey_clone_approvals SET approved=TRUE WHERE account_id=$1').run(job.account_id);
   });
   stage='EXECUTION';
   const result=await provisioner.execute(job.account_id);
   const saved=await db.prepare('SELECT phase,tx_hash,receipt FROM passkey_clone_approvals WHERE account_id=$1').get(job.account_id);
   assert(saved&&saved.phase===result.status&&saved.tx_hash===result.transactionHash&&saved.receipt);
   phase=result.status==='confirmed'?'confirmed':'stopped';
  }catch(error){
   // No exception details: SDK errors can contain sensitive signing input.
   const saved=await db.prepare('SELECT phase,tx_hash FROM passkey_clone_approvals WHERE account_id=$1').get(job.account_id);
   if(saved&&(saved.phase==='submitting'||saved.tx_hash))phase='ambiguous';
   const failure=activationFailure(error,stage);
   await db.prepare('INSERT INTO passkey_activation_events(account_id,stage,code,created_at) VALUES($1,$2,$3,$4)').run(job.account_id,failure.stage,failure.code,now());
  }finally{
   await db.transaction(async()=>{
    await db.prepare('UPDATE passkey_relayer_grants SET enabled=FALSE WHERE id=$1').run(job.grantId);
    await db.prepare("UPDATE passkey_clone_approvals SET approved=FALSE,phase='stopped' WHERE account_id=$1 AND phase IN ('quoted','preparing')").run(job.account_id);
    await db.prepare('UPDATE passkey_auto_activations SET phase=$1 WHERE account_id=$2').run(phase,job.account_id);
   });
  }
  return {accountId:job.account_id,status:phase};
 }
 return {runNext,runReviewed};
}

export function configuredAutoActivation(db,chain,env=process.env){
 if(env.NS_WALLET_AUTO_ACTIVATE!=='true')return null;
 assert.equal(env.NS_WALLET_NETWORK_POLICY,'official-single-source-v1');
 assert.notEqual(env.NS_WALLET_PROVISION_ENABLED,'true','Do not run two provisioning workers');
 const relayer=getAddress(env.NS_WALLET_RELAYER_ADDRESS);
 assert.equal(relayer,'0x001893151cDcc11372f6dd067e3424f47ad8534a');
 return createAutoActivation(db,{relayer,makeProvisioner:async grantId=>{
  const executor=await configuredExecutor(db,chain,{...env,NS_WALLET_SEND_ENABLED:'false',NS_WALLET_PROVISION_ENABLED:'true',NS_WALLET_GRANT_ID:grantId,NS_WALLET_RELAYER_KEY_FILE:'/etc/secrets/neuron-relayer.key'});
  return executor.provisioner;
 }});
}
