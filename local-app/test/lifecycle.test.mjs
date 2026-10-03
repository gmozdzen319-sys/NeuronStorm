import {rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'quais';
import {createApp} from '../server.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
import {createQuestion,replyToThread,readThread,listQuestions,voteOnReply,markThreadRead} from '../threads.mjs';
import {prepareAction,submitAction} from '../actions.mjs';
import {QUESTION_LIFETIME,expireQuestions,acceptedAnswers} from '../lifecycle.mjs';
import {moderateThread} from '../admin.mjs';
import {debate} from '../debate.mjs';
import {countdown} from '../public/lifecycle-ui.js';
function fixture(t){
  const {db}=createApp({database:':memory:'});t.after(()=>db.close());const now=Date.UTC(2026,9,3,12);
  const wallets=[...[1,2,3].map(()=>new Wallet(randomBytes(32).toString('hex')))],accounts=wallets.map(w=>({address:w.address.toLowerCase(),role:'member'}));
  accounts.forEach((a,i)=>{db.prepare('INSERT INTO accounts VALUES(?,?)').run(a.address.toLowerCase(),now);saveProfile(db,a.address,{nickname:['Asker','First','Second'][i],work:['Lighting'],hobbies:[]},now);});
  const categoryId=db.prepare('SELECT id FROM categories').get().id,id=createQuestion(db,accounts[0],{body:'Which lamp?',categoryId},now).id;
  replyToThread(db,accounts[1],id,{body:'Warm task lights.'},now+1000);replyToThread(db,accounts[2],id,{body:'Dimmable lights.'},now+2000);
  const replies=readThread(db,accounts[0],id).replies;return {db,now,wallets,accounts,id,replies,categoryId};
}
test('author acceptance verifies signed question, reply version, wallet and session; retries close once',async t=>{
  const {db,now,wallets,accounts,id,replies}=fixture(t),[a,b]=accounts,path='/api/questions/'+id+'/accept';
  const input={replyId:replies[0].id,version:1};
  assert.throws(()=>prepareAction(db,b,'s',path,input,'https://test',now+3000),e=>e.status===403);
  const challenge=prepareAction(db,a,'session',path,input,'https://test',now+3000);
  assert.match(challenge.message,/Which lamp/);assert.match(challenge.message,/Warm task lights/);assert.match(challenge.message,/cannot be undone/);
  const signed={actionId:challenge.id,signature:await wallets[0].signMessage(challenge.message)};
  assert.throws(()=>submitAction(db,a,'another',path,signed,now+4000),e=>e.status===403);
  assert.throws(()=>submitAction(db,a,'session',path,{...signed,signature:'bad'},now+4000),e=>e.status===403);
  const result=submitAction(db,a,'session',path,{...signed,replyId:replies[1].id},now+4000);
  assert.equal(result.closed,true);assert.deepEqual(submitAction(db,a,'session',path,signed,now+5000),result);
  assert.equal(expireQuestions(db,now+QUESTION_LIFETIME),0);
  const accepted=acceptedAnswers(db,new URLSearchParams()).answers;
  assert.equal(accepted.length,1);assert.equal(accepted[0].answer,'Warm task lights.');assert.equal(accepted[0].selection,'author');assert.equal(accepted[0].walletAddress,b.address.toLowerCase());
  assert.equal(listQuestions(db,a,'mine').length,0);
  assert.throws(()=>readThread(db,b,id),e=>e.status===404);
  assert.throws(()=>replyToThread(db,a,id,{body:'Late'},now+5000),e=>e.status===404);
  assert.throws(()=>voteOnReply(db,a,id,replies[0].id,{value:1},now+5000),e=>e.status===404);
  assert.throws(()=>debate(db,a,id,'s',new URLSearchParams(),null,now+5000),e=>e.status===404);
  assert.throws(()=>moderateThread(db,{...a,role:'admin'},id,'restore',{confirmation:id},now+5000),e=>e.status===409);
});
test('acceptance rejects a changed, deleted or foreign answer, and cannot be sent after deadline',async t=>{
  const {db,now,wallets,accounts,id,replies}=fixture(t),a=accounts[0],path='/api/questions/'+id+'/accept',input={replyId:replies[0].id,version:1};
  const c=prepareAction(db,a,'s',path,input,'https://test',now+QUESTION_LIFETIME-1000),signed={actionId:c.id,signature:await wallets[0].signMessage(c.message)};
  assert.throws(()=>submitAction(db,a,'s',path,signed,now+QUESTION_LIFETIME),e=>e.status===409);
  db.prepare('UPDATE replies SET version=2 WHERE id=?').run(input.replyId);
  assert.throws(()=>submitAction(db,a,'s',path,signed,now+QUESTION_LIFETIME-500),e=>e.status===409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM accepted_answers').get().n,0);
  db.prepare('UPDATE replies SET deleted_at=? WHERE id=?').run(now,input.replyId);
  assert.throws(()=>prepareAction(db,a,'s',path,input,'https://test',now),e=>e.status===404);
  assert.throws(()=>prepareAction(db,a,'s',path,{replyId:999999,version:1},'https://test',now),e=>e.status===404);
});
test('expiry selects most upvotes at exactly seven days, preserves stars and is idempotent',t=>{
  const {db,now,accounts,id,replies}=fixture(t);
  voteOnReply(db,accounts[0],id,replies[1].id,{value:1},now+3000);
  assert.equal(expireQuestions(db,now+QUESTION_LIFETIME-1),0);
  assert.equal(expireQuestions(db,now+QUESTION_LIFETIME),1);
  const row=acceptedAnswers(db,new URLSearchParams()).answers[0];assert.equal(row.answer,'Dimmable lights.');assert.equal(row.upvotes,1);assert.equal(row.selection,'automatic');
  assert.equal(row.closedAt,now+QUESTION_LIFETIME);assert.equal(expireQuestions(db,now+QUESTION_LIFETIME+100),0);
  assert.equal(readProfile(db,accounts[2].address).points,1);
});
test('ties including zero votes select earliest eligible reply; no reply closes without recipient',t=>{
  const {db,now,accounts,id,categoryId}=fixture(t);
  const empty=createQuestion(db,accounts[0],{body:'No answers?',categoryId},now).id;
  expireQuestions(db,now+QUESTION_LIFETIME+5000);
  const rows=acceptedAnswers(db,new URLSearchParams()).answers;
  assert.equal(rows.find(r=>r.questionId===id).answer,'Warm task lights.');
  const noAnswer=rows.find(r=>r.questionId===empty);assert.equal(noAnswer.selection,'unanswered');assert.equal(noAnswer.walletAddress,null);
});
test('moderated or deleted replies never receive automatic rewards',t=>{
  const {db,now,accounts,id,replies,categoryId}=fixture(t);
  db.prepare('UPDATE replies SET deleted_at=? WHERE id=?').run(now,replies[0].id);
  const removed=createQuestion(db,accounts[0],{body:'Hidden question',categoryId},now).id;
  replyToThread(db,accounts[1],removed,{body:'Hidden answer'},now);
  db.prepare('UPDATE questions SET deleted_at=? WHERE id=?').run(now,removed);
  expireQuestions(db,now+QUESTION_LIFETIME);
  const rows=acceptedAnswers(db,new URLSearchParams()).answers;
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


test('deadlines and accepted snapshots survive a restart and downtime',()=>{
  const file=fileURLToPath(new URL('.lifecycle-'+randomBytes(8).toString('hex')+'.sqlite',import.meta.url)),now=Date.UTC(2026,9,3),a={address:'0x0011111111111111111111111111111111111111',role:'member'},b={address:'0x0022222222222222222222222222222222222222',role:'member'};
  let app;
  try{
    app=createApp({database:file});for(const [account,nickname] of [[a,'Author'],[b,'Recipient']]){app.db.prepare('INSERT INTO accounts VALUES(?,?)').run(account.address,now);saveProfile(app.db,account.address,{nickname,work:['Lighting'],hobbies:[]},now);}
    const categoryId=app.db.prepare('SELECT id FROM categories').get().id,id=createQuestion(app.db,a,{categoryId,body:'Persistent question'},now).id;replyToThread(app.db,b,id,{body:'Persistent answer'},now);
    app.db.close();app=null;app=createApp({database:file});assert.equal(expireQuestions(app.db,now+QUESTION_LIFETIME+10000),1);app.db.close();app=null;
    app=createApp({database:file});assert.equal(expireQuestions(app.db,now+QUESTION_LIFETIME+20000),0);const rows=acceptedAnswers(app.db,new URLSearchParams()).answers;assert.equal(rows.length,1);assert.equal(rows[0].answer,'Persistent answer');assert.equal(rows[0].closedAt,now+QUESTION_LIFETIME);
  }finally{app?.db.close();for(const suffix of ['','-wal','-shm'])rmSync(file+suffix,{force:true});}
});


test('unread answer flags respect each viewer and the revision actually read',t=>{
  const {db,accounts,id}=fixture(t);
  const first=readThread(db,accounts[0],id);assert.ok(first.replies.every(r=>r.unread));
  assert.equal(readThread(db,accounts[1],id).replies.find(r=>r.author==='First').unread,false);
  markThreadRead(db,accounts[0],id,{revision:2});
  const partial=readThread(db,accounts[0],id);assert.equal(partial.replies.find(r=>r.author==='First').unread,false);assert.equal(partial.replies.find(r=>r.author==='Second').unread,true);
  markThreadRead(db,accounts[0],id,{revision:first.revision});assert.ok(readThread(db,accounts[0],id).replies.every(r=>!r.unread));
  assert.equal(readThread(db,accounts[2],id).unread,true);
});
