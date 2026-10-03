import {requireProfile,readThread} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function requireAdmin(db,account){
  if(!account)throw fail(401,'Your session has expired. Please sign in again.');
  if(account.role!=='admin')throw fail(403,'Administrator access is required.');
  requireProfile(db,account);
}
export function adminList(db,account,params){
  requireAdmin(db,account);
  const page=Number(params.get('page')||1),state=params.get('state')||'active',search=(params.get('search')||'').trim();
  if(!Number.isSafeInteger(page)||page<1||page>100000||!['active','deleted'].includes(state)||search.length>200)throw fail(400,'Invalid search or page.');
  const match=`q.closed_at IS NULL AND q.deleted_at IS ${state==='active'?'NULL':'NOT NULL'} AND (?='' OR instr(lower(q.body),lower(?))>0 OR instr(lower(p.nickname),lower(?))>0 OR EXISTS(SELECT 1 FROM question_categories qc JOIN categories c ON c.id=qc.category_id WHERE qc.question_id=q.id AND instr(lower(c.name),lower(?))>0))`;
  const args=[search,search,search,search],total=db.prepare(`SELECT count(*) AS n FROM questions q JOIN profiles p ON p.address=q.author WHERE ${match}`).get(...args).n;
  const pages=Math.max(1,Math.ceil(total/20)),actualPage=Math.min(page,pages);
  const rows=db.prepare(`SELECT q.id,q.body,p.nickname AS author,q.created_at AS createdAt,q.deleted_at AS deletedAt,(SELECT count(*) FROM replies r WHERE r.question_id=q.id AND r.deleted_at IS NULL) AS replyCount FROM questions q JOIN profiles p ON p.address=q.author WHERE ${match} ORDER BY COALESCE(q.deleted_at,q.updated_at) DESC,q.id LIMIT 20 OFFSET ?`).all(...args,(actualPage-1)*20);
  const questions=rows.map(({body,...q})=>({...q,title:body.split('\n')[0].slice(0,110),excerpt:body.slice(0,220),categories:db.prepare('SELECT c.name,c.kind FROM categories c JOIN question_categories qc ON qc.category_id=c.id WHERE qc.question_id=? ORDER BY c.kind,c.name').all(q.id)}));
  const count=sql=>db.prepare(sql).get().n;
  return {questions,page:actualPage,pages,total,stats:{members:count('SELECT count(*) AS n FROM accounts'),active:count('SELECT count(*) AS n FROM questions WHERE deleted_at IS NULL AND closed_at IS NULL'),deleted:count('SELECT count(*) AS n FROM questions WHERE deleted_at IS NOT NULL AND closed_at IS NULL'),replies:count('SELECT count(*) AS n FROM replies r JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL AND q.closed_at IS NULL AND r.deleted_at IS NULL')}};
}
export function adminThread(db,account,id){
  requireAdmin(db,account);
  const thread=readThread(db,account,id,true);
  return {thread,audit:db.prepare('SELECT actor,action,created_at AS createdAt FROM admin_audit WHERE question_id=? ORDER BY id DESC LIMIT 30').all(id)};
}
export function moderateThread(db,account,id,action,input,now){
  requireAdmin(db,account);
  if(input.confirmation!==id)throw fail(400,'Confirm the selected conversation before continuing.');
  db.exec('BEGIN IMMEDIATE');
  try{
    const q=db.prepare('SELECT deleted_at,closed_at FROM questions WHERE id=?').get(id);
    if(q?.closed_at!==null&&q)throw fail(409,'Closed conversations cannot be restored.');
    if(!q)throw fail(404,'This conversation was not found.');
    if((action==='delete')===(q.deleted_at!==null))throw fail(409,action==='delete'?'This conversation is already in Deleted conversations.':'This conversation is already active.');
    db.prepare('UPDATE questions SET deleted_at=? WHERE id=?').run(action==='delete'?now:null,id);
    if(action==='delete')db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE question_id=?').run(now,id);
    db.prepare('INSERT INTO admin_audit(question_id,actor,action,created_at) VALUES(?,?,?,?)').run(id,account.address.toLowerCase(),action,now);
    db.exec('COMMIT');return {ok:true};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
