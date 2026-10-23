// Verification is separate from reputation. Only this Debate vote path awards it.
export const VERIFICATION_WAIT=48*60*60*1000;
const fail=(status,message)=>Object.assign(Error(message),{status});
export async function registerVerificationFields(db,address,now){
 await db.prepare(`INSERT INTO verification_fields(normalized_name,name)
 SELECT c.normalized_name,min(c.name) FROM profile_categories pc JOIN categories c ON c.id=pc.category_id
 WHERE pc.address=$1 GROUP BY c.normalized_name ON CONFLICT(normalized_name) DO NOTHING`).run(address);
 await db.prepare(`INSERT INTO verification_memberships(address,field_id,first_seen,date_source)
 SELECT DISTINCT pc.address,f.id,$2::bigint,'registered' FROM profile_categories pc JOIN categories c ON c.id=pc.category_id
 JOIN verification_fields f USING(normalized_name) WHERE pc.address=$1 ON CONFLICT DO NOTHING`).run(address,now);
}
export async function debateFields(db,id){
 return db.prepare(`SELECT DISTINCT f.id,f.name FROM question_categories qc JOIN categories c ON c.id=qc.category_id
 JOIN verification_fields f USING(normalized_name) WHERE qc.question_id=$1 ORDER BY f.name,f.id`).all(id);
}
export async function activeField(db,address,field){
 return !!await db.prepare(`SELECT 1 FROM profile_categories pc JOIN categories c ON c.id=pc.category_id
 JOIN verification_fields f USING(normalized_name) WHERE pc.address=$1 AND f.id=$2`).get(address,field);
}
export async function verificationFields(db,address,now,{admin=false}={}){
 return (await verificationForAccounts(db,[address],now,{admin})).get(address)||[];
}
export async function verificationForAccounts(db,addresses,now,{admin=false}={}){
 if(!addresses.length)return new Map();
 const rows=await db.prepare(`SELECT m.address,f.id,f.name,m.first_seen AS "firstSeen",m.date_source AS "dateSource",m.achieved_at AS "achievedAt",
 EXISTS(SELECT 1 FROM profile_categories pc JOIN categories c ON c.id=pc.category_id WHERE pc.address=m.address AND c.normalized_name=f.normalized_name) AS active,
 count(v.message_id) FILTER(WHERE v.counted AND v.value=1) AS positive,
 count(v.message_id) FILTER(WHERE v.counted AND v.value=-1) AS negative
 FROM verification_memberships m JOIN verification_fields f ON f.id=m.field_id
 LEFT JOIN verification_votes v ON v.recipient=m.address AND v.field_id=f.id
 WHERE m.address=ANY($1::text[]) GROUP BY f.id,m.address,m.field_id ORDER BY f.name,f.id`).all(addresses);
 const result=new Map();for(const r of rows.filter(r=>admin||r.active)){const net=r.positive-r.negative,percent=Math.max(0,Math.min(100,Math.round(net*10000/30)/100));
  if(!result.has(r.address))result.set(r.address,[]);
  result.get(r.address).push({id:r.id,name:r.name,net,positive:r.positive,negative:r.negative,percent,verified:net>=30,...(admin?{active:r.active,firstSeen:r.firstSeen,dateSource:r.dateSource,achievedAt:r.achievedAt,waitingUntil:r.firstSeen+VERIFICATION_WAIT,waiting:now<r.firstSeen+VERIFICATION_WAIT}:{})});
 }return result;
}
export async function recordVerificationVote(db,account,qid,messageId,value,now){
 const m=await db.prepare(`SELECT m.author,c.field_id FROM debate_messages m JOIN verification_contributions c ON c.message_id=m.id WHERE m.id=$1 AND m.question_id=$2`).get(messageId,qid);
 if(!m?.field_id)return; // Legacy and follow-up contributions never earn verification.
 const voter=account.address.toLowerCase();
 // Coordinate profile edits and independent debates awarding the same recipient.
 for(const address of [voter,m.author].sort())await db.lock('profile:'+address);
 const previous=await db.prepare('SELECT * FROM verification_votes WHERE message_id=$1 AND voter=$2').get(messageId,voter);
 if(value!==0&&!await activeField(db,voter,m.field_id))throw fail(403,'Only members with this topic can rate this contribution.');
 if(previous?.value===value||!previous&&!value)return;
 const membership=await db.prepare('SELECT first_seen FROM verification_memberships WHERE address=$1 AND field_id=$2').get(voter,m.field_id);
 const mature=!!membership&&now>=membership.first_seen+VERIFICATION_WAIT;
 const recipientActive=await activeField(db,m.author,m.field_id);
 const counted=value!==0&&mature&&recipientActive;
 const reason=!value?'removed':!mature?'waiting':!recipientActive?'recipient_inactive':'eligible';
 await db.prepare(`INSERT INTO verification_votes(message_id,voter,recipient,field_id,value,counted,cast_at) VALUES($1,$2,$3,$4,$5,$6,$7)
 ON CONFLICT(message_id,voter) DO UPDATE SET value=excluded.value,counted=excluded.counted,cast_at=excluded.cast_at`).run(messageId,voter,m.author,m.field_id,value,counted,now);
 await db.prepare(`INSERT INTO verification_events(message_id,question_id,voter,recipient,field_id,previous_value,value,previous_counted,counted,reason,occurred_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`).run(messageId,qid,voter,m.author,m.field_id,previous?.value||0,value,previous?.counted||false,counted,reason,now);
 await db.prepare(`UPDATE verification_memberships SET achieved_at=$3 WHERE address=$1 AND field_id=$2 AND achieved_at IS NULL
 AND (SELECT COALESCE(sum(value) FILTER(WHERE counted),0) FROM verification_votes WHERE recipient=$1 AND field_id=$2)>=30`).run(m.author,m.field_id,now);
}
