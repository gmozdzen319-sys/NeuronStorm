import assert from 'node:assert/strict';
export const PRODUCTION_FEE_GRANT='fee-send-production-2200-31d-20261016';
export const PRODUCTION_FEE_BUDGET=2200n*10n**18n;
const duration=31*24*60*60*1000;
// Explicit operator setup only. Never run during login or a transaction request.
// Re-running cannot renew expiry, reset spending, or erase earlier journals.
export async function installProductionFeeGrant(db,relayer,now=Date.now()){
 relayer=relayer.toLowerCase();assert(/^0x00[0-7][0-9a-f]{37}$/.test(relayer));
 return db.transaction(async()=>{
  await db.lock('production-fee-grant-20261016');
  assert(!await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(relayer),'Unresolved relayer lane');
  assert(!await db.prepare("SELECT operation_id FROM passkey_relayer_intents WHERE relayer=$1 AND phase NOT IN ('confirmed','failed') LIMIT 1").get(relayer),'Unresolved transaction');
  assert(!await db.prepare('SELECT id FROM passkey_relayer_grants WHERE relayer=$1 AND id<>$2 AND enabled=TRUE AND expires_at>$3 LIMIT 1').get(relayer,PRODUCTION_FEE_GRANT,now),'Another live grant');
  let grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(PRODUCTION_FEE_GRANT);
  if(!grant){
   await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run(PRODUCTION_FEE_GRANT,relayer,String(PRODUCTION_FEE_BUDGET),now+duration);
   grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1').get(PRODUCTION_FEE_GRANT);
  }
  assert.equal(grant.relayer,relayer);assert.equal(BigInt(grant.budget_wei),PRODUCTION_FEE_BUDGET);assert(grant.enabled&&Number(grant.expires_at)>now,'Grant disabled or expired; new approval required');
  assert(Number(grant.expires_at)<=now+duration);assert(BigInt(grant.reserved_wei)<=PRODUCTION_FEE_BUDGET);
  return grant;
 });
}
