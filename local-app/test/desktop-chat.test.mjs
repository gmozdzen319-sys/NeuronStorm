import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from './database.mjs';
import {desktopChat} from '../desktop-chat.mjs';
test('desktop members chat, retry safely and inspect only public profiles',async()=>{
 const {db}=await createApp();try{
 const base='/api/desktop-chat',a={address:'0x'+'1'.repeat(40)},b={address:'0x'+'2'.repeat(40)};
 for(const [user,name] of [[a,'Alice'],[b,'Bob']]){
 await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(user.address,1);
 await db.prepare('INSERT INTO profiles(address,nickname,updated_at) VALUES($1,$2,1)').run(user.address,name);
 }
 const call=(account,method='GET',input=null,path=base,extra={})=>desktopChat(db,account,{method,headers:{'x-ns-desktop-chat':'1',...extra}},path,input,10000);
 await assert.rejects(call(null),e=>e.status===401);
 await assert.rejects(call(a,'GET',null,base,{'sec-fetch-site':'same-origin'}),e=>e.status===403);
 const post={requestId:randomUUID(),text:' Hello '};
 await call(a,'POST',post);await call(a,'POST',post);
 await assert.rejects(call(a,'POST',{...post,requestId:randomUUID()}),e=>e.status===429);
 const {messages}=await call(b);assert.equal(messages.length,1);assert.equal(messages[0].body,'Hello');assert.equal(messages[0].nickname,'Alice');assert.equal(messages[0].author,undefined);
 const path=base+'/profile/'+messages[0].id, {profile}=await call(b,'GET',null,path);
 assert.equal(profile.nickname,'Alice');assert.equal(profile.address,undefined);
 await db.prepare('INSERT INTO blocked_members VALUES($1,$2,$3)').run(randomUUID(),b.address,a.address);
 assert.deepEqual((await call(b)).messages,[]);await assert.rejects(call(b,'GET',null,path),e=>e.status===404);
 }finally{await db.close();}
});
test('online list includes silent Desktop members and respects expiry, multiple devices, blocks and logout',async()=>{
 const {db}=await createApp();try{
 const a={method:'passkey',id:'a',address:'alice'},b={method:'passkey',id:'b',address:'bob'};
 for(const u of [a,b]){
  await db.prepare('INSERT INTO accounts VALUES($1,1)').run(u.address);
  await db.prepare('INSERT INTO profiles(address,nickname,updated_at) VALUES($1,$1,1)').run(u.address);
  await db.prepare("INSERT INTO passkey_accounts VALUES($1,$1,1,NULL,'rp','origin')").run(u.id);
  await db.prepare("INSERT INTO passkey_credentials VALUES($1,$1,'public',0,'device',false,1,NULL,NULL)").run(u.id);
 }
 for(const session of ['b1','b2'])await db.prepare("INSERT INTO passkey_sessions VALUES($1,'b','b',200000)").run(session);
 const base='/api/desktop-chat';
 const call=(user,path=base,now=10000,session)=>desktopChat(db,user,{method:session?'POST':'GET',headers:{'x-ns-desktop-chat':'1'}},path,null,now,session);
 for(const session of ['b1','b2'])await call(b,base+'/presence',10000,session);
 const room=await call(a);assert.equal(room.messages.length,0);assert.equal(room.online.length,1);
 assert.equal(room.online[0].nickname,'bob');assert.equal(room.online[0].address,undefined);
 const profile=base+'/member/'+room.online[0].id;
 assert.equal((await call(a,profile)).profile.nickname,'bob');
 assert.equal((await call(a,base,55001)).online.length,0);
 await db.prepare('INSERT INTO blocked_members VALUES($1,$2,$3)').run(randomUUID(),a.address,b.address);
 assert.equal((await call(a)).online.length,0);await assert.rejects(call(a,profile),e=>e.status===404);
 await db.prepare('DELETE FROM blocked_members WHERE owner=$1').run(a.address);
 await db.prepare('DELETE FROM passkey_sessions WHERE account_id=$1').run('b');
 assert.equal((await call(a)).online.length,0);
 }finally{await db.close();}
});
