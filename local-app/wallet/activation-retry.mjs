import assert from 'node:assert/strict';
export const RETRY_WINDOW=600000,RETRY_DELAYS=[30000,120000],MAX_QUOTE_FAILURES=3;
export function provenHashMismatch(error){
 const e=error?.canonicalityEvidence,h=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/i.test(v);
 return error?.code==='ERR_ASSERTION'&&typeof e?.requestedHeight==='string'&&/^0x[0-9a-f]{1,64}$/i.test(e.requestedHeight)&&h(e.expected?.hash)&&h(e.observed?.hash)&&e.expected.hash!==e.observed.hash;
}

// Called under the activation transaction/lock. No prior authorization may be recycled.
export async function safeQuoteRetry(db,accountId,grantId){
 const approval=await db.prepare('SELECT account_id FROM passkey_fee_approvals WHERE account_id=$1').get(accountId);
 const history=await db.prepare('SELECT id FROM passkey_fee_approval_history WHERE account_id=$1 LIMIT 1').get(accountId);
 const lane=await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE reference=$1').get(accountId);
 const grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(grantId);
 return !approval&&!history&&!lane&&grant&&!grant.enabled&&BigInt(grant.reserved_wei)===0n;
}
export async function deferQuote(db,job,now){
 if(!await safeQuoteRetry(db,job.account_id,job.grantId))return null;
 const prior=await db.prepare('SELECT * FROM passkey_fee_quote_retries WHERE account_id=$1 FOR UPDATE').get(job.account_id);
 const failures=(prior?.failures??0)+1,first=Number(prior?.first_failure_at??now);
 assert(failures<=MAX_QUOTE_FAILURES);
 const retry=failures<MAX_QUOTE_FAILURES&&now-first<RETRY_WINDOW;
 const next=retry?now+RETRY_DELAYS[failures-1]:now;
 await db.prepare('INSERT INTO passkey_fee_quote_retries VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET failures=excluded.failures,next_attempt_at=excluded.next_attempt_at').run(job.account_id,failures,first,next);
 return {failures,firstFailureAt:first,nextAttemptAt:next,retry};
}
export async function claimQuoteRetry(db,relayer,infra,now){
 const row=await db.prepare(`SELECT j.*,w.address,r.failures,r.first_failure_at FROM passkey_fee_auto_activations j
 JOIN passkey_fee_quote_retries r USING(account_id) JOIN passkey_fee_wallets w USING(account_id)
 JOIN passkey_accounts a ON a.id=w.account_id JOIN passkey_credentials c ON c.id=w.credential_id AND c.account_id=w.account_id
 WHERE j.relayer=$1 AND j.phase='quote_retry_wait' AND r.next_attempt_at<=$2
 AND a.rp_id=$3 AND a.origin=$4 AND c.revoked_at IS NULL
 ORDER BY r.next_attempt_at,j.account_id LIMIT 1 FOR UPDATE OF j`).get(relayer,now,infra.rpID,infra.origin);
 if(!row)return null;
 if(row.failures>=MAX_QUOTE_FAILURES||now-Number(row.first_failure_at)>=RETRY_WINDOW||!await safeQuoteRetry(db,row.account_id,row.grant_id)){
  await db.prepare("UPDATE passkey_fee_auto_activations SET phase='stopped' WHERE account_id=$1").run(row.account_id);
  await db.prepare('INSERT INTO passkey_fee_activation_events(account_id,stage,code,details,created_at) VALUES($1,$2,$3,$4,$5)').run(row.account_id,'QUOTE','RETRY_INELIGIBLE',JSON.stringify({failures:row.failures}),now);
  return null;
 }
 await db.prepare('UPDATE passkey_relayer_grants SET expires_at=$1 WHERE id=$2 AND enabled=FALSE AND reserved_wei=0').run(now+300000,row.grant_id);
 await db.prepare("UPDATE passkey_fee_auto_activations SET phase='running' WHERE account_id=$1 AND phase='quote_retry_wait'").run(row.account_id);
 return {account_id:row.account_id,address:row.address,grantId:row.grant_id};
}
