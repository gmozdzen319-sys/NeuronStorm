import {activationPreStage,activationAttemptClaimed} from './activation-pre-attempt.mjs';
import assert from 'node:assert/strict';
import {parseUnits,getAddress} from 'quais';
import {configuredExecutor} from './configured-executor.mjs';
import {WALLET_INFRASTRUCTURE as infra,WALLET_GENERATION} from '../wallet-infrastructure.mjs';
import {activationFailure} from './activation-failure.mjs';
import {randomUUID} from 'node:crypto';
import {claimQuoteRetry,deferQuote,provenHashMismatch,hasUnsentActivationProof,safeQuoteRetry} from './activation-retry.mjs';

export const AUTO_MAXIMUM=40000000000000000000n;
const legacyInfrastructure=infra;
export function validateAutoQuote(q,{accountId,address,relayer,now=Date.now(),infrastructure=infra}){
 const infra=infrastructure,fee=infra.generation===3;
 assert.equal(q.accountId,accountId);assert.equal(q.address.toLowerCase(),address.toLowerCase());
 assert.equal(q.chainId,9);assert.equal(q.factory,infra.factory);assert.equal(q.implementation,infra.implementation);
 assert.equal(q.transaction.from.toLowerCase(),relayer.toLowerCase());assert.equal(q.transaction.to.toLowerCase(),infra.factory.toLowerCase());
 const limit=BigInt(q.gasLimit);assert(limit>0n);if(!fee)assert.equal(limit,330000n);
 assert.equal(BigInt(q.transaction.value),0n);assert.equal(BigInt(q.transaction.gas),limit);
 assert(BigInt(q.transaction.gasPrice)>0n);
 const reserve=BigInt(q.transaction.gasPrice)*limit;
 assert(reserve>0n&&reserve<=AUTO_MAXIMUM,'Activation exceeds 40 QUAI');
 assert.equal(parseUnits(q.maximumCostQuai,18),reserve);assert(parseUnits(q.balanceQuai,18)>=reserve+10000000000000000000n);
 assert(q.native&&!q.nativePreflightRequired&&q.approvalRequired&&q.broadcastAllowed===false);
 const age=now-Date.parse(q.quotedAt);assert(Number.isFinite(age)&&age>=0&&age<60000);
 return reserve;
}

export function createAutoActivation(db,{relayer,makeProvisioner,prepareQuote=async()=>{},now=Date.now,registry=null}){
 const infra=registry?.infrastructure??legacyInfrastructure,fee=registry!==null;
 if(fee){assert.equal(infra.generation,3);const original=db;
  const names={passkey_clone_wallets:'passkey_fee_wallets',passkey_clone_approvals:'passkey_fee_approvals',passkey_clone_approval_history:'passkey_fee_approval_history',passkey_auto_activations:'passkey_fee_auto_activations',passkey_activation_events:'passkey_fee_activation_events'};
  db={...original,prepare:sql=>original.prepare(sql.replace(/\b(passkey_clone_wallets|passkey_clone_approvals|passkey_clone_approval_history|passkey_auto_activations|passkey_activation_events)\b/g,name=>names[name]))};
 }
 relayer=getAddress(relayer).toLowerCase();
 async function blocked(){
  return await db.prepare("SELECT account_id FROM passkey_auto_activations WHERE relayer=$1 AND phase IN ('running','ambiguous') LIMIT 1").get(relayer)
   ||await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(relayer)
   ||await db.prepare("SELECT account_id FROM passkey_clone_approvals WHERE phase IN ('preparing','submitting') OR (phase='quoted' AND approved=TRUE) LIMIT 1").get();
 }
 async function runNext(){
  // Only explicit bounded waits resume; stopped/ambiguous accounts stay excluded.
  activationPreStage('CLAIM_TRANSACTION');
  const job=await db.transaction(async()=>{
   activationPreStage('CLAIM_LOCK');
   await db.lock('neuron-storm:auto-activation:'+relayer);
   activationPreStage('CLAIM_BLOCKERS');
   if(await blocked())return null;
   if(fee){const retry=await claimQuoteRetry(db,relayer,infra,now());if(retry)return retry;}
   activationPreStage('CLAIM_CANDIDATE');
   const candidate=await db.prepare(`SELECT w.account_id,w.address FROM passkey_clone_wallets w
    ${fee?'JOIN passkey_fee_signup_queue signup ON signup.account_id=w.account_id':''}
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
   // Grants are shared across generations; wallet queues are not. Never collide
   // with or revive a historical v1 sponsorship when assigning this user's v2.
   const grantId='auto-activation-v'+(fee?3:WALLET_GENERATION)+':'+candidate.account_id;
   activationPreStage('CLAIM_GRANT_INSERT');
   await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,FALSE)').run(grantId,relayer,String(AUTO_MAXIMUM),now()+300000);
   activationPreStage('CLAIM_ATTEMPT_INSERT');
   await db.prepare("INSERT INTO passkey_auto_activations VALUES($1,$2,$3,'running',$4)").run(candidate.account_id,relayer,grantId,now());
   activationPreStage('CLAIM_TRANSACTION');
   return {...candidate,grantId};
  });
  if(!job)return null;
  activationAttemptClaimed();
  return runClaimed(job);
 }
 // Operator-only, explicit ONE new attempt after reviewing pre-broadcast STOP.
 // Never called by the worker timer; no public route exposes this capability.
 async function runReviewed(accountId,{firstReviewOnly=false}={}){
  const job=await db.transaction(async()=>{
   await db.lock('neuron-storm:auto-activation:'+relayer);assert(!await blocked(),'Relayer has unresolved work');
   if(firstReviewOnly)assert(!await db.prepare("SELECT id FROM passkey_activation_events WHERE account_id=$1 AND stage='OPERATOR_REVIEW' LIMIT 1").get(accountId),'This one-time operator review was already consumed');
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
  let phase='stopped',stage='CONFIGURATION',failureFinalized=false;
  try{
   // Count history warm-up as part of this durable attempt, before loading a signer.
   stage='QUOTE';await prepareQuote();stage='CONFIGURATION';
   const provisioner=await makeProvisioner(job.grantId);
   stage='QUOTE';
   const quote=await provisioner.quote(job.account_id);
   stage='QUOTE_POLICY';
   validateAutoQuote(quote,{accountId:job.account_id,address:job.address,relayer,now:now(),infrastructure:infra});
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
   await db.transaction(async()=>{
   const saved=await db.prepare('SELECT phase,tx_hash FROM passkey_clone_approvals WHERE account_id=$1').get(job.account_id);
   // A fresh quote can fail while the previous unsent hash remains as evidence.
   // It is not evidence that THIS cycle broadcast; require the durable proof.
   const priorUnsent=fee&&stage==='QUOTE'&&saved?.phase==='stopped'&&await safeQuoteRetry(db,job.account_id,job.grantId);
   if(saved&&(saved.phase==='submitting'||saved.tx_hash)&&!priorUnsent&&!(fee&&error?.activationLifecycle?.outcome==='NEVER_BROADCAST'))phase='ambiguous';
   const failure=activationFailure(error,stage);
   if(stage==='QUOTE'&&failure.code==='CANONICALITY_MISMATCH')failure.details={...failure.details,lifecycle:{approvalExisted:!!saved,signingOccurred:false,sendRawEntered:false,outcome:'NEVER_BROADCAST'}};
   if(fee&&(stage==='QUOTE'||stage==='EXECUTION'&&hasUnsentActivationProof(error))
     &&failure.code==='CANONICALITY_MISMATCH'&&provenHashMismatch(error)){
    const decision=await deferQuote(db,job,now());
    if(decision){phase=decision.retry?'quote_retry_wait':'stopped';failure.details={...failure.details,retry:decision};}
   }
   await db.prepare('INSERT INTO passkey_activation_events(account_id,stage,code,details,created_at) VALUES($1,$2,$3,$4,$5)').run(job.account_id,failure.stage,failure.code,JSON.stringify(failure.details??{}),now());
   await db.prepare('UPDATE passkey_relayer_grants SET enabled=FALSE WHERE id=$1').run(job.grantId);
   await db.prepare("UPDATE passkey_clone_approvals SET approved=FALSE,phase='stopped' WHERE account_id=$1 AND phase IN ('quoted','preparing')").run(job.account_id);
   await db.prepare('UPDATE passkey_auto_activations SET phase=$1 WHERE account_id=$2').run(phase,job.account_id);
   });
   failureFinalized=true;
  }finally{
   if(!failureFinalized)await db.transaction(async()=>{
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
