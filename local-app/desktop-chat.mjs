import {requireProfile} from './threads.mjs';
import {publicFields} from './public-profile.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
export async function desktopChat(db,account,req,path,input,now){
 if(req.headers['x-ns-desktop-chat']!=='1'||req.headers['sec-fetch-site']||req.headers.origin)throw fail(403,'Open Chat in Neuron Storm Desktop.');
 await requireProfile(db,account);
 const owner=account.address.toLowerCase();
 if(path==='/api/desktop-chat' && req.method==='POST'){
  const message=typeof input?.text==='string'?input.text.trim():'';
  if(!message||Array.from(message).length>1000||!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(input?.requestId||''))throw fail(400,'Enter a message of up to 1,000 characters.');
  await db.transaction(async()=>{
   await db.prepare('SELECT address FROM profiles WHERE address=$1 FOR UPDATE').get(owner);
   if(await db.prepare('SELECT id FROM desktop_chat_messages WHERE author=$1 AND request_id=$2').get(owner,input.requestId))return;
   if(await db.prepare('SELECT id FROM desktop_chat_messages WHERE author=$1 AND created_at>$2 LIMIT 1').get(owner,now-2000))throw fail(429,'Wait a moment before sending again.');
   await db.prepare('INSERT INTO desktop_chat_messages(author,request_id,body,created_at) VALUES($1,$2,$3,$4)').run(owner,input.requestId,message,now);
  });
  return {ok:true};
 }
 if(req.method==='GET'&&path==='/api/desktop-chat'){
  const messages=await db.prepare(`SELECT m.id,m.body,m.created_at AS "createdAt",p.nickname,
   (SELECT json_build_object('id',l.file_id) FROM content_file_links l WHERE l.avatar_owner=m.author) AS avatar
   FROM desktop_chat_messages m JOIN profiles p ON p.address=m.author
   WHERE NOT EXISTS(SELECT 1 FROM blocked_members b WHERE
    (b.owner=$1 AND b.target=m.author) OR (b.target=$1 AND b.owner=m.author))
   ORDER BY m.id DESC LIMIT 100`).all(owner);
  return {messages:messages.reverse()};
 }
 const match=/^\/api\/desktop-chat\/profile\/([1-9]\d{0,14})$/.exec(path);
 if(req.method==='GET'&&match){
  const row=await db.prepare('SELECT author FROM desktop_chat_messages WHERE id=$1').get(match[1]);
  if(row)return {profile:await publicFields(db,account,row.author)};
 }
 throw fail(404,'Not found.');
}
