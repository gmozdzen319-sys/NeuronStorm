import {requireProfile} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function listNotifications(db,account,params){
  requireProfile(db,account);const address=account.address.toLowerCase(),page=Number(params.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid notification page.');
  const filter='n.address=? AND q.deleted_at IS NULL AND EXISTS(SELECT 1 FROM question_participants qp WHERE qp.question_id=q.id AND qp.address=n.address)';
  const counts=db.prepare(`SELECT count(*) AS total,COALESCE(sum(n.read_at IS NULL),0) AS unread,COALESCE(max(n.id),0) AS throughId FROM notifications n JOIN questions q ON q.id=n.question_id WHERE ${filter}`).get(address);
  const pages=Math.max(1,Math.ceil(counts.total/20)),actualPage=Math.min(page,pages);
  const notifications=db.prepare(`SELECT n.id,n.question_id AS questionId,n.kind,n.created_at AS createdAt,n.read_at AS readAt,p.nickname AS actor,substr(q.body,1,110) AS title FROM notifications n JOIN questions q ON q.id=n.question_id JOIN profiles p ON p.address=n.actor WHERE ${filter} ORDER BY n.id DESC LIMIT 20 OFFSET ?`).all(address,(actualPage-1)*20);
  const sequence=db.prepare('SELECT count(*) AS n FROM notifications WHERE address=?').get(address).n;
  return {...counts,sequence,page:actualPage,pages,notifications};
}
export function readNotifications(db,account,input,all,now){
  requireProfile(db,account);const address=account.address.toLowerCase(),id=all?input.throughId:input.id;
  if(!Number.isSafeInteger(id)||id<(all?0:1))throw fail(400,'Invalid notification.');
  const filter=`address=? AND id${all?'<=':'='}? AND question_id IN(SELECT q.id FROM questions q JOIN question_participants qp ON qp.question_id=q.id WHERE q.deleted_at IS NULL AND qp.address=?)`;
  if(!all&&!db.prepare(`SELECT 1 FROM notifications WHERE ${filter}`).get(address,id,address))throw fail(404,'This notification was not found.');
  db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE ${filter}`).run(now,address,id,address);return {ok:true};
}
