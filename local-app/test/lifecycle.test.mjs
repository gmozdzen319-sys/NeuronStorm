import {rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'quais';
import {createApp} from './database.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
import {createQuestion,replyToThread,readThread,listQuestions,voteOnReply,markThreadRead} from '../threads.mjs';
import {prepareAction,submitAction} from '../actions.mjs';
import {QUESTION_LIFETIME,expireQuestions,acceptedAnswers} from '../lifecycle.mjs';
import {moderateThread} from '../admin.mjs';
import {debate} from '../debate.mjs';
import {countdown} from '../public/lifecycle-ui.js';
async function fixture(t){
  const {db}=(await createApp({database:':memory:'}));t.after(async ()=>(await db.close()));const now=Date.UTC(2026,9,3,12);
  const wallets=[...[1,2,3].map(()=>new Wallet(randomBytes(32).toString('hex')))],accounts=wallets.map(w=>({address:w.address.toLowerCase(),role:'member'}));
  (await Promise.all(accounts.map(async (a,i)=>{(await db.prepare("INSERT INTO accounts VALUES($1,$2)").run(a.address.toLowerCase(),now));(await saveProfile(db,a.address,{nickname:['Asker','First','Second'][i],work:['Lighting'],hobbies:[]},now));})));
  const categoryId=(await db.prepare("SELECT id FROM categories").get()).id,id=(await createQuestion(db,accounts[0],{body:'Which lamp?',categoryId},now)).id;
  (await replyToThread(db,accounts[1],id,{body:'Warm task lights.'},now+1000));(await replyToThread(db,accounts[2],id,{body:'Dimmable lights.'},now+2000));
  const replies=(await readThread(db,accounts[0],id)).replies;return {db,now,wallets,accounts,id,replies,categoryId};
}
test('author acceptance verifies signed question, reply version, wallet and session; retries close once',async t=>{
  const {db,now,wallets,accounts,id,replies}=(await fixture(t)),[a,b]=accounts,path='/api/questions/'+id+'/accept';
  const input={replyId:replies[0].id,version:1};
  await assert.rejects(async ()=>(await prepareAction(db,b,'s',path,input,'https://test',now+3000)),e=>e.status===403);
  const challenge=(await prepareAction(db,a,'session',path,input,'https://test',now+3000));
  assert.match(challenge.message,/Which lamp/);assert.match(challenge.message,/Warm task lights/);assert.match(challenge.message,/cannot be undone/);
  const signed={actionId:challenge.id,signature:await wallets[0].signMessage(challenge.message)};
  await assert.rejects(async ()=>(await submitAction(db,a,'another',path,signed,now+4000)),e=>e.status===403);
  await assert.rejects(async ()=>(await submitAction(db,a,'session',path,{...signed,signature:'bad'},now+4000)),e=>e.status===403);
  const result=(await submitAction(db,a,'session',path,{...signed,replyId:replies[1].id},now+4000));
  assert.equal(result.closed,true);assert.deepEqual((await submitAction(db,a,'session',path,signed,now+5000)),result);
  assert.equal((await expireQuestions(db,now+QUESTION_LIFETIME)),0);
  const accepted=(await acceptedAnswers(db,new URLSearchParams())).answers;
  assert.equal(accepted.length,1);assert.equal(accepted[0].answer,'Warm task lights.');assert.equal(accepted[0].selection,'author');assert.equal(accepted[0].walletAddress,b.address.toLowerCase());
  assert.equal((await listQuestions(db,a,'mine')).length,0);
  await assert.rejects(async ()=>(await readThread(db,b,id)),e=>e.status===404);
  await assert.rejects(async ()=>(await replyToThread(db,a,id,{body:'Late'},now+5000)),e=>e.status===404);
  await assert.rejects(async ()=>(await voteOnReply(db,a,id,replies[0].id,{value:1},now+5000)),e=>e.status===404);
  await assert.rejects(async ()=>(await debate(db,a,id,'s',new URLSearchParams(),null,now+5000)),e=>e.status===404);
  await assert.rejects(async ()=>(await moderateThread(db,{...a,role:'admin'},id,'restore',{confirmation:id},now+5000)),e=>e.status===409);
});
test('acceptance rejects a changed, deleted or foreign answer, and cannot be sent after deadline',async t=>{
  const {db,now,wallets,accounts,id,replies}=(await fixture(t)),a=accounts[0],path='/api/questions/'+id+'/accept',input={replyId:replies[0].id,version:1};
  const c=(await prepareAction(db,a,'s',path,input,'https://test',now+QUESTION_LIFETIME-1000)),signed={actionId:c.id,signature:await wallets[0].signMessage(c.message)};
  await assert.rejects(async ()=>(await submitAction(db,a,'s',path,signed,now+QUESTION_LIFETIME)),e=>e.status===409);
  (await db.prepare("UPDATE replies SET version=2 WHERE id=$1").run(input.replyId));
  await assert.rejects(async ()=>(await submitAction(db,a,'s',path,signed,now+QUESTION_LIFETIME-500)),e=>e.status===409);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM accepted_answers").get()).n,0);
  (await db.prepare("UPDATE replies SET deleted_at=$1 WHERE id=$2").run(now,input.replyId));
  await assert.rejects(async ()=>(await prepareAction(db,a,'s',path,input,'https://test',now)),e=>e.status===404);
  await assert.rejects(async ()=>(await prepareAction(db,a,'s',path,{replyId:999999,version:1},'https://test',now)),e=>e.status===404);
});
test('expiry selects most upvotes at exactly seven days, preserves stars and is idempotent',async t=>{
  const {db,now,accounts,id,replies}=(await fixture(t));
  (await voteOnReply(db,accounts[0],id,replies[1].id,{value:1},now+3000));
  assert.equal((await expireQuestions(db,now+QUESTION_LIFETIME-1)),0);
  assert.equal((await expireQuestions(db,now+QUESTION_LIFETIME)),1);
  const row=(await acceptedAnswers(db,new URLSearchParams())).answers[0];assert.equal(row.answer,'Dimmable lights.');assert.equal(row.upvotes,1);assert.equal(row.selection,'automatic');
  assert.equal(row.closedAt,now+QUESTION_LIFETIME);assert.equal((await expireQuestions(db,now+QUESTION_LIFETIME+100)),0);
  assert.equal((await readProfile(db,accounts[2].address)).points,1);
});
test('ties including zero votes select earliest eligible reply; no reply closes without recipient',async t=>{
  const {db,now,accounts,id,categoryId}=(await fixture(t));
  const empty=(await createQuestion(db,accounts[0],{body:'No answers?',categoryId},now)).id;
  (await expireQuestions(db,now+QUESTION_LIFETIME+5000));
  const rows=(await acceptedAnswers(db,new URLSearchParams())).answers;
  assert.equal(rows.find(r=>r.questionId===id).answer,'Warm task lights.');
  const noAnswer=rows.find(r=>r.questionId===empty);assert.equal(noAnswer.selection,'unanswered');assert.equal(noAnswer.walletAddress,null);
});
test('moderated or deleted replies never receive automatic rewards',async t=>{
  const {db,now,accounts,id,replies,categoryId}=(await fixture(t));
  (await db.prepare("UPDATE replies SET deleted_at=$1 WHERE id=$2").run(now,replies[0].id));
  const removed=(await createQuestion(db,accounts[0],{body:'Hidden question',categoryId},now)).id;
  (await replyToThread(db,accounts[1],removed,{body:'Hidden answer'},now));
  (await db.prepare("UPDATE questions SET deleted_at=$1 WHERE id=$2").run(now,removed));
  (await expireQuestions(db,now+QUESTION_LIFETIME));
  const rows=(await acceptedAnswers(db,new URLSearchParams())).answers;
  assert.equal(rows.find(r=>r.questionId===id).answer,'Dimmable lights.');
  assert.equal(rows.find(r=>r.questionId===removed).walletAddress,null);
});
test('countdown never goes negative and uses green, yellow, orange and red thresholds',()=>{
  const now=100000;
  assert.equal(countdown(now+QUESTION_LIFETIME,now).text,'7d 00:00:00 left');
  assert.equal(countdown(now+QUESTION_LIFETIME,now).tone,'healthy');
  assert.equal(countdown(now+3*86400000,now).tone,'warning');
  assert.equal(countdown(now+86400000,now).tone,'urgent');
  assert.equal(countdown(now+6*3600000,now).tone,'critical');
  assert.equal(countdown(now-100,now).text,'Time ended · closing');
});


test('deadlines and accepted snapshots survive a restart and downtime',async ()=>{
  const file=fileURLToPath(new URL('.lifecycle-'+randomBytes(8).toString('hex')+'.sqlite',import.meta.url)),now=Date.UTC(2026,9,3),a={address:'0x0011111111111111111111111111111111111111',role:'member'},b={address:'0x0022222222222222222222222222222222222222',role:'member'};
  let app;
  try{
    app=(await createApp({database:file}));for(const [account,nickname] of [[a,'Author'],[b,'Recipient']]){(await app.db.prepare("INSERT INTO accounts VALUES($1,$2)").run(account.address,now));(await saveProfile(app.db,account.address,{nickname,work:['Lighting'],hobbies:[]},now));}
    const categoryId=(await app.db.prepare("SELECT id FROM categories").get()).id,id=(await createQuestion(app.db,a,{categoryId,body:'Persistent question'},now)).id;(await replyToThread(app.db,b,id,{body:'Persistent answer'},now));
    (await app.db.close());app=null;app=(await createApp({database:file}));assert.equal((await expireQuestions(app.db,now+QUESTION_LIFETIME+10000)),1);(await app.db.close());app=null;
    app=(await createApp({database:file}));assert.equal((await expireQuestions(app.db,now+QUESTION_LIFETIME+20000)),0);const rows=(await acceptedAnswers(app.db,new URLSearchParams())).answers;assert.equal(rows.length,1);assert.equal(rows[0].answer,'Persistent answer');assert.equal(rows[0].closedAt,now+QUESTION_LIFETIME);
  }finally{(await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await (await app?.db.close()))))))))))))))))))))))))))))))))))))))))))))))))))))))))))));for(const suffix of ['','-wal','-shm'])rmSync(file+suffix,{force:true});}
});


test('unread answer flags respect each viewer and the revision actually read',async t=>{
  const {db,accounts,id}=(await fixture(t));
  const first=(await readThread(db,accounts[0],id));assert.ok(first.replies.every(r=>r.unread));
  assert.equal((await readThread(db,accounts[1],id)).replies.find(r=>r.author==='First').unread,false);
  (await markThreadRead(db,accounts[0],id,{revision:2}));
  const partial=(await readThread(db,accounts[0],id));assert.equal(partial.replies.find(r=>r.author==='First').unread,false);assert.equal(partial.replies.find(r=>r.author==='Second').unread,true);
  (await markThreadRead(db,accounts[0],id,{revision:first.revision}));assert.ok((await readThread(db,accounts[0],id)).replies.every(r=>!r.unread));
  assert.equal((await readThread(db,accounts[2],id)).unread,true);
});
