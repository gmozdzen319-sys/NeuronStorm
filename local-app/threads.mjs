import {isBlocked,ownBlock} from './contact-preferences.mjs';
import { randomUUID } from 'node:crypto';
import {QUESTION_LIFETIME} from './lifecycle.mjs';
import {formatBalance} from './holdings.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});

async function topics(db,id){return (await db.prepare("SELECT c.id,c.name,c.kind FROM categories c JOIN question_categories qc ON qc.category_id=c.id WHERE qc.question_id=$1 ORDER BY c.kind,c.name").all(id));}
function message(value,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw fail(400,`Enter a message between 1 and ${max} characters.`);return value.trim();}
export async function requireProfile(db,account){
  if(!account)throw fail(401,'Your session has expired. Please sign in again.');
  if(!(await db.prepare("SELECT 1 FROM profiles WHERE address=$1").get(account.address.toLowerCase())))throw fail(403,'Complete your profile before joining conversations.');
}
export async function allowed(db,id,account,includeDeleted=false){
  const q=(await db.prepare("SELECT * FROM questions WHERE id=$1").get(id));
  if(!q||q.closed_at!==null||(q.deleted_at!==null&&!(includeDeleted&&account.role==='admin'))||(account.role!=='admin'&&!(await db.prepare("SELECT 1 FROM question_participants WHERE question_id=$1 AND address=$2").get(id,account.address.toLowerCase()))))throw fail(404,'This conversation was not found.');
  return q;
}
export async function previewQuestion(db,account,input){
  (await requireProfile(db,account));const body=message(input.body,4000),raw=input.categoryIds??[input.categoryId];
  if(!Array.isArray(raw)||!raw.length||raw.length>100||raw.some(id=>!Number.isSafeInteger(id)))throw fail(400,'Choose 1–100 existing topics.');
  for(const id of raw)if(!await db.prepare("SELECT 1 FROM categories WHERE id=$1").get(id))throw fail(400,'Choose existing topics.');
  const categoryIds=[...new Set(raw)];
  const recipientCount=(await db.prepare(`SELECT count(DISTINCT address) AS n FROM profile_categories WHERE category_id=ANY($1::bigint[]) AND address<>$2 AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=$2 AND b.target=profile_categories.address) OR (b.target=$2 AND b.owner=profile_categories.address))`).get(categoryIds,account.address.toLowerCase())).n;
  if(!recipientCount)throw fail(409,'No other members currently have these topics. Choose another topic.');
  return {body,categoryIds,recipientCount,topics:(await db.prepare('SELECT name FROM categories WHERE id=ANY($1::bigint[]) ORDER BY kind,name').all(categoryIds)).map(r=>r.name)};
}
export async function createQuestion(db,account,input,now){
 return db.transaction(async () => {

  (await requireProfile(db,account));
  const body=message(input.body,4000),raw=input.categoryIds??[input.categoryId],author=account.address.toLowerCase();
  if(!Array.isArray(raw)||!raw.length||raw.length>100||raw.some(id=>!Number.isSafeInteger(id)))throw fail(400,'Choose at least one existing topic (up to 100).');
  for(const id of raw)if(!await db.prepare("SELECT 1 FROM categories WHERE id=$1").get(id))throw fail(400,'Choose existing topics.');
  const categoryIds=[...new Set(raw)],categoryId=categoryIds[0];

  try{
    let recipients=(await db.prepare('SELECT DISTINCT address FROM profile_categories WHERE category_id=ANY($1::bigint[]) AND address<>$2').all(categoryIds,author));
    const visible=[];for(const r of recipients)if(!await isBlocked(db,author,r.address))visible.push(r);recipients=visible;
    if(!recipients.length)throw fail(409,'No other members currently have any of the selected topics. Your question has not been sent. Choose another topic or try again later.');
    const id=randomUUID();
    (await db.prepare("INSERT INTO questions(id,author,category_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6)").run(id,author,categoryId,body,now,now));
    for(const topicId of categoryIds)(await db.prepare("INSERT INTO question_categories VALUES($1,$2)").run(id,topicId));
    (await db.prepare("INSERT INTO question_participants VALUES($1,$2,0)").run(id,author));
    for(const r of recipients)(await db.prepare("INSERT INTO question_participants VALUES($1,$2,1)").run(id,r.address));
    for(const r of recipients)(await db.prepare("INSERT INTO notifications(address,question_id,actor,kind,revision,created_at) VALUES($1,$2,$3,'question',1,$4)").run(r.address,id,author,now));
    (await db.prepare("INSERT INTO question_reads VALUES($1,$2,1)").run(id,author));
    return {id,recipientCount:recipients.length};
  }catch(error){throw error;}

 });
}
export async function listQuestions(db,account,view){
  (await requireProfile(db,account));
  if(!['inbox','mine'].includes(view))throw fail(400,'Choose Inbox or My Questions.');
  const address=account.address.toLowerCase();
  const rows=(await db.prepare(`SELECT q.id,q.body,q.created_at AS "createdAt",q.updated_at AS "updatedAt",q.revision,p.nickname AS author,c.name AS category,c.kind AS "categoryKind",
    (SELECT count(*) FROM replies r WHERE r.question_id=q.id AND r.deleted_at IS NULL) AS "replyCount",
    COALESCE((SELECT revision FROM question_reads qr WHERE qr.question_id=q.id AND qr.address=$1),0) AS "readRevision"
    FROM questions q JOIN profiles p ON p.address=q.author JOIN categories c ON c.id=q.category_id
    WHERE q.deleted_at IS NULL AND q.closed_at IS NULL AND (${view==='mine'?'q.author=$2':account.role==='admin'?'1=1':'EXISTS(SELECT 1 FROM question_participants qp WHERE qp.question_id=q.id AND qp.address=$2 AND qp.is_recipient=1)'}) ORDER BY q.updated_at DESC,q.id`).all(...(view==='inbox'&&account.role==='admin'?[address]:[address,address])));
  return (await Promise.all(rows.map(async ({body,revision,readRevision,...row})=>({...row,expiresAt:row.createdAt+QUESTION_LIFETIME,categories:(await topics(db,row.id)),searchText:body,title:body.split('\n')[0].slice(0,110),excerpt:body.slice(0,220),unread:revision>readRevision}))));
}
export async function readThread(db,account,id,includeDeleted=false){
  (await requireProfile(db,account));const q=(await allowed(db,id,account,includeDeleted));
  const category=(await db.prepare("SELECT name,kind FROM categories WHERE id=$1").get(q.category_id));
  const author=(await db.prepare("SELECT nickname FROM profiles WHERE address=$1").get(q.author)).nickname;
  const readRevision=(await db.prepare("SELECT revision FROM question_reads WHERE question_id=$1 AND address=$2").get(id,account.address.toLowerCase()))?.revision||0;
  const replies=(await db.prepare(`SELECT r.posted_revision AS "postedRevision",r.id,r.body,r.created_at AS "createdAt",r.edited_at AS "editedAt",r.version,r.author AS "walletAddress",p.nickname AS author,
    (SELECT count(*) FROM reply_votes v WHERE v.reply_id=r.id AND v.value=1) AS upvotes,
    (SELECT count(*) FROM reply_votes v WHERE v.reply_id=r.id AND v.value=-1) AS downvotes,
    COALESCE((SELECT value FROM reply_votes v WHERE v.reply_id=r.id AND v.voter=$1),0) AS "myVote",
    (r.author<>$2)::int AS "canVote"
    FROM replies r JOIN profiles p ON p.address=r.author WHERE r.question_id=$3 AND r.deleted_at IS NULL ORDER BY upvotes DESC,r.id`).all(account.address.toLowerCase(),account.address.toLowerCase(),id));
  const tips=new Map();
  for(const payment of (await db.prepare("SELECT p.reply_id,p.units FROM payment_intents p JOIN replies r ON r.id=p.reply_id WHERE r.question_id=$1 AND p.action='tip' AND p.completed_at IS NOT NULL").all(id))){
    const total=tips.get(payment.reply_id)||{units:0n,count:0};total.units+=BigInt(payment.units);total.count++;tips.set(payment.reply_id,total);
  }
  for(const reply of replies){reply.blockId=(await ownBlock(db,account.address.toLowerCase(),reply.walletAddress));reply.canBlock=reply.walletAddress!==account.address.toLowerCase();reply.savedVersion=(await db.prepare("SELECT version FROM saved_answers WHERE owner=$1 AND reply_id=$2").get(account.address.toLowerCase(),reply.id))?.version||null;const total=tips.get(reply.id)||{units:0n,count:0};reply.unread=reply.postedRevision>readRevision&&Boolean(reply.canVote);delete reply.postedRevision;reply.tipUnits=String(total.units);reply.tipTotal=formatBalance(String(total.units),18);reply.tipCount=total.count;}
  return {canSaveAnswers:q.author===account.address.toLowerCase(),contactBlocked:(await isBlocked(db,account.address.toLowerCase(),q.author)),canBlock:q.author!==account.address.toLowerCase(),blockId:(await ownBlock(db,account.address.toLowerCase(),q.author)),unread:readRevision===0&&q.author!==account.address.toLowerCase(),expiresAt:q.created_at+QUESTION_LIFETIME,canAccept:q.author===account.address.toLowerCase(),canReply:!(await isBlocked(db,account.address.toLowerCase(),q.author))&&!(await db.prepare("SELECT 1 FROM answer_slots WHERE question_id=$1 AND author=$2").get(id,account.address.toLowerCase())),id,body:q.body,author,deletedAt:q.deleted_at,categories:(await topics(db,id)),category:category.name,categoryKind:category.kind,createdAt:q.created_at,revision:q.revision,replies:replies.map(({walletAddress,...r})=>account.role==='admin'?{...r,walletAddress}:r),recipientCount:(await db.prepare("SELECT count(*) AS n FROM question_participants WHERE question_id=$1 AND is_recipient=1").get(id)).n};
}
export async function voteOnReply(db,account,id,replyId,input,now=Date.now()){
 return db.transaction(async () => {
 await db.lock("question:"+id);

  (await requireProfile(db,account));const question=(await allowed(db,id,account));if(question.created_at+QUESTION_LIFETIME<=now)throw fail(409,'This conversation has expired.');
  const reply=(await db.prepare("SELECT author FROM replies WHERE id=$1 AND question_id=$2 AND deleted_at IS NULL").get(replyId,id));
  if(!reply)throw fail(404,'This reply was not found.');
  const voter=account.address.toLowerCase();
  if(reply.author===voter)throw fail(403,'You cannot rate your own reply.');
  if(![1,-1,0].includes(input.value))throw fail(400,'Choose an upvote, a downvote or remove your vote.');
  if(input.value===0)(await db.prepare("DELETE FROM reply_votes WHERE reply_id=$1 AND voter=$2").run(replyId,voter));
  else (await db.prepare("INSERT INTO reply_votes(reply_id,voter,value,awarded_at) VALUES($1,$2,$3,$4) ON CONFLICT(reply_id,voter) DO UPDATE SET value=excluded.value,awarded_at=CASE WHEN reply_votes.value=excluded.value THEN reply_votes.awarded_at ELSE excluded.awarded_at END").run(replyId,voter,input.value,now));
  return {ok:true};

 });
}
export async function replyToThread(db,account,id,input,now){
 return db.transaction(async () => {
 await db.lock("question:"+id);

  (await requireProfile(db,account));const question=(await allowed(db,id,account));if(question.created_at+QUESTION_LIFETIME<=now)throw fail(409,'This conversation has expired.');if((await isBlocked(db,account.address.toLowerCase(),question.author)))throw fail(403,'Replies between these accounts are blocked.');const body=message(input.body,2000);

  try{if((await db.prepare("SELECT 1 FROM answer_slots WHERE question_id=$1 AND author=$2").get(id,account.address.toLowerCase())))throw fail(409,'You can post only one answer to this question. Use Debate for discussion.');(await db.prepare("INSERT INTO answer_slots VALUES($1,$2)").run(id,account.address.toLowerCase()));(await db.prepare("INSERT INTO replies(question_id,author,body,created_at,posted_revision) VALUES($1,$2,$3,$4,$5)").run(id,account.address.toLowerCase(),body,now,question.revision+1));(await db.prepare("UPDATE questions SET revision=revision+1,updated_at=$1 WHERE id=$2").run(now,id));(await db.prepare("INSERT INTO notifications(address,question_id,actor,kind,revision,created_at) SELECT qp.address,q.id,$1,'reply',q.revision,$2 FROM question_participants qp JOIN questions q ON q.id=qp.question_id WHERE q.id=$3 AND qp.address<>$4 AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=qp.address AND b.target=$5) OR (b.target=qp.address AND b.owner=$6))").run(account.address.toLowerCase(),now,id,account.address.toLowerCase(),account.address.toLowerCase(),account.address.toLowerCase()));return {ok:true};}catch(error){throw error;}

 });
}
export async function markThreadRead(db,account,id,input){
 return db.transaction(async () => {
 await db.lock("question:"+id);

  (await requireProfile(db,account));const q=(await allowed(db,id,account));
  if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>q.revision)throw fail(400,'Invalid conversation revision.');
  (await db.prepare("INSERT INTO question_reads VALUES($1,$2,$3) ON CONFLICT(question_id,address) DO UPDATE SET revision=GREATEST(question_reads.revision,excluded.revision)").run(id,account.address.toLowerCase(),input.revision));
  (await db.prepare("UPDATE notifications SET read_at=COALESCE(read_at,$1) WHERE address=$2 AND question_id=$3 AND revision<=$4").run(Date.now(),account.address.toLowerCase(),id,input.revision));
  (await db.prepare("UPDATE deadline_reminders SET read_at=COALESCE(read_at,$1) WHERE address=$2 AND question_id=$3").run(Date.now(),account.address.toLowerCase(),id));
  return {ok:true};

 });
}
