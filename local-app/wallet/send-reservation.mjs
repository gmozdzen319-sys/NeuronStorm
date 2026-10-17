import assert from 'node:assert/strict';

// Called only on a known exception BEFORE invoking sendRaw. No RPC absence
// heuristic, automatic retry, signed-byte persistence, or ambiguous release.
export async function releaseUnbroadcastSend(db,{id,grantId,relayer,hash}){
 return db.transaction(async()=>{
  const grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(grantId);
  const intent=await db.prepare('SELECT * FROM passkey_relayer_intents WHERE operation_id=$1 FOR UPDATE').get(id);
  assert(intent&&intent.grant_id===grantId&&intent.relayer===relayer&&intent.tx_hash===hash);
  assert.equal(intent.broadcast_started,false,'Broadcast may have started; reservation retained');
  if(intent.phase==='failed')return false; // already released; never double-credit
  assert.equal(intent.phase,'submitting');
  const operation=await db.prepare('SELECT * FROM passkey_native_operations WHERE id=$1 FOR UPDATE').get(id);
  assert(operation&&['authorized','submitting'].includes(operation.phase)&&!operation.receipt);
  const lane=await db.prepare('SELECT * FROM passkey_relayer_lanes WHERE relayer=$1 FOR UPDATE').get(relayer);
  assert(lane&&lane.reference===id&&lane.purpose==='send');
  const reserve=BigInt(intent.maximum_fee_wei);assert(reserve>0n&&BigInt(grant.reserved_wei)>=reserve);
  await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei-$1 WHERE id=$2').run(String(reserve),grantId);
  await db.prepare("UPDATE passkey_relayer_intents SET phase='failed' WHERE operation_id=$1").run(id);
  await db.prepare("UPDATE passkey_native_operations SET phase='stopped',tx_hash=NULL,receipt=$1 WHERE id=$2").run(JSON.stringify({broadcast:false,code:'STOPPED_BEFORE_BROADCAST'}),id);
  await db.prepare('DELETE FROM passkey_relayer_lanes WHERE relayer=$1 AND reference=$2').run(relayer,id);
  return true;
 });
}
