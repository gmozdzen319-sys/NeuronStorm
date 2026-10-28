import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createNetworkActivity,networkAvatar} from '../network-activity.mjs';
import {activityQueue,createLiveNetwork} from '../public/network-live.js';
test('global metadata uses committed visible posts only; no text, topic, wallet, raw IDs or location leaks',async()=>{
 const pg=new PGlite();await pg.exec(`CREATE TABLE profiles(address text PRIMARY KEY,nickname text);CREATE TABLE questions(id text,author text,created_at bigint,deleted_at bigint,closed_at bigint,body text);CREATE TABLE replies(id int,question_id text,author text,created_at bigint,deleted_at bigint,body text);CREATE TABLE accepted_answers(question_id text,reply_id int,answer_author text,question_author text,selection text,closed_at bigint);CREATE TABLE content_files(id text,mime text,bytes bytea);CREATE TABLE content_file_links(file_id text,avatar_owner text);INSERT INTO profiles VALUES('wallet-secret-a','Alice'),('wallet-secret-b','Bob');INSERT INTO questions VALUES('raw-question','wallet-secret-a',98000,null,null,'PRIVATE TEXT'),('deleted','wallet-secret-a',98001,98002,null,'HIDDEN'),('closed','wallet-secret-a',98001,null,98002,'CLOSED'),('old','wallet-secret-a',100,null,null,'OLD');INSERT INTO replies VALUES(1,'raw-question','wallet-secret-b',98001,null,'PRIVATE ANSWER'),(2,'deleted','wallet-secret-b',98001,null,'HIDDEN'),(3,'raw-question','wallet-secret-b',98001,98002,'DELETED');`);
 let reads=0;const db={prepare(sql){return {async all(...args){reads++;return (await pg.query(sql,args)).rows;},async get(...args){return (await pg.query(sql,args)).rows[0];}};}};
 const feed=createNetworkActivity(db,()=>100000);const baseline=await feed.read(null);assert.deepEqual(baseline.events,[]);
 const [a,b]=await Promise.all([feed.read('97000'),feed.read('97000')]);assert.equal(reads,1);assert.deepEqual(a,b);assert.equal(a.events.length,2);
 assert.deepEqual(a.events.map(e=>e.kind),['question','answer']);assert.equal(a.events[0].conversation,a.events[1].conversation);assert.equal(a.events[1].asker.nickname,'Alice');
 const wire=JSON.stringify(a);for(const privateValue of ['PRIVATE','HIDDEN','CLOSED','wallet-secret','raw-question','category','location'])assert.ok(!wire.includes(privateValue));assert.deepEqual(Object.keys(a.events[0]).sort(),['asker','at','conversation','id','kind','person']);
 assert.deepEqual((await feed.read(String(a.through))).events,[]);assert.deepEqual((await feed.read('bad')).events,[]);
 await pg.exec(`UPDATE questions SET closed_at=98100 WHERE id='raw-question';UPDATE questions SET closed_at=98101 WHERE id='old';INSERT INTO replies VALUES(4,'old','wallet-secret-b',98000,null,'NOT EXPOSED');INSERT INTO accepted_answers VALUES('raw-question',1,'wallet-secret-b','wallet-secret-a','author',98100),('old',4,'wallet-secret-b','wallet-secret-a','automatic',98101),('deleted',2,'wallet-secret-b','wallet-secret-a','author',98002);`);
 const accepted=await createNetworkActivity(db,()=>100000).read('97000');assert.equal(accepted.events.length,1);const best=accepted.events[0];assert.equal(best.kind,'best_answer');assert.equal(best.person.nickname,'Bob');assert.equal(best.asker.nickname,'Alice');assert.match(best.answerEvent,/^[a-f0-9]{32}$/);assert.ok(!JSON.stringify(best).includes('NOT EXPOSED'));
 assert.equal(await networkAvatar(db,'bad'),null);
 const id='00000000-0000-0000-0000-000000000001';await pg.query("INSERT INTO content_files VALUES($1,'image/webp',decode('abcd','hex'))",[id]);assert.equal(await networkAvatar(db,id),undefined);
 await pg.query('INSERT INTO content_file_links VALUES($1,$2)',[id,'wallet-secret-a']);assert.equal((await networkAvatar(db,id)).mime,'image/webp');await pg.close();
});
test('bounded queue deduplicates, drops stale events and never fabricates activity',()=>{
 const q=activityQueue();assert.equal(q.next(100000),null);
 const e={id:'1',kind:'question',at:100000};q.push([e,e],100000);assert.equal(q.size,1);assert.equal(q.next(100000),e);assert.equal(q.next(100000),null);
 q.push(Array.from({length:100},(_,i)=>({id:'a'+i,kind:'answer',at:100000})),100000);assert.equal(q.size,8);assert.equal(q.next(200000),null);
 q.push([{id:'draft',kind:'draft',at:200000}],200000);assert.equal(q.size,0);
});

test('renderer reuses existing edges and asker node; disabled and hidden states make no requests',async()=>{
 const original={fetch:globalThis.fetch,Image:globalThis.Image,document:globalThis.document};let enabled=false,calls=0,paths=[],texts=[];
 globalThis.document={hidden:false};globalThis.Image=class {complete=false;};
 const now=Date.now();globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({through:now,events:[{id:'q',conversation:'same',kind:'question',at:now,person:{nickname:'Alice'},asker:{nickname:'Alice'}},{id:'a',conversation:'same',kind:'answer',at:now,person:{nickname:'Bob'},asker:{nickname:'Alice'}},{id:'best',conversation:'same',answerEvent:'a',kind:'best_answer',at:now,person:{nickname:'Bob'},asker:{nickname:'Alice'}}]})};};
 const ctx=new Proxy({createRadialGradient:()=>({addColorStop(){}}),fillText:text=>texts.push(text)},{get:(obj,k)=>k in obj?obj[k]:()=>{},set:(obj,k,v)=>(obj[k]=v,true)});
 const positions=Array.from({length:6},(_,i)=>({x:40+i*70,y:150+i*20})),edges=Array.from({length:5},(_,i)=>[i,i+1]);
 const live=createLiveNetwork((es,a,b)=>{assert.equal(es,edges);paths.push([a,b]);return Array.from({length:Math.abs(b-a)+1},(_,i)=>a+Math.sign(b-a)*i);},()=>enabled);
 try{
 live.draw(ctx,positions,edges,600,600,0);assert.equal(calls,0);enabled=true;live.draw(ctx,positions,edges,600,600,1);await new Promise(r=>setImmediate(r));
 live.draw(ctx,positions,edges,600,600,10);live.draw(ctx,positions,edges,600,600,13000);live.draw(ctx,positions,edges,600,600,13001);
 assert.equal(paths.length,2);assert.equal(paths[0][0],paths[1][1]);assert.notEqual(paths[0][0],paths[1][0]);
 live.draw(ctx,positions,edges,600,600,26000);live.draw(ctx,positions,edges,600,600,26001);
 assert.equal(paths.length,3);assert.deepEqual(paths[2],[paths[1][1],paths[1][0]]);
 texts=[];live.draw(ctx,positions,edges,600,600,30000);assert.ok(!texts.includes('+5 REPUTATION'));
 texts=[];live.draw(ctx,positions,edges,600,600,36001);assert.ok(texts.includes('+5 REPUTATION'));assert.ok(texts.includes('Bob'));
 texts=[];live.draw(ctx,positions,edges,600,600,39001);assert.ok(!texts.includes('+5 REPUTATION'));
 document.hidden=true;live.draw(ctx,positions,edges,600,600,15000);assert.equal(calls,1);
 }finally{Object.assign(globalThis,original);}
});
