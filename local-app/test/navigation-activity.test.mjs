import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {saveProfile,readCategories} from '../profiles.mjs';
import {createQuestion,previewQuestion,readThread,replyToThread} from '../threads.mjs';
import {blocks,remindDeadlines} from '../contact-preferences.mjs';
import {acceptAnswer,expireQuestions} from '../lifecycle.mjs';
import {debate} from '../debate.mjs';
import {listNotifications,readNotifications} from '../notifications.mjs';
async function fixture(t){const app=(await createApp({database:':memory:'})),{db}=app; t.after(async ()=>(await db.close()));const now=Date.now(),accounts=[1,2,3,4].map(n=>({address:'0x00'+String(n).repeat(38),role:'member'}));for(const [i,a] of accounts.entries()){(await db.prepare("INSERT INTO accounts VALUES($1,$2)").run(a.address,now));(await saveProfile(db,a.address,{nickname:'Person '+i,work:[i===3?'Other':'Travel'],hobbies:[]},now));}return {...app,now,accounts,ids:[(await readCategories(db)).work.find(c=>c.name==='Travel').id]};}
test('navigation alerts are private, independent of pagination, and clear when read',async t=>{
 const {db,accounts:a,ids,now}=await fixture(t);
 const q=(await createQuestion(db,a[0],{body:'Question',categoryIds:ids},now)).id;
 const list=u=>listNotifications(db,u,new URLSearchParams('page=2'),now);
 assert.deepEqual((await list(a[1])).navActivity,{inbox:true,mine:false});
 assert.deepEqual((await list(a[3])).navActivity,{inbox:false,mine:false});
 assert.deepEqual((await list(a[0])).navActivity,{inbox:false,mine:false});
 await replyToThread(db,a[1],q,{body:'Answer'},now+1);
 assert.equal((await list(a[0])).navActivity.mine,true);
 assert.equal((await list(a[2])).navActivity.mine,false);
 const result=await list(a[0]);await readNotifications(db,a[0],{throughId:result.throughId},true,now+2);
 assert.equal((await list(a[0])).navActivity.mine,false);
 const incoming=await list(a[1]);await readNotifications(db,a[1],{throughId:incoming.throughId},true,now+2);
 assert.equal((await list(a[1])).navActivity.inbox,false);
});

test('busy debate highlights only its owner, expires, and excludes blocked authors and closed threads',async t=>{
 const {db,accounts:a,ids,now}=await fixture(t);
 const q=(await createQuestion(db,a[0],{body:'Busy question',categoryIds:ids},now)).id;
 const state=(u,time=now+10)=>listNotifications(db,u,new URLSearchParams(),time);
 for(let i=0;i<3;i++)await debate(db,a[1],q,'test',new URLSearchParams(),{body:'Message '+i,clientId:String(i).repeat(36)},now+i);
 assert.equal((await state(a[0])).navActivity.mine,true);
 assert.equal((await state(a[2])).navActivity.mine,false);
 assert.equal((await state(a[0],now+300010)).navActivity.mine,false);
 // Direct fixture state to verify exclusion irrespective of UI block controls.
 await db.prepare('INSERT INTO blocked_members(id,owner,target) VALUES($3,$1,$2) ON CONFLICT DO NOTHING').run(a[0].address,a[1].address,'test-block');
 assert.equal((await state(a[0])).navActivity.mine,false);
 await db.prepare('DELETE FROM blocked_members').run();
 await db.prepare('UPDATE questions SET closed_at=$2 WHERE id=$1').run(q,now+5);
 assert.equal((await state(a[0])).navActivity.mine,false);
});
