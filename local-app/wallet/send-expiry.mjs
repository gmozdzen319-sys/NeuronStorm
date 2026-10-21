import {releaseUnbroadcastSend} from './send-reservation.mjs';

// Only expired action-6 operations, never a network-absence heuristic.
// Durable broadcast_started=true always wins over expiry, including crashes.
export async function expireFeeSends(db,{now=Date.now(),accountId=null}={}){
 const jobs=await db.prepare(`SELECT id FROM passkey_native_operations
 WHERE phase IN ('awaiting_confirmation','verifying','authorized') AND expires_at<=$1
 AND (plan::jsonb->'operation'->>'action')='6'
 AND ($2::text IS NULL OR account_id=$2) ORDER BY expires_at LIMIT 50`).all(now,accountId);
 for(const {id} of jobs){
  const intent=await db.prepare('SELECT * FROM passkey_relayer_intents WHERE operation_id=$1').get(id);
  if(intent){
   if(intent.phase==='submitting'&&intent.broadcast_started===false)
    await releaseUnbroadcastSend(db,{id,grantId:intent.grant_id,relayer:intent.relayer,hash:intent.tx_hash});
   continue;
  }
  await db.transaction(async()=>{
   // The executor locks this same row before creating its intent. Recheck after
   // locking so a concurrent journal/broadcast cannot be classified as unsent.
   const job=await db.prepare('SELECT * FROM passkey_native_operations WHERE id=$1 FOR UPDATE').get(id);
   if(!job||!['awaiting_confirmation','verifying','authorized'].includes(job.phase)||job.expires_at>now||job.tx_hash||job.receipt)return;
   if(await db.prepare('SELECT operation_id FROM passkey_relayer_intents WHERE operation_id=$1').get(id))return;
   if(await db.prepare("SELECT reference FROM passkey_relayer_lanes WHERE reference=$1 AND purpose='send'").get(id))return;
   await db.prepare("UPDATE passkey_native_operations SET phase='stopped',receipt=$1 WHERE id=$2").run(JSON.stringify({broadcast:false,code:'CONFIRMATION_EXPIRED'}),id);
  });
 }
}
