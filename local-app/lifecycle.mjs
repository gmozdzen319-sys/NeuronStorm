export const QUESTION_LIFETIME=7*24*60*60*1000;
const fail=(status,message)=>Object.assign(new Error(message),{status});

export async function acceptanceCandidate(db,account,questionId,replyId,version,now){
  const q=(await db.prepare("SELECT * FROM questions WHERE id=$1").get(questionId));
  if(!q||q.deleted_at!==null||q.closed_at!==null)throw fail(404,'This conversation is closed or unavailable.');
  if(q.created_at+QUESTION_LIFETIME<=now)throw fail(409,'The 7-day deadline has passed. This conversation is closing.');
  if(q.author!==account.address.toLowerCase())throw fail(403,'Only the person who asked this question can accept an answer.');
  const r=Number.isSafeInteger(replyId)&&(await db.prepare("SELECT * FROM replies WHERE id=$1 AND question_id=$2 AND deleted_at IS NULL").get(replyId,questionId));
  if(!r)throw fail(404,'This answer is no longer available.');
  if(r.author===q.author)throw fail(403,'You cannot accept your own answer.');
  if(r.version!==version)throw fail(409,'This answer changed. Review it again before accepting.');
  return {q,r};
}
async function close(db,q,r,selection,now){
  const nickname=async address=>(await db.prepare("SELECT nickname FROM profiles WHERE address=$1").get(address))?.nickname||'Member';
  const votes=r?(await db.prepare("SELECT count(*) AS n FROM reply_votes WHERE reply_id=$1 AND value=1").get(r.id)).n:0;
  (await db.prepare("INSERT INTO accepted_answers VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)").run(q.id,r?.id??null,q.body,r?.body??null,q.author,r?.author??null,(await nickname(q.author)),r?(await nickname(r.author)):null,votes,selection,now));
  (await db.prepare("UPDATE questions SET closed_at=$1,revision=revision+1 WHERE id=$2").run(now,q.id));
  (await db.prepare("UPDATE notifications SET read_at=COALESCE(read_at,$1) WHERE question_id=$2").run(now,q.id));
}
export async function acceptAnswer(db,account,questionId,input,now){
 return db.transaction(async () => {
 await db.lock("question:"+questionId);


  try{const {q,r}=(await acceptanceCandidate(db,account,questionId,input.replyId,input.version,now));
    (await close(db,q,r,'author',now));return {ok:true,closed:true};
  }catch(error){throw error;}

 });
}
export async function expireQuestions(db,now){
 const candidates=await db.prepare('SELECT id FROM questions WHERE closed_at IS NULL AND created_at<=$1 ORDER BY id').all(now-QUESTION_LIFETIME);
 let total=0;
 for(const {id} of candidates)total+=await db.transaction(async()=>{
   await db.lock('question:'+id);
   const q=await db.prepare('SELECT * FROM questions WHERE id=$1 AND closed_at IS NULL AND created_at<=$2').get(id,now-QUESTION_LIFETIME);
   if(!q)return 0;
   const r=q.deleted_at===null?await db.prepare('SELECT r.*,(SELECT count(*) FROM reply_votes v WHERE v.reply_id=r.id AND v.value=1) AS votes FROM replies r WHERE r.question_id=$1 AND r.deleted_at IS NULL AND r.author<>$2 ORDER BY votes DESC,r.created_at,r.id LIMIT 1').get(q.id,q.author):null;
   await close(db,q,r,r?'automatic':'unanswered',q.created_at+QUESTION_LIFETIME);return 1;
 });
 return total;
}
export async function acceptedAnswers(db,params){
  const page=Number(params.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid accepted answers page.');
  const total=(await db.prepare("SELECT count(*) AS n FROM accepted_answers").get()).n,pages=Math.max(1,Math.ceil(total/25)),current=Math.min(page,pages);
  return {page:current,pages,total,answers:(await db.prepare("SELECT question_id AS \"questionId\",question_body AS question,answer_body AS answer,question_nickname AS \"askedBy\",answer_nickname AS \"answeredBy\",answer_author AS \"walletAddress\",upvotes,selection,closed_at AS \"closedAt\",(SELECT tx_hash FROM reward_receipts rr WHERE rr.question_id=accepted_answers.question_id) AS \"rewardTx\" FROM accepted_answers ORDER BY closed_at DESC,question_id LIMIT 25 OFFSET $1").all((current-1)*25))};
}
