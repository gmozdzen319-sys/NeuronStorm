import {requireProfile,allowed} from './threads.mjs';
import {requireAdmin} from './admin.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export function initMemberTools(db){db.exec(`
CREATE TABLE IF NOT EXISTS saved_answers(owner TEXT NOT NULL,reply_id INTEGER NOT NULL,question_id TEXT NOT NULL,question TEXT NOT NULL,answer TEXT NOT NULL,author TEXT NOT NULL,version INTEGER NOT NULL,saved_at INTEGER NOT NULL,PRIMARY KEY(owner,reply_id));
CREATE TABLE IF NOT EXISTS content_reports(id INTEGER PRIMARY KEY,reporter TEXT NOT NULL,question_id TEXT NOT NULL,reply_id INTEGER NOT NULL DEFAULT 0,reason TEXT NOT NULL,details TEXT NOT NULL,snapshot TEXT NOT NULL,created_at INTEGER NOT NULL,resolved_at INTEGER,UNIQUE(reporter,question_id,reply_id));
CREATE TABLE IF NOT EXISTS reward_receipts(id INTEGER PRIMARY KEY,question_id TEXT UNIQUE NOT NULL,recipient TEXT NOT NULL,units TEXT NOT NULL,tx_hash TEXT UNIQUE NOT NULL,created_at INTEGER NOT NULL,read_at INTEGER);
`);}
function pageRows(db,sql,args,params){const page=Number(params.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid page.');const total=db.prepare('SELECT count(*) AS n FROM ('+sql+')').get(...args).n,pages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,pages);return {page:current,pages,total,items:db.prepare(sql+' LIMIT 20 OFFSET ?').all(...args,(current-1)*20)};}
export function library(db,account,input,params=new URLSearchParams(),now=Date.now()){
 requireProfile(db,account);const owner=account.address.toLowerCase();
 if(!input)return pageRows(db,'SELECT reply_id AS replyId,question,answer,author,version,saved_at AS savedAt FROM saved_answers WHERE owner=? ORDER BY saved_at DESC,reply_id',[owner],params);
 if(!Number.isSafeInteger(input.replyId))throw fail(400,'Choose an answer.');
 if(input.action==='remove'){db.prepare('DELETE FROM saved_answers WHERE owner=? AND reply_id=?').run(owner,input.replyId);return {ok:true};}
 if(input.action!=='save')throw fail(400,'Choose save or remove.');
 const r=db.prepare('SELECT r.*,p.nickname FROM replies r JOIN profiles p ON p.address=r.author WHERE r.id=? AND r.deleted_at IS NULL').get(input.replyId);if(!r)throw fail(404,'Answer unavailable.');const q=allowed(db,r.question_id,account);
 if(q.author!==owner)throw fail(403,'Only the question author can save answers to this question.');
 if(r.version!==input.version)throw fail(409,'This answer changed. Refresh before saving.');
 db.prepare('INSERT INTO saved_answers VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,reply_id) DO UPDATE SET question=excluded.question,answer=excluded.answer,author=excluded.author,version=excluded.version,saved_at=excluded.saved_at').run(owner,r.id,q.id,q.body,r.body,r.nickname,r.version,now);return {ok:true};
}
export function reportContent(db,account,input,now=Date.now()){
 requireProfile(db,account);const q=allowed(db,input.questionId,account),replyId=input.replyId??0;
 if(!Number.isSafeInteger(replyId)||replyId<0||!['spam','abuse','misleading','other'].includes(input.reason)||typeof input.details!=='string'||input.details.length>500)throw fail(400,'Choose a reason and use at most 500 characters.');
 const r=replyId?db.prepare('SELECT body FROM replies WHERE id=? AND question_id=? AND deleted_at IS NULL').get(replyId,q.id):null;if(replyId&&!r)throw fail(404,'Answer unavailable.');
 db.prepare('INSERT OR IGNORE INTO content_reports(reporter,question_id,reply_id,reason,details,snapshot,created_at) VALUES(?,?,?,?,?,?,?)').run(account.address.toLowerCase(),q.id,replyId,input.reason,input.details.trim(),JSON.stringify({question:q.body,answer:r?.body||null}),now);return {ok:true};
}
export function adminReports(db,account,input,params,now=Date.now()){
 requireAdmin(db,account);
 if(input){if(!Number.isSafeInteger(input.id))throw fail(400,'Choose a report.');db.prepare('UPDATE content_reports SET resolved_at=COALESCE(resolved_at,?) WHERE id=?').run(now,input.id);return {ok:true};}
 const result=pageRows(db,'SELECT id,question_id AS questionId,reply_id AS replyId,reason,details,snapshot,created_at AS createdAt,resolved_at AS resolvedAt FROM content_reports ORDER BY resolved_at IS NOT NULL,created_at DESC',[],params);return {...result,items:result.items.map(({snapshot,...r})=>({...r,...JSON.parse(snapshot)}))};
}
