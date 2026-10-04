import {formatBalance} from './holdings.mjs';
import {requireProfile} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function listNotifications(db,account,params){
  requireProfile(db,account);const address=account.address.toLowerCase(),page=Number(params.get('page')||1);
  if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail(400,'Invalid notification page.');
  const filter='NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=n.address AND b.target=n.actor) OR (b.target=n.address AND b.owner=n.actor)) AND n.address=? AND q.deleted_at IS NULL AND q.closed_at IS NULL AND EXISTS(SELECT 1 FROM question_participants qp WHERE qp.question_id=q.id AND qp.address=n.address)';
  const source=`SELECT n.id,n.question_id AS questionId,n.kind,n.created_at AS createdAt,n.read_at AS readAt,p.nickname AS actor,substr(q.body,1,110) AS title,NULL AS units,NULL AS txHash FROM notifications n JOIN questions q ON q.id=n.question_id JOIN profiles p ON p.address=n.actor WHERE ${filter}
    UNION ALL SELECT -r.id,r.question_id,'reward',r.created_at,r.read_at,'Neuron Storm',substr(a.question_body,1,110),r.units,r.tx_hash FROM reward_receipts r JOIN accepted_answers a ON a.question_id=r.question_id WHERE r.recipient=?
    UNION ALL SELECT -1000000000-d.id,d.question_id,'deadline',d.created_at,d.read_at,'Neuron Storm',substr(q.body,1,110),NULL,NULL FROM deadline_reminders d JOIN questions q ON q.id=d.question_id WHERE d.address=? AND q.closed_at IS NULL AND q.deleted_at IS NULL`;
  const counts=db.prepare(`SELECT count(*) AS total,COALESCE(sum(readAt IS NULL),0) AS unread,COALESCE(max(CASE WHEN id>0 THEN id ELSE 0 END),0) AS throughId,COALESCE(max(CASE WHEN kind='reward' THEN -id ELSE 0 END),0) AS throughRewardId,COALESCE(max(CASE WHEN kind='deadline' THEN -id-1000000000 ELSE 0 END),0) AS throughReminderId FROM (${source})`).get(address,address,address);
  const pages=Math.max(1,Math.ceil(counts.total/20)),actualPage=Math.min(page,pages);
  const notifications=db.prepare(`SELECT * FROM (${source}) ORDER BY createdAt DESC,id DESC LIMIT 20 OFFSET ?`).all(address,address,address,(actualPage-1)*20).map(({units,...n})=>({...n,...(units?{amount:formatBalance(units,18)}:{})}));
  const sequence=db.prepare('SELECT (SELECT count(*) FROM notifications WHERE address=?)+(SELECT count(*) FROM reward_receipts WHERE recipient=?)+(SELECT count(*) FROM deadline_reminders WHERE address=?) AS n').get(address,address,address).n;
  return {...counts,sequence,page:actualPage,pages,notifications};
}
export function readNotifications(db,account,input,all,now){
  requireProfile(db,account);const address=account.address.toLowerCase(),id=all?input.throughId:input.id;
  if(!Number.isSafeInteger(id)||(all?id<0:id===0))throw fail(400,'Invalid notification.');
  if(!all&&id<-1000000000){const result=db.prepare('UPDATE deadline_reminders SET read_at=COALESCE(read_at,?) WHERE id=? AND address=?').run(now,-id-1000000000,address);if(!result.changes)throw fail(404,'Notification not found.');return {ok:true};}
  if(all&&input.throughReminderId!==undefined){if(!Number.isSafeInteger(input.throughReminderId)||input.throughReminderId<0)throw fail(400,'Invalid notification.');db.prepare('UPDATE deadline_reminders SET read_at=COALESCE(read_at,?) WHERE id<=? AND address=?').run(now,input.throughReminderId,address);}
  if(!all&&id<0){const result=db.prepare('UPDATE reward_receipts SET read_at=COALESCE(read_at,?) WHERE id=? AND recipient=?').run(now,-id,address);if(!result.changes)throw fail(404,'Notification not found.');return {ok:true};}
  if(all&&input.throughRewardId!==undefined){if(!Number.isSafeInteger(input.throughRewardId)||input.throughRewardId<0)throw fail(400,'Invalid notification.');db.prepare('UPDATE reward_receipts SET read_at=COALESCE(read_at,?) WHERE id<=? AND recipient=?').run(now,input.throughRewardId,address);}
  const filter=`address=? AND id${all?'<=':'='}? AND question_id IN(SELECT q.id FROM questions q JOIN question_participants qp ON qp.question_id=q.id WHERE q.deleted_at IS NULL AND q.closed_at IS NULL AND qp.address=?)`;
  if(!all&&!db.prepare(`SELECT 1 FROM notifications WHERE ${filter}`).get(address,id,address))throw fail(404,'This notification was not found.');
  db.prepare(`UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE ${filter}`).run(now,address,id,address);return {ok:true};
}
