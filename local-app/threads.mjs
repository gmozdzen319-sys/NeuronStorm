import { randomUUID } from 'node:crypto';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function initThreads(db){
  db.exec(`CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY, author TEXT NOT NULL REFERENCES profiles(address),category_id INTEGER NOT NULL REFERENCES categories(id),body TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS question_participants(question_id TEXT NOT NULL REFERENCES questions(id),address TEXT NOT NULL REFERENCES accounts(address),is_recipient INTEGER NOT NULL,PRIMARY KEY(question_id,address));
    CREATE INDEX IF NOT EXISTS participants_address ON question_participants(address,question_id);
    CREATE TABLE IF NOT EXISTS replies(id INTEGER PRIMARY KEY,question_id TEXT NOT NULL REFERENCES questions(id),author TEXT NOT NULL REFERENCES profiles(address),body TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS replies_question ON replies(question_id,id);
    CREATE TABLE IF NOT EXISTS question_reads(question_id TEXT NOT NULL REFERENCES questions(id),address TEXT NOT NULL REFERENCES accounts(address),revision INTEGER NOT NULL,PRIMARY KEY(question_id,address));`);
  db.exec(`CREATE TABLE IF NOT EXISTS question_categories(question_id TEXT NOT NULL REFERENCES questions(id),category_id INTEGER NOT NULL REFERENCES categories(id),PRIMARY KEY(question_id,category_id));
    INSERT OR IGNORE INTO question_categories SELECT id,category_id FROM questions;`);
  db.exec(`CREATE TABLE IF NOT EXISTS reply_votes(reply_id INTEGER NOT NULL REFERENCES replies(id),voter TEXT NOT NULL REFERENCES accounts(address),value INTEGER NOT NULL CHECK(value IN (-1,1)),PRIMARY KEY(reply_id,voter));`);
  if(!db.prepare('PRAGMA table_info(questions)').all().some(c=>c.name==='deleted_at'))db.exec('ALTER TABLE questions ADD COLUMN deleted_at INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS admin_audit(id INTEGER PRIMARY KEY,question_id TEXT NOT NULL REFERENCES questions(id),actor TEXT NOT NULL REFERENCES accounts(address),action TEXT NOT NULL CHECK(action IN ('delete','restore')),created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS audit_question ON admin_audit(question_id,id);
    CREATE INDEX IF NOT EXISTS questions_deleted ON questions(deleted_at);`);
  db.exec(`CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY,address TEXT NOT NULL REFERENCES accounts(address),question_id TEXT NOT NULL REFERENCES questions(id),actor TEXT NOT NULL REFERENCES accounts(address),kind TEXT NOT NULL CHECK(kind IN ('question','reply')),revision INTEGER NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(address,question_id,revision));
    CREATE INDEX IF NOT EXISTS notifications_address ON notifications(address,id);`);
}
function topics(db,id){return db.prepare('SELECT c.id,c.name,c.kind FROM categories c JOIN question_categories qc ON qc.category_id=c.id WHERE qc.question_id=? ORDER BY c.kind,c.name').all(id);}
function message(value,max){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw fail(400,`Enter a message between 1 and ${max} characters.`);return value.trim();}
export function requireProfile(db,account){
  if(!account)throw fail(401,'Your session has expired. Please sign in again.');
  if(!db.prepare('SELECT 1 FROM profiles WHERE address=?').get(account.address.toLowerCase()))throw fail(403,'Complete your profile before joining conversations.');
}
function allowed(db,id,account,includeDeleted=false){
  const q=db.prepare('SELECT * FROM questions WHERE id=?').get(id);
  if(!q||(q.deleted_at!==null&&!(includeDeleted&&account.role==='admin'))||(account.role!=='admin'&&!db.prepare('SELECT 1 FROM question_participants WHERE question_id=? AND address=?').get(id,account.address.toLowerCase())))throw fail(404,'This conversation was not found.');
  return q;
}
export function createQuestion(db,account,input,now){
  requireProfile(db,account);
  const body=message(input.body,4000),raw=input.categoryIds??[input.categoryId],author=account.address.toLowerCase();
  if(!Array.isArray(raw)||!raw.length||raw.length>100||raw.some(id=>!Number.isSafeInteger(id)||!db.prepare('SELECT 1 FROM categories WHERE id=?').get(id)))throw fail(400,'Choose at least one existing topic (up to 100).');
  const categoryIds=[...new Set(raw)],categoryId=categoryIds[0];
  db.exec('BEGIN IMMEDIATE');
  try{
    const recipients=db.prepare(`SELECT DISTINCT address FROM profile_categories WHERE category_id IN (${categoryIds.map(()=>'?').join(',')}) AND address<>?`).all(...categoryIds,author);
    if(!recipients.length)throw fail(409,'No other members currently have any of the selected topics. Your question has not been sent. Choose another topic or try again later.');
    const id=randomUUID();
    db.prepare('INSERT INTO questions(id,author,category_id,body,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,author,categoryId,body,now,now);
    for(const topicId of categoryIds)db.prepare('INSERT INTO question_categories VALUES(?,?)').run(id,topicId);
    db.prepare('INSERT INTO question_participants VALUES(?,?,0)').run(id,author);
    for(const r of recipients)db.prepare('INSERT INTO question_participants VALUES(?,?,1)').run(id,r.address);
    for(const r of recipients)db.prepare("INSERT INTO notifications(address,question_id,actor,kind,revision,created_at) VALUES(?,?,?,'question',1,?)").run(r.address,id,author,now);
    db.prepare('INSERT INTO question_reads VALUES(?,?,1)').run(id,author);
    db.exec('COMMIT');return {id,recipientCount:recipients.length};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
export function listQuestions(db,account,view){
  requireProfile(db,account);
  if(!['inbox','mine'].includes(view))throw fail(400,'Choose Inbox or My Questions.');
  const address=account.address.toLowerCase();
  const rows=db.prepare(`SELECT q.id,q.body,q.created_at AS createdAt,q.updated_at AS updatedAt,q.revision,p.nickname AS author,c.name AS category,c.kind AS categoryKind,
    (SELECT count(*) FROM replies r WHERE r.question_id=q.id) AS replyCount,
    COALESCE((SELECT revision FROM question_reads qr WHERE qr.question_id=q.id AND qr.address=?),0) AS readRevision
    FROM questions q JOIN profiles p ON p.address=q.author JOIN categories c ON c.id=q.category_id
    WHERE q.deleted_at IS NULL AND (${view==='mine'?'q.author=?':account.role==='admin'?'1=1':'EXISTS(SELECT 1 FROM question_participants qp WHERE qp.question_id=q.id AND qp.address=? AND qp.is_recipient=1)'}) ORDER BY q.updated_at DESC,q.id`).all(...(view==='inbox'&&account.role==='admin'?[address]:[address,address]));
  return rows.map(({body,revision,readRevision,...row})=>({...row,categories:topics(db,row.id),title:body.split('\n')[0].slice(0,110),excerpt:body.slice(0,220),unread:revision>readRevision}));
}
export function readThread(db,account,id,includeDeleted=false){
  requireProfile(db,account);const q=allowed(db,id,account,includeDeleted);
  const category=db.prepare('SELECT name,kind FROM categories WHERE id=?').get(q.category_id);
  const author=db.prepare('SELECT nickname FROM profiles WHERE address=?').get(q.author).nickname;
  const replies=db.prepare(`SELECT r.id,r.body,r.created_at AS createdAt,p.nickname AS author,
    (SELECT count(*) FROM reply_votes v WHERE v.reply_id=r.id AND v.value=1) AS upvotes,
    (SELECT count(*) FROM reply_votes v WHERE v.reply_id=r.id AND v.value=-1) AS downvotes,
    COALESCE((SELECT value FROM reply_votes v WHERE v.reply_id=r.id AND v.voter=?),0) AS myVote,
    r.author<>? AS canVote
    FROM replies r JOIN profiles p ON p.address=r.author WHERE r.question_id=? ORDER BY r.id`).all(account.address.toLowerCase(),account.address.toLowerCase(),id);
  return {id,body:q.body,author,deletedAt:q.deleted_at,categories:topics(db,id),category:category.name,categoryKind:category.kind,createdAt:q.created_at,revision:q.revision,replies,recipientCount:db.prepare('SELECT count(*) AS n FROM question_participants WHERE question_id=? AND is_recipient=1').get(id).n};
}
export function voteOnReply(db,account,id,replyId,input){
  requireProfile(db,account);allowed(db,id,account);
  const reply=db.prepare('SELECT author FROM replies WHERE id=? AND question_id=?').get(replyId,id);
  if(!reply)throw fail(404,'This reply was not found.');
  const voter=account.address.toLowerCase();
  if(reply.author===voter)throw fail(403,'You cannot rate your own reply.');
  if(![1,-1,0].includes(input.value))throw fail(400,'Choose an upvote, a downvote or remove your vote.');
  if(input.value===0)db.prepare('DELETE FROM reply_votes WHERE reply_id=? AND voter=?').run(replyId,voter);
  else db.prepare('INSERT INTO reply_votes VALUES(?,?,?) ON CONFLICT(reply_id,voter) DO UPDATE SET value=excluded.value').run(replyId,voter,input.value);
  return {ok:true};
}
export function replyToThread(db,account,id,input,now){
  requireProfile(db,account);allowed(db,id,account);const body=message(input.body,2000);
  db.exec('BEGIN IMMEDIATE');
  try{db.prepare('INSERT INTO replies(question_id,author,body,created_at) VALUES(?,?,?,?)').run(id,account.address.toLowerCase(),body,now);db.prepare('UPDATE questions SET revision=revision+1,updated_at=? WHERE id=?').run(now,id);db.prepare("INSERT INTO notifications(address,question_id,actor,kind,revision,created_at) SELECT qp.address,q.id,?,'reply',q.revision,? FROM question_participants qp JOIN questions q ON q.id=qp.question_id WHERE q.id=? AND qp.address<>?").run(account.address.toLowerCase(),now,id,account.address.toLowerCase());db.exec('COMMIT');return {ok:true};}catch(error){db.exec('ROLLBACK');throw error;}
}
export function markThreadRead(db,account,id,input){
  requireProfile(db,account);const q=allowed(db,id,account);
  if(!Number.isSafeInteger(input.revision)||input.revision<1||input.revision>q.revision)throw fail(400,'Invalid conversation revision.');
  db.prepare('INSERT INTO question_reads VALUES(?,?,?) ON CONFLICT(question_id,address) DO UPDATE SET revision=max(revision,excluded.revision)').run(id,account.address.toLowerCase(),input.revision);
  db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE address=? AND question_id=? AND revision<=?').run(Date.now(),account.address.toLowerCase(),id,input.revision);
  return {ok:true};
}
