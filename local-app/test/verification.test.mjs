import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp,ADMIN} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {createQuestion,replyToThread} from '../threads.mjs';
import {debate,voteOnDebate} from '../debate.mjs';
import {verificationFields,debateFields,VERIFICATION_WAIT} from '../verification.mjs';
import {reputation} from '../reputation.mjs';
import {createHash} from 'node:crypto';
import http from 'node:http';
async function fixture(t){
 const app=await createApp();t.after(()=>app.close());const {db}=app,now=Date.now();
 const accounts=[1,2,3].map(n=>({address:'0x'+String(n).padStart(40,'0'),role:'member'}));
 for(const [i,a] of accounts.entries()){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(a.address,now);await saveProfile(db,a.address,{nickname:'Member '+i,work:i===0?['Driving']:['Mechanic'],hobbies:i===0?[]:['Cooking']},now);}
 const categories=await db.prepare("SELECT id FROM categories WHERE name IN('Mechanic','Cooking') ORDER BY id").all();
 const q=await createQuestion(db,accounts[0],{body:'Technical discussion',categoryIds:categories.map(c=>c.id)},now);
 const fields=await debateFields(db,q.id),mechanic=fields.find(f=>f.name==='Mechanic').id,cooking=fields.find(f=>f.name==='Cooking').id;
 const post=async(a=accounts[1],fieldId=mechanic,time=now)=>{const clientId=randomUUID();await debate(db,a,q.id,'session',new URLSearchParams(),{body:'Contribution',clientId,fieldId},time);return (await db.prepare('SELECT id FROM debate_messages WHERE client_id=$1').get(clientId)).id;};
 const score=async(a=accounts[1],admin=false)=>(await verificationFields(db,a.address,now,{admin}));
 return {...app,accounts,now,q:q.id,mechanic,cooking,post,score};
}
test('Verification is separate; waiting votes never mature retroactively, repeated votes stay idempotent',async t=>{
 const f=await fixture(t),[,author,voter]=f.accounts,m=await f.post();
 await voteOnDebate(f.db,voter,f.q,m,{value:1},f.now);
 assert.equal((await f.score()).find(x=>x.id===f.mechanic).net,0);
 assert.equal((await reputation(f.db,author.address,f.now)).units,25);
 await voteOnDebate(f.db,voter,f.q,m,{value:1},f.now+VERIFICATION_WAIT);
 assert.equal((await f.score()).find(x=>x.id===f.mechanic).net,0);
 await voteOnDebate(f.db,voter,f.q,m,{value:-1},f.now+VERIFICATION_WAIT+1);
 let score=(await f.score()).find(x=>x.id===f.mechanic);assert.equal(score.net,-1);assert.equal(score.percent,0);
 await voteOnDebate(f.db,voter,f.q,m,{value:0},f.now+VERIFICATION_WAIT+2);
 await Promise.all(Array.from({length:4},()=>voteOnDebate(f.db,voter,f.q,m,{value:1},f.now+VERIFICATION_WAIT+3)));
 score=(await f.score()).find(x=>x.id===f.mechanic);assert.equal(score.net,1);assert.equal(score.percent,3.33);
 assert.equal((await f.score()).find(x=>x.id===f.cooking).net,0);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM verification_events').get()).n,4);
 await assert.rejects(f.db.exec('DELETE FROM verification_events'),/append-only/);
});
test('Author without topic can participate but cannot rate or earn verification; fields cannot be forged',async t=>{
 const f=await fixture(t),[questioner,author,voter]=f.accounts,m=await f.post(),outsiderMessage=await f.post(questioner,null);
 await assert.rejects(voteOnDebate(f.db,questioner,f.q,m,{value:1},f.now+VERIFICATION_WAIT),e=>e.status===403);
 await voteOnDebate(f.db,voter,f.q,outsiderMessage,{value:1},f.now+VERIFICATION_WAIT);
 assert(!(await f.score(questioner)).some(x=>x.id===f.mechanic));
 const view=await debate(f.db,questioner,f.q,'s',new URLSearchParams(),null,f.now+VERIFICATION_WAIT);
 assert.equal(view.messages.find(x=>x.id===m).canVote,false);assert.equal(view.messages.find(x=>x.id===outsiderMessage).verification,null);
 assert.equal(view.messages.find(x=>x.id===m).verification.name,'Mechanic');
 assert.equal(view.followUp,true);assert.equal(view.messages.find(x=>x.id===outsiderMessage).followUp,true);
 await assert.rejects(f.post(questioner,f.mechanic),e=>e.status===403);
 await assert.rejects(f.post(author,999999),e=>e.status===400);
 await assert.rejects(voteOnDebate(f.db,author,f.q,m,{value:1},f.now),e=>e.status===403);
});
test('30 votes by the same peer across contributions automatically verify; removal/re-add preserves history and achievement',async t=>{
 const f=await fixture(t),[,author,voter]=f.accounts,time=f.now+VERIFICATION_WAIT,messages=[];
 for(let i=0;i<30;i++){const m=await f.post(author,f.mechanic,time);messages.push(m);await voteOnDebate(f.db,voter,f.q,m,{value:1},time);}
 let score=(await f.score(author,true)).find(x=>x.id===f.mechanic);assert.equal(score.percent,100);assert.equal(score.verified,true);assert.equal(score.achievedAt,time);
 await voteOnDebate(f.db,voter,f.q,messages[0],{value:-1},time+1);
 score=(await f.score(author,true)).find(x=>x.id===f.mechanic);assert.equal(score.net,28);assert.equal(score.verified,false);assert.equal(score.achievedAt,time);
 await saveProfile(f.db,author.address,{nickname:'Member',work:[],hobbies:['Cooking']},time+2);assert(!(await f.score()).some(x=>x.id===f.mechanic));
 await saveProfile(f.db,author.address,{nickname:'Member',work:[' MECHANIC '],hobbies:['Cooking']},time+3);
 const restored=(await f.score(author,true)).find(x=>x.id===f.mechanic);assert.equal(restored.net,28);assert.equal(restored.firstSeen,f.now);assert.equal(restored.achievedAt,time);
 await saveProfile(f.db,author.address,{nickname:'Member',work:[],hobbies:['Mechanic','Cooking']},time+4);
 assert.equal((await f.score()).find(x=>x.id===f.mechanic).net,28);
 await replyToThread(f.db,author,f.q,{body:'Formal answer'},time+5);assert.equal((await f.score()).find(x=>x.id===f.mechanic).net,28);
});
test('New fields have independent clocks; expired waiting survives removal and field relocation',async t=>{
 const f=await fixture(t),[,author,voter]=f.accounts,time=f.now+VERIFICATION_WAIT;
 await saveProfile(f.db,voter.address,{nickname:'Voter',work:['Mechanic','New field'],hobbies:['Cooking']},time);
 let fields=await verificationFields(f.db,voter.address,time,{admin:true});assert.equal(fields.find(x=>x.name==='Mechanic').waiting,false);assert.equal(fields.find(x=>x.name==='New field').waiting,true);
 await saveProfile(f.db,voter.address,{nickname:'Voter',work:['New field'],hobbies:[]},time+1);
 await saveProfile(f.db,voter.address,{nickname:'Voter',work:['New field'],hobbies:['m e c h a n i c']},time+2);
 fields=await verificationFields(f.db,voter.address,time+2,{admin:true});const restored=fields.find(x=>x.id===f.mechanic);assert.equal(restored.firstSeen,f.now);assert.equal(restored.waiting,false);
 const m=await f.post(author,f.mechanic,time+3);await voteOnDebate(f.db,voter,f.q,m,{value:1},time+4);assert.equal((await f.score()).find(x=>x.id===f.mechanic).net,1);
});
test('Selected topic is immutable on replay and must belong to both author profile and debate',async t=>{
 const f=await fixture(t),[,author]=f.accounts,clientId=randomUUID(),input={body:'Specific contribution',clientId,fieldId:f.mechanic};
 await debate(f.db,author,f.q,'s',new URLSearchParams(),input,f.now);
 await debate(f.db,author,f.q,'s',new URLSearchParams(),input,f.now+1);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM debate_messages WHERE client_id=$1').get(clientId)).n,1);
 await assert.rejects(debate(f.db,author,f.q,'s',new URLSearchParams(),{...input,fieldId:f.cooking},f.now+2),e=>e.status===409);
 await saveProfile(f.db,author.address,{nickname:'Member',work:['Mechanic'],hobbies:[]},f.now+3);
 await assert.rejects(f.post(author,f.cooking,f.now+4),e=>e.status===403);
 const result=await debate(f.db,author,f.q,'s',new URLSearchParams(),null,f.now+4);assert.deepEqual(result.fields.map(f=>f.id),[f.mechanic]);
});
test('Private waiting/history is admin-only over HTTP; ordinary profile and Debate never expose it',async t=>{
 const f=await fixture(t),[,author]=f.accounts;await f.post();
 const token='b'.repeat(64),hash=createHash('sha256').update(token).digest('hex');await f.db.prepare('INSERT INTO sessions VALUES($1,$2,$3)').run(hash,author.address,f.now+3600000);
 await new Promise(r=>f.server.listen(0,'127.0.0.1',r));
 const get=path=>new Promise((resolve,reject)=>http.get({hostname:'127.0.0.1',port:f.server.address().port,path,headers:{Host:'localhost:3000',Cookie:'ns_session='+token}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(body)}));}).on('error',reject));
 assert.equal((await get('/api/admin/verification?member='+author.address)).status,403);
 for(const path of ['/api/profile','/api/questions/'+f.q+'/debate']){const result=await get(path);assert.equal(result.status,200);assert(!/waiting|firstSeen|achievedAt|dateSource/.test(JSON.stringify(result.data)));}
 await f.db.prepare('INSERT INTO accounts VALUES($1,$2)').run(ADMIN,f.now);await saveProfile(f.db,ADMIN,{nickname:'Admin',work:['Mechanic'],hobbies:[]},f.now);await f.db.prepare('UPDATE sessions SET address=$1 WHERE token_hash=$2').run(ADMIN,hash);
 const admin=await get('/api/admin/verification?member='+author.address);assert.equal(admin.status,200);assert.equal(admin.data.fields.length,2);assert.equal(admin.data.fields[0].waiting,true);
});
test('Single-topic contributions are assigned automatically; legacy messages never gain a topic retroactively',async t=>{
 const f=await fixture(t),[questioner,author,voter]=f.accounts;
 const category=await f.db.prepare("SELECT id FROM categories WHERE name='Mechanic' AND kind='work'").get();
 const q=await createQuestion(f.db,questioner,{body:'One topic',categoryIds:[category.id]},f.now);
 const result=await debate(f.db,author,q.id,'s',new URLSearchParams(),{body:'Automatic topic',clientId:randomUUID()},f.now);
 assert.equal(result.messages[0].verification.id,f.mechanic);assert.equal(result.fields.length,1);
 const old=await f.db.prepare('INSERT INTO debate_messages(question_id,author,body,client_id,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id').get(f.q,author.address,'Legacy contribution',randomUUID(),f.now);
 await voteOnDebate(f.db,voter,f.q,old.id,{value:1},f.now+VERIFICATION_WAIT);
 assert.equal((await f.score()).find(x=>x.id===f.mechanic).net,0);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM verification_events WHERE message_id=$1').get(old.id)).n,0);
});
test('Field registration and removed-topic history survive application restart',async t=>{
 const database='verification-restart-'+randomUUID(),address='0x'+ '8'.repeat(40),now=Date.now();
 const first=await createApp({database});
 await first.db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,now);
 await saveProfile(first.db,address,{nickname:'Persistent',work:['Mechanic'],hobbies:[]},now);
 const before=await verificationFields(first.db,address,now,{admin:true});
 await saveProfile(first.db,address,{nickname:'Persistent',work:['Cooking'],hobbies:[]},now+1);
 await first.close();
 const second=await createApp({database});t.after(()=>second.close());
 await saveProfile(second.db,address,{nickname:'Persistent',work:['MECHANIC'],hobbies:[]},now+VERIFICATION_WAIT);
 const after=await verificationFields(second.db,address,now+VERIFICATION_WAIT,{admin:true});
 assert.equal(after.find(x=>x.id===before[0].id).firstSeen,now);
 assert.equal(after.find(x=>x.id===before[0].id).waiting,false);
 assert.equal(after.find(x=>x.name==='Cooking').active,false);
});
