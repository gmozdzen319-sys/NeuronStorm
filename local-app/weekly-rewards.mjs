import {randomUUID} from 'node:crypto';
export const WEEKLY_NS=[300,200,150,80,70,60,50,40,30,20];
export const rewardUnits=rank=>rank>=1&&rank<=10?String(BigInt(WEEKLY_NS[rank-1])*10n**18n):null;
// Same rank() and score ledger as the existing ranking, including full shared-rank awards.
export async function freezeWeeklyRewards(db,now){
 const due=await db.prepare(`SELECT r.round_id,r.end_time FROM weekly_rounds r,weekly_reward_policy p WHERE r.end_time<=$1 AND r.round_id>=p.first_round AND NOT EXISTS(SELECT 1 FROM weekly_reward_snapshots s WHERE s.round_id=r.round_id) ORDER BY r.round_id`).all(now);
 for(const round of due)await db.transaction(async()=>{
  await db.lock('weekly-rewards:'+round.round_id);
  if(await db.prepare('SELECT 1 FROM weekly_reward_snapshots WHERE round_id=$1').get(round.round_id))return;
  // Wait for in-flight score writes before capturing one consistent ledger snapshot.
  await db.exec('LOCK TABLE reputation_events IN SHARE MODE');
  const rows=await db.prepare(`WITH scores AS(SELECT recipient,sum(units)::bigint AS score FROM reputation_events WHERE round_id=$1 GROUP BY recipient), ranked AS(SELECT *,rank() OVER(ORDER BY score DESC) AS position FROM scores)
   SELECT s.*,p.nickname FROM ranked s JOIN profiles p ON p.address=s.recipient WHERE position<=10 ORDER BY position,s.recipient`).all(round.round_id);
  await db.prepare('INSERT INTO weekly_reward_snapshots(round_id,captured_at,payable_at) VALUES($1,$2,$3)').run(round.round_id,now,round.end_time+86400000);
  for(const row of rows){
   const links=await db.prepare('SELECT account_id FROM passkey_community_accounts WHERE address=$1').all(row.recipient);
   let wallet=row.recipient;
   if(links.length){
    wallet=null;
    if(links.length===1){const w=await db.prepare(`SELECT w.address FROM passkey_fee_wallets w JOIN passkey_fee_approvals a ON a.account_id=w.account_id WHERE w.account_id=$1 AND a.phase='confirmed'`).get(links[0].account_id);wallet=w?.address??null;}
   }
   if(!/^0x00[0-9a-f]{38}$/i.test(wallet||''))wallet=null;
   await db.prepare('INSERT INTO weekly_rewards(id,round_id,member,nickname,recipient,final_rank,weekly_units,units) VALUES($1,$2,$3,$4,$5,$6,$7,$8)').run(randomUUID(),round.round_id,row.recipient,row.nickname,wallet?.toLowerCase()??null,row.position,row.score,rewardUnits(row.position));
  }
 });
}
export async function weeklyRewardRows(db,round){return db.prepare(`SELECT w.*,(SELECT min(e.id) FROM reputation_events e WHERE e.recipient=w.member) AS profile_ref,a.id AS attempt_id,a.status AS attempt_status,a.tx_hash AS attempt_hash FROM weekly_rewards w LEFT JOIN LATERAL(SELECT * FROM weekly_reward_attempts a WHERE a.reward_id=w.id ORDER BY created_at DESC,id DESC LIMIT 1)a ON TRUE WHERE w.round_id=$1 ORDER BY w.final_rank,w.member`).all(round);}
