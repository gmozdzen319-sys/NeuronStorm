import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {createQuestion,replyToThread} from '../threads.mjs';
import {debate} from '../debate.mjs';
import {conversationGlobe} from '../conversation-globe.mjs';
async function fixture(t){
 const database='conversation-globe-'+randomUUID(),app=await createApp({database});t.after(()=>app.close());const {db}=app,now=Date.now();
 const users=[1,2,3].map(n=>({address:'0x'+String(n).padStart(40,'0'),role:'member'}));
 for(const [i,u] of users.entries()){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(u.address,now);await saveProfile(db,u.address,{nickname:'Member '+i,work:[i===2?'Unrelated':'Mechanic'],hobbies:[]},now);await db.prepare('INSERT INTO sessions VALUES($1,$2,$3)').run('session'+i,u.address,now+3600000);}
 const category=await db.prepare("SELECT id FROM categories WHERE name='Mechanic'").get();
 const q=await createQuestion(db,users[0],{body:'Conversation',categoryIds:[category.id]},now),other=await createQuestion(db,users[0],{body:'Other conversation',categoryIds:[category.id]},now);
 const read=(i,input={},at=now,session='session'+i)=>conversationGlobe(db,users[i],session,'8.8.8.8',{questionId:q.id,active:true,...input},at,()=>i?'PL':'GB');
 return {...app,database,users,now,q,other,read};
}
test('Globe is conversation-scoped; new sharing is explicit and never inherits anonymous consent',async t=>{
 const f=await fixture(t);await f.db.prepare('INSERT INTO globe_preferences VALUES($1,1)').run(f.users[0].address);
 let r=await f.read(0);assert.equal(r.enabled,false);assert.equal(r.participants.length,0);assert.equal(r.online.length,1);
 await f.read(1,{enabled:true});r=await f.read(0,{enabled:true});assert.equal(r.participants.length,2);assert.equal(r.online.length,2);
 assert(!JSON.stringify(r).includes('session'));assert(!JSON.stringify(r).includes(f.users[1].address));assert(!JSON.stringify(r).includes('8.8.8.8'));
 await assert.rejects(f.read(2),e=>e.status===404);
 r=await f.read(0,{questionId:f.other.id});assert.equal(r.participants.length,1);assert.equal(r.online.length,1);
 await f.db.prepare('INSERT INTO blocked_members(id,owner,target) VALUES($1,$2,$3)').run(randomUUID(),f.users[0].address,f.users[1].address);
 r=await f.read(0);assert.equal(r.participants.length,1);assert.equal(r.online.length,1);
});
test('Answers and Debate participants remain after logout; online respects expiry and every device session',async t=>{
 const f=await fixture(t);await f.read(0,{enabled:true});await f.read(1,{enabled:true});
 await replyToThread(f.db,f.users[1],f.q.id,{body:'An answer'},f.now);
 await debate(f.db,f.users[1],f.q.id,'session1',new URLSearchParams(),{body:'Debate contribution',clientId:randomUUID()},f.now);
 await f.db.prepare('DELETE FROM sessions WHERE token_hash=$1').run('session1');
 let r=await f.read(0);assert.equal(r.participants.length,2);assert.equal(r.online.length,1);assert.equal(r.participants.find(p=>p.nickname==='Member 1').online,false);
 await f.db.prepare('INSERT INTO sessions VALUES($1,$2,$3)').run('second-device',f.users[1].address,f.now+3600000);
 await f.read(1,{},f.now,'second-device');r=await f.read(0);assert.equal(r.online.length,2);
 r=await f.read(0,{},f.now+65001);assert.equal(r.online.length,1);assert.equal(r.participants.length,2);
 await f.read(1,{active:false},f.now+65002,'second-device');r=await f.read(0,{},f.now+65002);assert.equal(r.participants.length,2);
 const second=await createApp({database:f.database});t.after(()=>second.close());
 const restored=await conversationGlobe(second.db,f.users[0],'session0',null,{questionId:f.q.id,active:true},f.now+65003,()=>null);
 assert.equal(restored.participants.length,2);assert.equal(restored.participants.find(p=>p.mine).country,'GB');
});
test('Disabling sharing clears all saved countries; presence is retained without inventing locations',async t=>{
 const f=await fixture(t);await f.read(0,{enabled:true});await f.read(0,{questionId:f.other.id});
 await f.read(0,{enabled:false});assert.equal((await f.db.prepare('SELECT count(*) AS n FROM globe_conversation_members WHERE country IS NOT NULL').get()).n,0);
 const r=await conversationGlobe(f.db,f.users[0],'session0',null,{questionId:f.q.id,active:true,enabled:true},f.now,()=>null);
 assert.equal(r.participants.length,0);assert.equal(r.online.length,1);
 await assert.rejects(f.read(0,{enabled:'true'}),e=>e.status===400);
});
test('Passkey online presence requires a live session and non-revoked credential',async t=>{
 const f=await fixture(t),address=f.users[1].address;
 await f.db.prepare("INSERT INTO passkey_accounts VALUES('pk','handle',$1,NULL,'example.test','https://example.test')").run(f.now);
 await f.db.prepare("INSERT INTO passkey_credentials VALUES('key','pk','public',0,'test',false,$1,NULL,NULL)").run(f.now);
 await f.db.prepare("INSERT INTO passkey_community_accounts VALUES('pk',$1)").run(address);
 await f.db.prepare("INSERT INTO passkey_sessions VALUES('pk-session','pk','key',$1)").run(f.now+1000);
 await f.read(1,{enabled:true},f.now,'pk-session');let r=await f.read(0);assert.equal(r.online.length,2);
 await f.db.prepare("UPDATE passkey_credentials SET revoked_at=$1 WHERE id='key'").run(f.now+1);
 r=await f.read(0,{},f.now+2);assert.equal(r.online.length,1);assert.equal(r.participants.find(p=>p.nickname==='Member 1').online,false);
});
