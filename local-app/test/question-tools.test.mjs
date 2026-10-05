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
test('blocking filters recipients in both directions, prevents replies and hides Debate while retaining formal history',async t=>{
 const {db,accounts:a,ids,now}=(await fixture(t)),q=(await createQuestion(db,a[0],{body:'Question',categoryIds:ids},now)).id;
 (await replyToThread(db,a[1],q,{body:'Earlier answer'},now+1));const r=(await readThread(db,a[0],q)).replies[0];(await debate(db,a[1],q,'session',new URLSearchParams(),{body:'Hello',clientId:'a'.repeat(36)},now));
 const result=(await blocks(db,a[0],{action:'add',questionId:q,replyId:r.id}));assert.equal(result.members.length,1);assert.equal(JSON.stringify(result).includes(a[1].address),false);
 assert.equal((await previewQuestion(db,a[0],{body:'New',categoryIds:ids})).recipientCount,1);assert.equal((await previewQuestion(db,a[1],{body:'New',categoryIds:ids})).recipientCount,1);
 assert.equal((await readThread(db,a[0],q)).replies.length,1);assert.equal((await debate(db,a[0],q,'session',new URLSearchParams(),null,now)).messages.length,0);
 await assert.rejects(async ()=>(await debate(db,a[1],q,'session',new URLSearchParams(),{body:'Again',clientId:'b'.repeat(36)},now)),e=>e.status===403);
 await assert.rejects(async ()=>(await blocks(db,a[3],{action:'add',questionId:q})),e=>e.status===404);
 (await blocks(db,a[2],{action:'remove',id:result.members[0].id}));assert.equal((await blocks(db,a[0])).members.length,1);
 (await blocks(db,a[0],{action:'remove',id:result.members[0].id}));assert.equal((await previewQuestion(db,a[0],{body:'New',categoryIds:ids})).recipientCount,2);
});
test('deadline reminders are one-time, private, readable and disappear when a question expires',async t=>{
 const {db,accounts:a,ids,now}=(await fixture(t)),q=(await createQuestion(db,a[0],{body:'Question',categoryIds:ids},now)).id;
 (await remindDeadlines(db,now+6*86400000-1));assert.equal((await db.prepare("SELECT count(*) AS n FROM deadline_reminders").get()).n,0);
 (await remindDeadlines(db,now+6*86400000));(await remindDeadlines(db,now+6*86400000+1));const data=(await listNotifications(db,a[0],new URLSearchParams())),reminder=data.notifications.find(n=>n.kind==='deadline');assert.equal(data.throughReminderId,1);assert.ok(reminder);assert.equal((await listNotifications(db,a[1],new URLSearchParams())).notifications.some(n=>n.kind==='deadline'),false);
 await assert.rejects(async ()=>(await readNotifications(db,a[1],{id:reminder.id},false,now)));(await readNotifications(db,a[0],{id:reminder.id},false,now));assert.equal((await listNotifications(db,a[0],new URLSearchParams())).unread,0);
 (await expireQuestions(db,now+7*86400000));assert.equal((await listNotifications(db,a[0],new URLSearchParams())).notifications.length,0);
});
