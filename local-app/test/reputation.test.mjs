import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApp,ADMIN} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {createQuestion,replyToThread,voteOnReply} from '../threads.mjs';
import {voteOnDebate,debate} from '../debate.mjs';
import {acceptAnswer,expireQuestions} from '../lifecycle.mjs';
import {reputation,reputationRanking,reputationAdmin,roundStart,WEEK} from '../reputation.mjs';
import {moderateThread} from '../admin.mjs';
const now=Date.UTC(2026,9,4,12); // Sunday: test crossing Monday without expiring the question.
async function fixture(t,options={}){
 const app=await createApp({now:()=>now,...options});t.after(()=>app.close());const {db}=app;
 const accounts=[1,2,3,4].map(i=>({address:'0x00'+String(i).repeat(38),role:'member'}));
 for(const [i,a] of accounts.entries()){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(a.address,now);await saveProfile(db,a.address,{nickname:'Member '+i,work:['Mechanic','Electrician'],hobbies:['DIY']},now);}
 const categoryIds=(await db.prepare('SELECT id FROM categories ORDER BY id').all()).map(c=>c.id);
 const q=await createQuestion(db,accounts[0],{body:'A complex question',categoryIds},now);
 await replyToThread(db,accounts[1],q.id,{body:'An informed answer'},now);
 const r=await db.prepare('SELECT id FROM replies WHERE question_id=$1').get(q.id);
 await debate(db,accounts[1],q.id,'session',new URLSearchParams(),{body:'Discussion',clientId:randomUUID()},now);
 const m=await db.prepare('SELECT id FROM debate_messages WHERE question_id=$1').get(q.id);
 return {...app,accounts,q:q.id,r:r.id,m:m.id,categoryIds};
}
test('Q&A votes: no posting points, self-vote, repeated requests, switch, remove, immutable history',async t=>{
 const {db,accounts:a,q,r}=await fixture(t),score=()=>reputation(db,a[1].address,now);
 assert.equal((await score()).units,0);
 await assert.rejects(voteOnReply(db,a[1],q,r,{value:1},now),e=>e.status===403);
 await voteOnReply(db,a[0],q,r,{value:1},now);await voteOnReply(db,a[0],q,r,{value:1},now+1);
 assert.equal((await score()).units,100);
 await voteOnReply(db,a[0],q,r,{value:-1},now+2);assert.equal((await score()).units,-100);
 assert.equal((await score()).notHelpful,1);
 await voteOnReply(db,a[0],q,r,{value:0},now+3);assert.equal((await score()).units,0);
 const events=await db.prepare('SELECT previous_value,value,units FROM reputation_events ORDER BY id').all();
 assert.deepEqual(events.map(e=>[e.previous_value,e.value,e.units]),[[0,1,100],[1,-1,-200],[-1,0,100]]);
 await assert.rejects(db.exec('DELETE FROM reputation_events'),/append-only/);
 await assert.rejects(db.exec('UPDATE reputation_event_categories SET units=999'),/append-only/);
});
test('simultaneous duplicate and independent Q&A votes preserve one active vote each',async t=>{
 const {db,accounts:a,q,r}=await fixture(t);
 await Promise.all(Array.from({length:8},()=>voteOnReply(db,a[0],q,r,{value:1},now)));
 await Promise.all([voteOnReply(db,a[2],q,r,{value:1},now),voteOnReply(db,a[3],q,r,{value:-1},now)]);
 assert.equal((await reputation(db,a[1].address,now)).units,100);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM reputation_events').get()).n,3);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM reply_votes').get()).n,3);
});
test('category units sum exactly to total; profile changes do not transfer earned experience',async t=>{
 const {db,accounts:a,q,r,m}=await fixture(t);
 await voteOnReply(db,a[0],q,r,{value:1},now);await voteOnDebate(db,a[0],q,m,{value:1},now);
 let score=await reputation(db,a[1].address,now);assert.equal(score.units,125);assert.equal(score.categories.reduce((n,c)=>n+c.units,0),125);
 assert.deepEqual(score.categories.map(c=>c.units),[43,41,41]);
 await saveProfile(db,a[1].address,{nickname:'Member 1',work:['Other profession'],hobbies:[]},now);
 assert.deepEqual((await reputation(db,a[1].address,now)).categories,score.categories);
 await voteOnReply(db,a[0],q,r,{value:0},now+1);await voteOnDebate(db,a[0],q,m,{value:0},now+1);
 score=await reputation(db,a[1].address,now);assert.ok(score.categories.every(c=>c.units===0));
});
test('Debate voting enforces permissions and preserves changes with exact quarter-point units',async t=>{
 const {db,accounts:a,q,m}=await fixture(t);
 await assert.rejects(voteOnDebate(db,a[1],q,m,{value:1},now),e=>e.status===403);
 await assert.rejects(voteOnDebate(db,null,q,m,{value:1},now),e=>e.status===401);
 await assert.rejects(voteOnDebate(db,a[0],q,m,{value:2},now),e=>e.status===400);
 await Promise.all(Array.from({length:5},()=>voteOnDebate(db,a[0],q,m,{value:1},now)));
 assert.equal((await reputation(db,a[1].address,now)).debateUnits,25);
 await voteOnDebate(db,a[0],q,m,{value:-1},now+1);
 const result=await debate(db,a[0],q,'s',new URLSearchParams({ratings:String(m)}),null,now+2);
 assert.equal(result.ratings[0].myVote,-1);assert.equal(result.messages[0].downvotes,1);
 assert.equal((await reputation(db,a[1].address,now)).units,-25);
 await voteOnDebate(db,a[0],q,m,{value:0},now+3);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM reputation_events WHERE source='debate'").get()).n,3);
});
test('weekly boundary keeps prior round intact and records vote reversal in the new round',async t=>{
 const {db,accounts:a,q,r}=await fixture(t);const first=roundStart(now),next=first+WEEK;
 assert.equal(new Date(next).getUTCDay(),1);assert.equal(new Date(next).getUTCHours(),0);
 await voteOnReply(db,a[0],q,r,{value:1},next-1);await voteOnReply(db,a[0],q,r,{value:-1},next);
 assert.equal((await reputation(db,a[1].address,next,first)).weekly.units,100);
 assert.equal((await reputation(db,a[1].address,next,next)).weekly.units,-200);
 assert.equal((await reputation(db,a[1].address,next)).units,-100);
 const old=await reputationRanking(db,new URLSearchParams({round:String(first)}),next,false,a[1].address);
 assert.equal(old.rows[0].weeklyUnits,100);assert.equal(old.me.weeklyRank,1);assert.equal(old.round.status,'closed');
 assert.equal(old.rounds.length,2);assert.ok(!JSON.stringify(old.rows).includes(a[1].address));
 for(const limit of [20,50,100])assert.equal((await reputationRanking(db,new URLSearchParams({limit:String(limit)}),next)).rows.length,1);
 await assert.rejects(reputationRanking(db,new URLSearchParams({limit:'1000'}),next),e=>e.status===400);
});
test('only author-selected Best Answer gives five points, once even under simultaneous acceptance',async t=>{
 const {db,accounts:a,q,r}=await fixture(t);
 const results=await Promise.allSettled(Array.from({length:4},()=>acceptAnswer(db,a[0],q,{replyId:r,version:1},now+1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const score=await reputation(db,a[1].address,now);assert.equal(score.units,500);assert.equal(score.bestAnswers,1);
 assert.equal(score.categories.reduce((n,c)=>n+c.units,0),500);
 await expireQuestions(db,now+WEEK);assert.equal((await reputation(db,a[1].address,now)).units,500);
});
test('automatic winner does not earn the author-choice bonus; reputation survives closure',async t=>{
 const {db,accounts:a,q,r}=await fixture(t);await voteOnReply(db,a[0],q,r,{value:1},now);
 await expireQuestions(db,now+WEEK);const s=await reputation(db,a[1].address,now+WEEK);
 assert.equal(s.units,100);assert.equal(s.bestAnswers,0);assert.equal(s.weekly.units,0);
});
test('review eligibility is separate from visible reputation; admin API is protected',async t=>{
 const origin='http://127.0.0.1:43139';const app=await fixture(t,{origin}),{db,accounts:a,q,r}=app;
 await voteOnReply(db,a[0],q,r,{value:1},now);
 const event=await db.prepare('SELECT id FROM reputation_events').get();
 await db.prepare("INSERT INTO reputation_reviews(event_id,qualified_for_rewards,review_status,fraud_reason,rule_version) VALUES($1,false,'Rejected','Test review','test-v1')").run(event.id);
 const data=await reputationAdmin(db,new URLSearchParams(),now);assert.equal(data.review.rejected,1);assert.equal(data.review.qualifiedUnits,0);assert.equal(data.rows[0].totalUnits,100);assert.equal(data.suspiciousVotes.length,1);
 await new Promise(resolve=>app.server.listen(43139,'127.0.0.1',resolve));
 assert.equal((await fetch(origin+'/api/admin/reputation')).status,401);
 const token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex');await db.prepare('INSERT INTO sessions VALUES($1,$2,$3)').run(hash,a[0].address,now+WEEK);
 assert.equal((await fetch(origin+'/api/admin/reputation',{headers:{Cookie:'ns_session='+token}})).status,403);
 await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(ADMIN,now);await saveProfile(db,ADMIN,{nickname:'Admin',work:['Admin'],hobbies:[]},now);
 await db.prepare('UPDATE sessions SET address=$1 WHERE token_hash=$2').run(ADMIN,hash);
 const response=await fetch(origin+'/api/admin/reputation',{headers:{Cookie:'ns_session='+token}});assert.equal(response.status,200);assert.equal((await response.json()).events[0].voter,a[0].address);
});
test('additive migration backfills legacy votes and accepted answers without modifying them',async()=>{
 const engine=await PGlite.create();try{
 await engine.exec(await readFile(new URL('../db/migrations/001_initial.sql',import.meta.url),'utf8'));
 await engine.exec(`INSERT INTO accounts VALUES('asker',1),('expert',1); INSERT INTO profiles VALUES('asker','Asker','','',1),('expert','Expert','','',1);
 INSERT INTO categories(id,kind,name,normalized_name) VALUES(1,'work','Mechanic','mechanic');
 INSERT INTO questions(id,author,category_id,body,created_at,updated_at) VALUES('q','asker',1,'Question',1791115200000,1791115200000);
 INSERT INTO question_categories VALUES('q',1);
 INSERT INTO replies(id,question_id,author,body,created_at) VALUES(1,'q','expert','Answer',1791115200000);
 INSERT INTO reply_votes VALUES(1,'asker',1,1791115200000);
 INSERT INTO accepted_answers VALUES('q',1,'Question','Answer','asker','expert','Asker','Expert',1,'author',1791115200000);`);
 await engine.exec(await readFile(new URL('../db/migrations/002_reputation.sql',import.meta.url),'utf8'));
 assert.equal((await engine.query('SELECT sum(units)::int AS units FROM reputation_events')).rows[0].units,600);
 assert.equal((await engine.query("SELECT count(*)::int AS n FROM reputation_events WHERE origin='legacy_snapshot'")).rows[0].n,2);
 assert.equal((await engine.query('SELECT count(*)::int AS n FROM reply_votes')).rows[0].n,1);
 assert.equal((await engine.query('SELECT count(*)::int AS n FROM accepted_answers')).rows[0].n,1);
 }finally{await engine.close();}
});

test('moderation reverses and restores score without erasing votes or history',async t=>{
 const {db,accounts:a,q,r,m}=await fixture(t);
 await voteOnReply(db,a[0],q,r,{value:1},now);await voteOnDebate(db,a[2],q,m,{value:-1},now);
 await moderateThread(db,{...a[3],role:'admin'},q,'delete',{confirmation:q},now+1);
 assert.equal((await reputation(db,a[1].address,now)).units,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM reply_votes').get()).n,1);
 await moderateThread(db,{...a[3],role:'admin'},q,'restore',{confirmation:q},now+2);
 assert.equal((await reputation(db,a[1].address,now)).units,75);
 const events=await db.prepare('SELECT reason FROM reputation_events ORDER BY id').all();
 assert.deepEqual(events.map(e=>e.reason),['vote','vote','moderation_hide','moderation_hide','moderation_restore','moderation_restore']);
});

test('two independent PostgreSQL pools serialize repeated vote requests', {skip:process.env.NEURON_TEST_PGLITE==='1'?'Requires native PostgreSQL sessions; PGlite multiplexes a single backend.':false},async t=>{
 const key='reputation-'+randomUUID(),first=await fixture(t,{database:key}),second=await createApp({database:key,now:()=>now});t.after(()=>second.close());
 const {db,accounts:a,q,r,m}=first;
 await Promise.all(Array.from({length:12},(_,i)=>voteOnReply(i%2?db:second.db,a[0],q,r,{value:1},now)));
 await Promise.all(Array.from({length:12},(_,i)=>voteOnDebate(i%2?db:second.db,a[0],q,m,{value:1},now)));
 assert.equal((await reputation(db,a[1].address,now)).units,125);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM reputation_events').get()).n,2);
});
