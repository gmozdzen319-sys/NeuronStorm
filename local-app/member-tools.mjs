import {requireProfile,allowed} from './threads.mjs';
import {requireAdmin} from './admin.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});

async function pageRows(db,sql,args,params){const page=Number(params.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid page.');const total=(await db.prepare("SELECT count(*) AS n FROM ("+sql+')').get(...args)).n,pages=Math.max(1,Math.ceil(total/20)),current=Math.min(page,pages);return {page:current,pages,total,items:(await db.prepare(sql+' LIMIT 20 OFFSET $'+(args.length+1)).all(...args,(current-1)*20))};}
export async function library(db,account,input,params=new URLSearchParams(),now=Date.now()){
 return db.transaction(async () => {

 (await requireProfile(db,account));const owner=account.address.toLowerCase();
 if(!input)return (await pageRows(db,"SELECT reply_id AS \"replyId\",question,answer,author,version,saved_at AS \"savedAt\" FROM saved_answers WHERE owner=$1 ORDER BY saved_at DESC,reply_id",[owner],params));
 if(!Number.isSafeInteger(input.replyId))throw fail(400,'Choose an answer.');
 if(input.action==='remove'){(await db.prepare("DELETE FROM saved_answers WHERE owner=$1 AND reply_id=$2").run(owner,input.replyId));return {ok:true};}
 if(input.action!=='save')throw fail(400,'Choose save or remove.');
 const target=await db.prepare('SELECT question_id FROM replies WHERE id=$1').get(input.replyId);
 if(target)await db.lock('question:'+target.question_id);
 const r=(await db.prepare("SELECT r.*,p.nickname FROM replies r JOIN profiles p ON p.address=r.author WHERE r.id=$1 AND r.deleted_at IS NULL").get(input.replyId));if(!r)throw fail(404,'Answer unavailable.');const q=(await allowed(db,r.question_id,account));
 if(q.author!==owner)throw fail(403,'Only the question author can save answers to this question.');
 if(r.version!==input.version)throw fail(409,'This answer changed. Refresh before saving.');
 (await db.prepare("INSERT INTO saved_answers VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner,reply_id) DO UPDATE SET question=excluded.question,answer=excluded.answer,author=excluded.author,version=excluded.version,saved_at=excluded.saved_at").run(owner,r.id,q.id,q.body,r.body,r.nickname,r.version,now));return {ok:true};

 });
}
export async function reportContent(db,account,input,now=Date.now()){
 return db.transaction(async () => {
 await db.lock('question:'+input.questionId);

 (await requireProfile(db,account));const q=(await allowed(db,input.questionId,account)),replyId=input.replyId??0;
 if(!Number.isSafeInteger(replyId)||replyId<0||!['spam','abuse','misleading','other'].includes(input.reason)||typeof input.details!=='string'||input.details.length>500)throw fail(400,'Choose a reason and use at most 500 characters.');
 const r=replyId?(await db.prepare("SELECT body FROM replies WHERE id=$1 AND question_id=$2 AND deleted_at IS NULL").get(replyId,q.id)):null;if(replyId&&!r)throw fail(404,'Answer unavailable.');
 (await db.prepare("INSERT INTO content_reports(reporter,question_id,reply_id,reason,details,snapshot,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING").run(account.address.toLowerCase(),q.id,replyId,input.reason,input.details.trim(),JSON.stringify({question:q.body,answer:r?.body||null}),now));return {ok:true};

 });
}
export async function adminReports(db,account,input,params,now=Date.now()){
 (await requireAdmin(db,account));
 if(input){if(!Number.isSafeInteger(input.id))throw fail(400,'Choose a report.');(await db.prepare("UPDATE content_reports SET resolved_at=COALESCE(resolved_at,$1) WHERE id=$2").run(now,input.id));return {ok:true};}
 const result=(await pageRows(db,"SELECT id,question_id AS \"questionId\",reply_id AS \"replyId\",reason,details,snapshot,created_at AS \"createdAt\",resolved_at AS \"resolvedAt\" FROM content_reports ORDER BY resolved_at IS NOT NULL,created_at DESC",[],params));return {...result,items:result.items.map(({snapshot,...r})=>({...r,...JSON.parse(snapshot)}))};
}
