import {requireProfile,allowed} from './threads.mjs';
import {lookupCountry} from './geography.mjs';
export async function conversationGlobe(db,account,session,ip,input,now,lookup=lookupCountry){
 await requireProfile(db,account);
 const id=input?.questionId,address=account.address.toLowerCase();
 if(typeof id!=='string'||id.length>100)throw Object.assign(Error('Choose a conversation.'),{status:400});
 return db.transaction(async()=>{
  await allowed(db,id,account);
  await db.lock('globe:'+address);
  if(input.enabled!==undefined){
   if(typeof input.enabled!=='boolean')throw Object.assign(Error('Choose whether to share your country.'),{status:400});
   await db.prepare('INSERT INTO globe_connection_preferences VALUES($1,$2) ON CONFLICT(address) DO UPDATE SET enabled=excluded.enabled').run(address,input.enabled);
   if(!input.enabled)await db.prepare('UPDATE globe_conversation_members SET country=NULL WHERE address=$1').run(address);
  }
  const enabled=(await db.prepare('SELECT enabled FROM globe_connection_preferences WHERE address=$1').get(address))?.enabled===true;
  let country=null;try{country=ip&&lookup(ip);}catch{}if(!/^[A-Z]{2}$/.test(country||''))country=null;
  await db.prepare('DELETE FROM globe_conversation_presence WHERE seen<=$1').run(now-65000);
  if(input.active===true){
   await db.prepare(`INSERT INTO globe_conversation_members VALUES($1,$2,$3,$4) ON CONFLICT(question_id,address)
    DO UPDATE SET country=CASE WHEN $5::boolean THEN COALESCE(excluded.country,globe_conversation_members.country) ELSE NULL END`).run(id,address,enabled?country:null,now,enabled);
   await db.prepare('INSERT INTO globe_conversation_presence VALUES($1,$2,$3,$4) ON CONFLICT(question_id,address,session_hash) DO UPDATE SET seen=excluded.seen').run(id,address,session,now);
  }else await db.prepare('DELETE FROM globe_conversation_presence WHERE question_id=$1 AND address=$2 AND session_hash=$3').run(id,address,session);
  const rows=await db.prepare(`SELECT p.nickname,m.address=$2 AS mine,
   CASE WHEN pref.enabled THEN m.country ELSE NULL END AS country,
   (SELECT json_build_object('id',l.file_id) FROM content_file_links l WHERE l.avatar_owner=m.address) AS avatar,
   EXISTS(SELECT 1 FROM globe_conversation_presence g WHERE g.question_id=m.question_id AND g.address=m.address AND g.seen>$3 AND (
    EXISTS(SELECT 1 FROM sessions s WHERE s.token_hash=g.session_hash AND s.address=g.address AND s.expires>$4)
    OR EXISTS(SELECT 1 FROM passkey_sessions s JOIN passkey_credentials c ON c.id=s.credential_id AND c.account_id=s.account_id
     JOIN passkey_community_accounts a ON a.account_id=s.account_id WHERE s.token_hash=g.session_hash AND a.address=g.address AND s.expires>$4 AND c.revoked_at IS NULL)
   )) AS online
   FROM globe_conversation_members m JOIN profiles p ON p.address=m.address
   LEFT JOIN globe_connection_preferences pref ON pref.address=m.address
   WHERE m.question_id=$1 AND NOT EXISTS(SELECT 1 FROM blocked_members b WHERE (b.owner=$2 AND b.target=m.address) OR (b.target=$2 AND b.owner=m.address))
   ORDER BY m.first_seen,m.address`).all(id,address,now-65000,now);
  const participants=rows.filter(r=>r.country),counts=new Map();for(const r of participants)counts.set(r.country,(counts.get(r.country)||0)+1);
  return {enabled,viewerCountry:country,participants,online:rows.filter(r=>r.online),countries:[...counts].map(([country,count])=>({country,count})),sharingOnline:participants.length,updatedAt:now,approximate:true};
 });
}
