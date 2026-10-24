import {requireProfile,readThread} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export async function requireAdmin(db,account){
  if(!account)throw fail(401,'Your session has expired. Please sign in again.');
  if(account.role!=='admin')throw fail(403,'Administrator access is required.');
  (await requireProfile(db,account));
}
export async function adminList(db,account,params){
  (await requireAdmin(db,account));
  const page=Number(params.get('page')||1),state=params.get('state')||'active',search=(params.get('search')||'').trim();
  if(!Number.isSafeInteger(page)||page<1||page>100000||!['active',"deleted"].includes(state)||search.length>200)throw fail(400,'Invalid search or page.');
  const match=`q.closed_at IS NULL AND q.deleted_at IS ${state==='active'?'NULL':'NOT NULL'} AND ($1='' OR strpos(lower(q.body),lower($2))>0 OR strpos(lower(p.nickname),lower($3))>0 OR EXISTS(SELECT 1 FROM question_categories qc JOIN categories c ON c.id=qc.category_id WHERE qc.question_id=q.id AND strpos(lower(c.name),lower($4))>0))`;
  const args=[search,search,search,search],total=(await db.prepare(`SELECT count(*) AS n FROM questions q JOIN profiles p ON p.address=q.author WHERE ${match}`).get(...args)).n;
  const pages=Math.max(1,Math.ceil(total/20)),actualPage=Math.min(page,pages);
  const rows=(await db.prepare(`SELECT q.id,q.body,p.nickname AS author,q.created_at AS "createdAt",q.deleted_at AS "deletedAt",(SELECT count(*) FROM replies r WHERE r.question_id=q.id AND r.deleted_at IS NULL) AS "replyCount" FROM questions q JOIN profiles p ON p.address=q.author WHERE ${match} ORDER BY COALESCE(q.deleted_at,q.updated_at) DESC,q.id LIMIT 20 OFFSET $5`).all(...args,(actualPage-1)*20));
  const questions=(await Promise.all(rows.map(async ({body,...q})=>({...q,title:body.split('\n')[0].slice(0,110),excerpt:body.slice(0,220),categories:(await db.prepare("SELECT c.name,c.kind FROM categories c JOIN question_categories qc ON qc.category_id=c.id WHERE qc.question_id=$1 ORDER BY c.kind,c.name").all(q.id))}))));
  const count=async sql=>(await db.prepare(sql).get()).n;
  return {questions,page:actualPage,pages,total,stats:{members:(await count("SELECT count(*) AS n FROM accounts")),active:(await count("SELECT count(*) AS n FROM questions WHERE deleted_at IS NULL AND closed_at IS NULL")),deleted:(await count("SELECT count(*) AS n FROM questions WHERE deleted_at IS NOT NULL AND closed_at IS NULL")),replies:(await count("SELECT count(*) AS n FROM replies r JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL AND q.closed_at IS NULL AND r.deleted_at IS NULL"))}};
}
export async function adminThread(db,account,id){
  (await requireAdmin(db,account));
  const thread=(await readThread(db,account,id,true));
  return {thread,audit:(await db.prepare("SELECT actor,action,created_at AS \"createdAt\" FROM admin_audit WHERE question_id=$1 ORDER BY id DESC LIMIT 30").all(id))};
}
export async function moderateThread(db,account,id,action,input,now){
 return db.transaction(async () => {
 await db.lock("question:"+id);

  (await requireAdmin(db,account));
  if(input.confirmation!==id)throw fail(400,'Confirm the selected conversation before continuing.');

  try{
    const q=(await db.prepare("SELECT deleted_at,closed_at FROM questions WHERE id=$1").get(id));
    if(q?.closed_at!==null&&q)throw fail(409,'Closed conversations cannot be restored.');
    if(!q)throw fail(404,'This conversation was not found.');
    if((action==="delete")===(q.deleted_at!==null))throw fail(409,action==="delete"?'This conversation is already in Deleted conversations.':'This conversation is already active.');
    await db.query("SELECT set_config('neuron.event_time',$1,true)",[String(now)]);
    (await db.prepare("UPDATE questions SET deleted_at=$1 WHERE id=$2").run(action==="delete"?now:null,id));
    if(action==="delete")(await db.prepare("UPDATE notifications SET read_at=COALESCE(read_at,$1) WHERE question_id=$2").run(now,id));
    if(action==="delete")await db.prepare("UPDATE account_activity SET read_at=COALESCE(read_at,$1) WHERE question_id=$2").run(now,id);
    (await db.prepare("INSERT INTO admin_audit(question_id,actor,action,created_at) VALUES($1,$2,$3,$4)").run(id,account.address.toLowerCase(),action,now));
    return {ok:true};
  }catch(error){throw error;}

 });
}

// Admin-only directory. Addresses are immutable assignments, never social-ID
// fallbacks for Passkey accounts; activation status comes from the saved journal.
export async function adminMembers(db,account,params){
 await requireAdmin(db,account);
 const requested=Number(params.get('page')||1),search=(params.get('search')||'').trim().toLowerCase();
 const order=params.get('order')||'oldest',method=params.get('method')||'all';
 if(!['oldest','newest'].includes(order)||!['all','passkey','pelagus','blippay','external_unknown'].includes(method))throw fail(400,'Invalid member filter.');
 if(!Number.isSafeInteger(requested)||requested<1||requested>100000||search.length>100)throw fail(400,'Invalid member search.');
 const source=`SELECT a.address AS identity,COALESCE(p.nickname,'Profile incomplete') AS nickname,
 a.created_at AS "createdAt",c.account_id AS "accountId",(SELECT json_build_object('id',l.file_id) FROM content_file_links l WHERE l.avatar_owner=p.address) AS avatar,
 CASE WHEN c.account_id IS NOT NULL THEN 'passkey' ELSE COALESCE(m.method,'external_unknown') END AS method,
 CASE WHEN c.account_id IS NULL THEN a.address ELSE COALESCE(w.address,v.address) END AS address,
 CASE WHEN w.address IS NOT NULL THEN 'v3' WHEN v.address IS NOT NULL THEN 'v2' ELSE NULL END AS version,
 CASE WHEN w.address IS NOT NULL THEN w.created_at WHEN v.address IS NOT NULL THEN v.created_at ELSE NULL END AS "walletAssignedAt",
 CASE WHEN c.account_id IS NULL THEN 'External wallet' WHEN w.address IS NOT NULL THEN COALESCE(ap.phase,'reserved') ELSE 'Legacy assignment' END AS "walletStatus"
 FROM accounts a LEFT JOIN profiles p ON p.address=a.address
 LEFT JOIN passkey_community_accounts c ON c.address=a.address
 LEFT JOIN account_registration_methods m ON m.address=a.address
 LEFT JOIN passkey_fee_wallets w ON w.account_id=c.account_id
 LEFT JOIN passkey_fee_approvals ap ON ap.account_id=c.account_id
 LEFT JOIN passkey_clone_wallets_v2 v ON v.account_id=c.account_id`;
 const filter="($1='' OR strpos(lower(nickname),$1)>0 OR strpos(COALESCE(address,''),$1)>0 OR strpos(COALESCE(\"accountId\",identity),$1)>0)";
 const match=filter+" AND ($2='all' OR method=$2)";
 const total=(await db.prepare(`SELECT count(*) AS n FROM (${source}) members WHERE ${match}`).get(search,method)).n;
 const pages=Math.max(1,Math.ceil(total/50)),page=Math.min(requested,pages);
 const direction=order==='newest'?'DESC':'ASC';
 const members=await db.prepare(`SELECT * FROM (${source}) members WHERE ${match} ORDER BY "createdAt" ${direction},identity ${direction} LIMIT 50 OFFSET $3`).all(search,method,(page-1)*50);
 for(const member of members){
  member.walletConfirmedAt=null;
  if(member.version){const table=member.version==='v3'?'passkey_fee_approval_history':'passkey_clone_approval_history_v2';
   member.walletConfirmedAt=(await db.prepare(`SELECT (extract(epoch FROM min(recorded_at))*1000)::bigint AS at FROM ${table} WHERE account_id=$1 AND evidence::jsonb->>'phase'='confirmed'`).get(member.accountId)).at;
  }
 }
 return {page,pages,total,members:members.map(({identity,...row})=>({...row,memberId:row.accountId?'passkey:'+row.accountId:identity}))};
}
