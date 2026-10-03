export const QUESTION_LIFETIME=7*24*60*60*1000;
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function initLifecycle(db){
  if(!db.prepare('PRAGMA table_info(questions)').all().some(c=>c.name==='closed_at'))db.exec('ALTER TABLE questions ADD COLUMN closed_at INTEGER');
  db.exec(`CREATE INDEX IF NOT EXISTS questions_expiry ON questions(closed_at,created_at);
    CREATE TABLE IF NOT EXISTS accepted_answers(question_id TEXT PRIMARY KEY REFERENCES questions(id),reply_id INTEGER,question_body TEXT NOT NULL,answer_body TEXT,question_author TEXT NOT NULL,answer_author TEXT,question_nickname TEXT NOT NULL,answer_nickname TEXT,upvotes INTEGER NOT NULL,selection TEXT NOT NULL CHECK(selection IN ('author','automatic','unanswered')),closed_at INTEGER NOT NULL);`);
}
export function acceptanceCandidate(db,account,questionId,replyId,version,now){
  const q=db.prepare('SELECT * FROM questions WHERE id=?').get(questionId);
  if(!q||q.deleted_at!==null||q.closed_at!==null)throw fail(404,'This conversation is closed or unavailable.');
  if(q.created_at+QUESTION_LIFETIME<=now)throw fail(409,'The 7-day deadline has passed. This conversation is closing.');
  if(q.author!==account.address.toLowerCase())throw fail(403,'Only the person who asked this question can accept an answer.');
  const r=Number.isSafeInteger(replyId)&&db.prepare('SELECT * FROM replies WHERE id=? AND question_id=? AND deleted_at IS NULL').get(replyId,questionId);
  if(!r)throw fail(404,'This answer is no longer available.');
  if(r.author===q.author)throw fail(403,'You cannot accept your own answer.');
  if(r.version!==version)throw fail(409,'This answer changed. Review it again before accepting.');
  return {q,r};
}
function close(db,q,r,selection,now){
  const nickname=address=>db.prepare('SELECT nickname FROM profiles WHERE address=?').get(address)?.nickname||'Member';
  const votes=r?db.prepare('SELECT count(*) AS n FROM reply_votes WHERE reply_id=? AND value=1').get(r.id).n:0;
  db.prepare('INSERT INTO accepted_answers VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(q.id,r?.id??null,q.body,r?.body??null,q.author,r?.author??null,nickname(q.author),r?nickname(r.author):null,votes,selection,now);
  db.prepare('UPDATE questions SET closed_at=?,revision=revision+1 WHERE id=?').run(now,q.id);
  db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE question_id=?').run(now,q.id);
}
export function acceptAnswer(db,account,questionId,input,now){
  db.exec('SAVEPOINT accept_answer');
  try{const {q,r}=acceptanceCandidate(db,account,questionId,input.replyId,input.version,now);
    close(db,q,r,'author',now);db.exec('RELEASE accept_answer');return {ok:true,closed:true};
  }catch(error){db.exec('ROLLBACK TO accept_answer; RELEASE accept_answer');throw error;}
}
export function expireQuestions(db,now){
  db.exec('SAVEPOINT expiry');
  try{
    const rows=db.prepare('SELECT * FROM questions WHERE closed_at IS NULL AND created_at<=?').all(now-QUESTION_LIFETIME);
    for(const q of rows){
      // Moderated conversations cannot win rewards while hidden.
      const r=q.deleted_at===null?db.prepare(`SELECT r.*,(SELECT count(*) FROM reply_votes v WHERE v.reply_id=r.id AND v.value=1) AS votes FROM replies r WHERE r.question_id=? AND r.deleted_at IS NULL AND r.author<>? ORDER BY votes DESC,r.created_at,r.id LIMIT 1`).get(q.id,q.author):null;
      close(db,q,r,r?'automatic':'unanswered',q.created_at+QUESTION_LIFETIME);
    }
    db.exec('RELEASE expiry');return rows.length;
  }catch(error){db.exec('ROLLBACK TO expiry; RELEASE expiry');throw error;}
}
export function acceptedAnswers(db,params){
  const page=Number(params.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid accepted answers page.');
  const total=db.prepare('SELECT count(*) AS n FROM accepted_answers').get().n,pages=Math.max(1,Math.ceil(total/25)),current=Math.min(page,pages);
  return {page:current,pages,total,answers:db.prepare('SELECT question_id AS questionId,question_body AS question,answer_body AS answer,question_nickname AS askedBy,answer_nickname AS answeredBy,answer_author AS walletAddress,upvotes,selection,closed_at AS closedAt FROM accepted_answers ORDER BY closed_at DESC,question_id LIMIT 25 OFFSET ?').all((current-1)*25)};
}
