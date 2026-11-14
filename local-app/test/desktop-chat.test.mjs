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
