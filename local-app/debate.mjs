import {isBlocked} from './contact-preferences.mjs';
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
  if(input){
    if((await isBlocked(db,address,question.author)))throw fail(403,'Messages between these accounts are blocked.');
    if(typeof input.body!=='string'||!input.body.trim()||input.body.trim().length>2000||typeof input.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(input.clientId))throw fail(400,'Enter a debate message between 1 and 2,000 characters.');
    const existing=(await db.prepare("SELECT body FROM debate_messages WHERE question_id=$1 AND author=$2 AND client_id=$3").get(id,address,input.clientId));
    if(existing&&existing.body!==input.body.trim())throw fail(409,'This message request was already used.');
    (await db.prepare("INSERT INTO debate_messages(question_id,author,body,client_id,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").run(id,address,input.body.trim(),input.clientId,now));
  }
  const before=Number(params.get('before')||0),after=Number(params.get('after')||0);
  if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after)||after<0)throw fail(400,'Invalid debate page.');
  (await db.prepare("DELETE FROM debate_presence WHERE seen<$1").run(now-25000));
  if(params.get('presence')==='1'||input)(await db.prepare("INSERT INTO debate_presence VALUES($1,$2,$3,$4) ON CONFLICT(question_id,address,session_hash) DO UPDATE SET seen=excluded.seen").run(id,address,session,now));
  const messages=(await db.prepare(`SELECT m.id,m.body,m.created_at AS "createdAt",p.nickname AS author,(m.author=$1)::int AS mine FROM debate_messages m JOIN profiles p ON p.address=m.author WHERE m.question_id=$2 AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=$3 AND b.target=m.author) OR (b.target=$4 AND b.owner=m.author)) ${before?'AND m.id<$5':after?'AND m.id>$5':''} ORDER BY m.id ${after?'ASC':'DESC'} LIMIT 50`).all(address,...(before||after?[id,address,address,before||after]:[id,address,address])));
  if(!after)messages.reverse();
  const onlineRows=(await db.prepare("SELECT DISTINCT p.address,p.nickname FROM debate_presence d JOIN profiles p ON p.address=d.address JOIN sessions s ON s.token_hash=d.session_hash AND s.expires>$1 WHERE d.question_id=$2 AND d.seen>$3 ORDER BY p.nickname").all(now,id,now-25000));
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
  return {ratings,canPost:!(await isBlocked(db,address,question.author)),messages,online,hasEarlier:!!oldest&&!!(await db.prepare("SELECT 1 FROM debate_messages WHERE question_id=$1 AND id<$2 LIMIT 1").get(id,oldest))};

 });
}
