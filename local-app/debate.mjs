import {isBlocked} from './contact-preferences.mjs';
import {debateFields,verificationForAccounts,recordVerificationVote} from './verification.mjs';
import {QUESTION_LIFETIME} from './lifecycle.mjs';
import {requireProfile,allowed} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});

export async function voteOnDebate(db,account,id,messageId,input,now){
 return db.transaction(async()=>{
  await db.lock('question:'+id);await requireProfile(db,account);
  const q=await allowed(db,id,account);
  if(q.created_at+QUESTION_LIFETIME<=now)throw fail(409,'This conversation has expired.');
  const m=await db.prepare('SELECT author FROM debate_messages WHERE id=$1 AND question_id=$2').get(messageId,id);
  if(!m)throw fail(404,'This message was not found.');
  const voter=account.address.toLowerCase();
  if(voter===m.author)throw fail(403,'You cannot rate your own message.');
  if(await isBlocked(db,voter,m.author))throw fail(403,'Ratings between these accounts are blocked.');
  if(![1,-1,0].includes(input.value))throw fail(400,'Choose Helpful, Not Helpful or remove your vote.');
  await recordVerificationVote(db,account,id,messageId,input.value,now);
  await db.query("SELECT set_config('neuron.event_time',$1,true)",[String(now)]);
  if(!input.value)await db.prepare('DELETE FROM debate_votes WHERE message_id=$1 AND voter=$2').run(messageId,voter);
  else await db.prepare(`INSERT INTO debate_votes VALUES($1,$2,$3,$4) ON CONFLICT(message_id,voter)
   DO UPDATE SET value=excluded.value,awarded_at=CASE WHEN debate_votes.value=excluded.value THEN debate_votes.awarded_at ELSE excluded.awarded_at END`).run(messageId,voter,input.value,now);
  return {ok:true};
 });
}

export async function debate(db,account,id,session,params,input,now){
 return db.transaction(async () => {
 await db.lock("question:"+id);

  (await requireProfile(db,account));const question=(await allowed(db,id,account));if(question.created_at+QUESTION_LIFETIME<=now)throw fail(409,'This conversation has expired.');const address=account.address.toLowerCase();
  if(input)await db.lock('profile:'+address);
  const fields=await debateFields(db,id);
  const selectable=await db.prepare(`SELECT DISTINCT f.id FROM profile_categories pc JOIN categories c ON c.id=pc.category_id JOIN verification_fields f USING(normalized_name) WHERE pc.address=$1`).all(address);
  const eligibleFields=new Set(selectable.map(f=>f.id)),availableFields=fields.filter(f=>eligibleFields.has(f.id));
  if(input){
    if((await isBlocked(db,address,question.author)))throw fail(403,'Messages between these accounts are blocked.');
    if(typeof input.body!=='string'||!input.body.trim()||input.body.trim().length>2000||typeof input.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(input.clientId))throw fail(400,'Enter a debate message between 1 and 2,000 characters.');
    const followUp=!availableFields.length&&address===question.author;
    if(!availableFields.length&&!followUp)throw fail(403,'A topic from this debate must be present in your profile.');
    const field=followUp?null:Number(input.fieldId??availableFields[0]?.id),kind=followUp?'follow_up':'field';
    if(followUp&&input.fieldId!=null&&input.fieldId!==0)throw fail(403,'Follow-up questions do not select a verification topic.');
    if(!followUp&&(!Number.isSafeInteger(field)||!fields.some(f=>f.id===field)))throw fail(400,'Choose a topic belonging to this debate.');
    if(!followUp&&!eligibleFields.has(field))throw fail(403,'Choose a debate topic from your profile.');
    const existing=(await db.prepare("SELECT m.id,m.body,c.field_id,c.kind FROM debate_messages m LEFT JOIN verification_contributions c ON c.message_id=m.id WHERE question_id=$1 AND author=$2 AND client_id=$3").get(id,address,input.clientId));
    if(existing&&existing.body!==input.body.trim())throw fail(409,'This message request was already used.');
    if(existing?.kind&&(existing.field_id!==field||existing.kind!==kind))throw fail(409,'This contribution already belongs to another topic.');
    (await db.prepare("INSERT INTO debate_messages(question_id,author,body,client_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").run(id,address,input.body.trim(),input.clientId,now));
    if(!existing)await db.prepare(`INSERT INTO verification_contributions(message_id,field_id,kind) SELECT id,$4::bigint,$5::text FROM debate_messages WHERE question_id=$1 AND author=$2 AND client_id=$3`).run(id,address,input.clientId,field,kind);
  }
  const before=Number(params.get('before')||0),after=Number(params.get('after')||0);
  if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after)||after<0)throw fail(400,'Invalid debate page.');
  (await db.prepare("DELETE FROM debate_presence WHERE seen<$1").run(now-25000));
  if(params.get('presence')==='1'||input)(await db.prepare("INSERT INTO debate_presence VALUES($1,$2,$3,$4) ON CONFLICT(question_id,address,session_hash) DO UPDATE SET seen=excluded.seen").run(id,address,session,now));
  const messages=(await db.prepare(`SELECT m.id,m.body,m.created_at AS "createdAt",p.nickname AS author,(SELECT json_build_object('id',l.file_id) FROM content_file_links l WHERE l.avatar_owner=p.address) AS avatar,(m.author=$1)::int AS mine FROM debate_messages m JOIN profiles p ON p.address=m.author WHERE m.question_id=$2 AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=$3 AND b.target=m.author) OR (b.target=$4 AND b.owner=m.author)) ${before?'AND m.id<$5':after?'AND m.id>$5':''} ORDER BY m.id ${after?'ASC':'DESC'} LIMIT 50`).all(address,...(before||after?[id,address,address,before||after]:[id,address,address])));
  if(!after)messages.reverse();
  const onlineRows=(await db.prepare(`SELECT DISTINCT p.address,p.nickname FROM debate_presence d JOIN profiles p ON p.address=d.address
   WHERE d.question_id=$2 AND d.seen>$3 AND (
    EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=d.session_hash AND s.address=d.address AND s.expires>$1)
    OR EXISTS(SELECT 1 FROM passkey_sessions s JOIN passkey_credentials c ON c.id=s.credential_id AND c.account_id=s.account_id
      JOIN passkey_community_accounts a ON a.account_id=s.account_id
      WHERE s.token_hash=d.session_hash AND s.expires>$1 AND c.revoked_at IS NULL AND a.address=d.address)
   ) ORDER BY p.nickname`).all(now,id,now-25000));
  const online=[];for(const p of onlineRows)if(!await isBlocked(db,address,p.address))online.push(p.nickname);
  const oldest=messages[0]?.id;
  const requested=(params.get('ratings')||'').split(',').filter(Boolean).map(Number);
  if(requested.length>200||requested.some(n=>!Number.isSafeInteger(n)||n<1))throw fail(400,'Invalid rating page.');
  const ids=[...new Set([...requested,...messages.map(m=>m.id)])];
  const ratings=ids.length?await db.prepare(`SELECT m.id,(m.author=$2)::int AS mine,
   (SELECT count(*) FROM debate_votes WHERE message_id=m.id AND value=1) AS upvotes,
   (SELECT count(*) FROM debate_votes WHERE message_id=m.id AND value=-1) AS downvotes,
   COALESCE((SELECT value FROM debate_votes WHERE message_id=m.id AND voter=$2),0) AS "myVote"
   FROM debate_messages m WHERE m.question_id=$1 AND m.id=ANY($3::bigint[])
   AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=$2 AND b.target=m.author) OR (b.target=$2 AND b.owner=m.author))`).all(id,address,ids):[];
  const byId=new Map(ratings.map(r=>[r.id,r]));for(const m of messages)Object.assign(m,byId.get(m.id));
  const contributions=ids.length?await db.prepare('SELECT m.id,m.author,c.field_id,c.kind FROM debate_messages m LEFT JOIN verification_contributions c ON c.message_id=m.id WHERE m.question_id=$1 AND m.id=ANY($2::bigint[])').all(id,ids):[];
  const scores=await verificationForAccounts(db,[...new Set([address,...contributions.map(c=>c.author)])],now),ownFields=new Set((scores.get(address)||[]).map(f=>f.id));
  const contributionById=new Map(contributions.map(c=>[c.id,c]));
  for(const r of ratings){
   const contribution=contributionById.get(r.id);
   r.canVote=!r.mine&&(!contribution.field_id||ownFields.has(contribution.field_id));
   r.verification=(scores.get(contribution.author)||[]).find(f=>f.id===contribution.field_id)||null;
   r.followUp=contribution.kind==='follow_up';
   const message=messages.find(m=>m.id===r.id);if(message)Object.assign(message,{canVote:r.canVote,verification:r.verification,followUp:r.followUp});
  }
  return {fields:availableFields,followUp:!availableFields.length&&address===question.author,ratings,canPost:(availableFields.length>0||address===question.author)&&!(await isBlocked(db,address,question.author)),messages,online,hasEarlier:!!oldest&&!!(await db.prepare("SELECT 1 FROM debate_messages WHERE question_id=$1 AND id<$2 LIMIT 1").get(id,oldest))};

 });
}
