import {isBlocked} from './contact-preferences.mjs';
import {QUESTION_LIFETIME} from './lifecycle.mjs';
import {requireProfile,allowed} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function initDebate(db){db.exec(`CREATE TABLE IF NOT EXISTS debate_messages(id INTEGER PRIMARY KEY,question_id TEXT NOT NULL REFERENCES questions(id),author TEXT NOT NULL REFERENCES profiles(address),body TEXT NOT NULL,client_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(question_id,author,client_id));
 CREATE INDEX IF NOT EXISTS debate_thread ON debate_messages(question_id,id);
 CREATE TABLE IF NOT EXISTS debate_presence(question_id TEXT NOT NULL REFERENCES questions(id),address TEXT NOT NULL REFERENCES profiles(address),session_hash TEXT NOT NULL,seen INTEGER NOT NULL,PRIMARY KEY(question_id,address,session_hash));`);}
export function debate(db,account,id,session,params,input,now){
  requireProfile(db,account);const question=allowed(db,id,account);if(question.created_at+QUESTION_LIFETIME<=now)throw fail(409,'This conversation has expired.');const address=account.address.toLowerCase();
  if(input){
    if(isBlocked(db,address,question.author))throw fail(403,'Messages between these accounts are blocked.');
    if(typeof input.body!=='string'||!input.body.trim()||input.body.trim().length>2000||typeof input.clientId!=='string'||!/^[a-f0-9-]{36}$/.test(input.clientId))throw fail(400,'Enter a debate message between 1 and 2,000 characters.');
    const existing=db.prepare('SELECT body FROM debate_messages WHERE question_id=? AND author=? AND client_id=?').get(id,address,input.clientId);
    if(existing&&existing.body!==input.body.trim())throw fail(409,'This message request was already used.');
    db.prepare('INSERT OR IGNORE INTO debate_messages(question_id,author,body,client_id,created_at) VALUES(?,?,?,?,?)').run(id,address,input.body.trim(),input.clientId,now);
  }
  const before=Number(params.get('before')||0),after=Number(params.get('after')||0);
  if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(after)||after<0)throw fail(400,'Invalid debate page.');
  db.prepare('DELETE FROM debate_presence WHERE seen<?').run(now-25000);
  if(params.get('presence')==='1'||input)db.prepare('INSERT INTO debate_presence VALUES(?,?,?,?) ON CONFLICT(question_id,address,session_hash) DO UPDATE SET seen=excluded.seen').run(id,address,session,now);
  const messages=db.prepare(`SELECT m.id,m.body,m.created_at AS createdAt,p.nickname AS author,m.author=? AS mine FROM debate_messages m JOIN profiles p ON p.address=m.author WHERE m.question_id=? AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=? AND b.target=m.author) OR (b.target=? AND b.owner=m.author)) ${before?'AND m.id<?':after?'AND m.id>?':''} ORDER BY m.id ${after?'ASC':'DESC'} LIMIT 50`).all(address,...(before||after?[id,address,address,before||after]:[id,address,address]));
  if(!after)messages.reverse();
  const online=db.prepare('SELECT DISTINCT p.address,p.nickname FROM debate_presence d JOIN profiles p ON p.address=d.address JOIN sessions s ON s.token_hash=d.session_hash AND s.expires>? WHERE d.question_id=? AND d.seen>? ORDER BY p.nickname').all(now,id,now-25000).filter(p=>!isBlocked(db,address,p.address)).map(p=>p.nickname);
  const oldest=messages[0]?.id;
  return {canPost:!isBlocked(db,address,question.author),messages,online,hasEarlier:!!oldest&&!!db.prepare('SELECT 1 FROM debate_messages WHERE question_id=? AND id<? LIMIT 1').get(id,oldest)};
}
