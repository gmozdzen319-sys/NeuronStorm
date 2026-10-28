import {createHmac,randomBytes} from 'node:crypto';
// Public activity metadata only. Never select content, categories, location or credentials.
export function createNetworkActivity(db,now=Date.now){
 const secret=randomBytes(32),opaque=value=>createHmac('sha256',secret).update(value).digest('hex').slice(0,32);
 let cached=null,pending=null;
 async function snapshot(){
  if(cached&&now()-cached.loaded<2000)return cached;
  if(pending)return pending;
  pending=(async()=>{
   const end=now()-1500,start=end-45000;
   const rows=await db.prepare(`WITH events AS (
    SELECT 'question' AS kind,q.id AS question,q.id::text AS event,q.author AS actor,q.author AS asker,q.created_at AS at FROM questions q WHERE q.created_at>$1 AND q.created_at<=$2 AND q.deleted_at IS NULL AND q.closed_at IS NULL
    UNION ALL
    SELECT 'answer',q.id,r.id::text,r.author,q.author,r.created_at FROM (SELECT id,question_id,author,created_at,deleted_at FROM replies ORDER BY id DESC LIMIT 80) r JOIN questions q ON q.id=r.question_id WHERE r.created_at>$1 AND r.created_at<=$2 AND r.deleted_at IS NULL AND q.deleted_at IS NULL AND q.closed_at IS NULL
   ) SELECT e.*,p.nickname,a.nickname AS asker_name,
    (SELECT file_id FROM content_file_links WHERE avatar_owner=e.actor LIMIT 1) AS avatar,
    (SELECT file_id FROM content_file_links WHERE avatar_owner=e.asker LIMIT 1) AS asker_avatar
    FROM events e JOIN profiles p ON p.address=e.actor JOIN profiles a ON a.address=e.asker ORDER BY e.at DESC,e.kind,e.event LIMIT 80`).all(start,end);
   const person=(name,avatar)=>({nickname:String(name).slice(0,60),avatar:avatar?String(avatar):null});
   cached={loaded:now(),through:end,events:rows.reverse().map(r=>({id:opaque(r.kind+':'+r.event),conversation:opaque('visual:'+r.question),kind:r.kind,at:Number(r.at),person:person(r.nickname,r.avatar),asker:person(r.asker_name,r.asker_avatar)}))};return cached;
  })().finally(()=>{pending=null;});return pending;
 }
 return {async read(since){const s=await snapshot();const n=Number(since);return {through:s.through,events:since!==null&&Number.isFinite(n)?s.events.filter(e=>e.at>Math.max(n,s.through-45000)):[]};}};
}
export async function networkAvatar(db,id){
 if(!/^[a-f0-9-]{36}$/i.test(id))return null;
 return db.prepare(`SELECT f.bytes,f.mime FROM content_files f JOIN content_file_links l ON l.file_id=f.id JOIN profiles p ON p.address=l.avatar_owner WHERE f.id=$1 AND f.mime IN ('image/webp','image/png','image/jpeg') LIMIT 1`).get(id);
}
