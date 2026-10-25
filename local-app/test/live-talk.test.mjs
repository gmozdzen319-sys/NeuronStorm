import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {createQuestion} from '../threads.mjs';
import {voteOnDebate,debate} from '../debate.mjs';
import {debateFields,verificationFields,VERIFICATION_WAIT} from '../verification.mjs';
import {createLiveTalk} from '../live-talk.mjs';
import {configuredLiveTalk} from '../live-talk-provider.mjs';

async function fixture(t){
 const app=await createApp();t.after(()=>app.close());const {db}=app;let clock=Date.now();
 const users=Array.from({length:13},(_,i)=>({address:'0x'+(i+1).toString(16).padStart(40,'0'),role:'member'}));
 for(const [i,a] of users.entries()){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(a.address,clock);await saveProfile(db,a.address,{nickname:'Voice '+i,work:['Neuron Storm'],hobbies:[]},clock);}
 const category=await db.prepare("SELECT id FROM categories WHERE name='Neuron Storm'").get();
 const q=await createQuestion(db,users[0],{body:'Talk',categoryIds:[category.id]},clock);
 const field=(await debateFields(db,q.id))[0].id;clock+=VERIFICATION_WAIT+1000;
 const rooms=new Map(),calls=[];let revokeFails=false;
 const provider={url:'wss://test.livekit.cloud',async create(name){if(!rooms.has(name))rooms.set(name,new Map());},async participants(name){return [...(rooms.get(name)?.values()||[])];},async permission(name,identity,publish){calls.push({identity,publish});if(!publish&&revokeFails)throw Error('provider unavailable');const p=rooms.get(name)?.get(identity);if(!p)throw Error('missing participant');p.permission.canPublish=publish;},async remove(name,identity){rooms.get(name)?.delete(identity);},async removeRoom(name){rooms.delete(name);},async token(name,identity){rooms.get(name).set(identity,{identity,permission:{canPublish:false}});return 'test-token';}};
 const service=createLiveTalk(db,provider,()=>clock),post=(user,action,extra={})=>service.handle(user,q.id,{action,...extra});
 return {app,db,users,q:q.id,field,service,provider,calls,rooms,post,now:()=>clock,advance:ms=>clock+=ms,revokeFailure:()=>{revokeFails=true;}};
}

test('Live Talk checks authentication and question access, caps concurrency, persists deadline',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.service.handle(null,f.q),e=>e.status===401);
 await assert.rejects(f.service.handle(f.users[0],randomUUID()),e=>e.status===404);
 const results=await Promise.allSettled(f.users.slice(0,11).map(u=>f.post(u,'join')));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_rooms').get()).n,1);
 const first=await f.service.handle(f.users[0],f.q);assert.equal(first.participants,10);
 await f.post(f.users[0],'leave');f.advance(1000);await f.post(f.users[0],'join');
 assert.equal((await f.service.handle(f.users[0],f.q)).endsAt,first.endsAt);
 f.advance(600000);await f.service.tickRoom(f.q);
 await assert.rejects(f.post(f.users[0],'join'),e=>e.status===409);
 assert.equal(f.rooms.size,0);
});

test('one durable speaker, no permission until next cycle, no self or non-listener votes',async t=>{
 const f=await fixture(t),[a,b,c]=f.users;
 await f.post(a,'join');await f.post(b,'join');
 await f.post(a,'raise',{fieldId:f.field});await f.post(b,'raise',{fieldId:f.field});
 await f.service.tickRoom(f.q);assert.equal(f.calls.filter(c=>c.publish).length,0);
 await f.service.tickRoom(f.q);assert.equal(f.calls.filter(c=>c.publish).length,1);
 const s=await f.service.handle(b,f.q),m=s.turns[0].messageId;
 await assert.rejects(voteOnDebate(f.db,a,f.q,m,{value:1},f.now()),e=>e.status===403);
 await assert.rejects(voteOnDebate(f.db,c,f.q,m,{value:1},f.now()),e=>e.status===403);
 await voteOnDebate(f.db,b,f.q,m,{value:1},f.now());
 assert.equal((await verificationFields(f.db,a.address,f.now()))[0].net,0);
 assert.equal((await verificationFields(f.db,a.address,f.now()+300001))[0].net,1);
 await f.post(a,'finish');await f.service.tickRoom(f.q);await f.service.tickRoom(f.q);
 const publishes=[...f.rooms.values()][0];assert.equal([...publishes.values()].filter(p=>p.permission.canPublish).length,1);
 assert.equal((await f.service.handle(b,f.q)).turns[0].mine,true);
});

test('failed revocation does not grant the next queued speaker; restart reuses durable turn',async t=>{
 const f=await fixture(t),[a,b]=f.users;
 await f.post(a,'join');await f.post(b,'join');await f.post(a,'raise');await f.post(b,'raise');await f.service.tickRoom(f.q);await f.service.tickRoom(f.q);
 const before=(await f.service.handle(a,f.q)).turns[0];f.advance(61000);
 await f.post(a,'heartbeat');await f.post(b,'heartbeat');f.revokeFailure();
 const restarted=createLiveTalk(f.db,f.provider,f.now);
 await assert.rejects(restarted.tickRoom(f.q),/provider unavailable/);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_turns').get()).n,1);
 assert.equal(f.calls.filter(c=>c.publish).length,1);
 assert.equal((await restarted.handle(a,f.q)).turns[0].id,before.id);
});

test('disconnect heartbeat expiry releases members and no audio data is stored',async t=>{
 const f=await fixture(t);await f.post(f.users[0],'join');await f.post(f.users[0],'raise');await f.service.tickRoom(f.q);await f.service.tickRoom(f.q);
 f.advance(26000);await f.service.tickRoom(f.q);
 assert.equal((await f.service.handle(f.users[0],f.q)).participants,0);
 assert.equal([...f.rooms.values()][0].size,0);
 const columns=await f.db.prepare("SELECT column_name FROM information_schema.columns WHERE table_name LIKE 'live_talk_%'").all();
 assert(!columns.some(c=>/audio|transcript|secret|token/.test(c.column_name)));
});

test('verification timestamps survive repeated vote, reversal and cancellation before due',async t=>{
 const f=await fixture(t),[a,b]=f.users,clientId=randomUUID();
 await debate(f.db,a,f.q,'test',new URLSearchParams(),{body:'Text contribution',fieldId:f.field,clientId},f.now());
 const m=(await f.db.prepare('SELECT id FROM debate_messages WHERE client_id=$1').get(clientId)).id;
 await voteOnDebate(f.db,b,f.q,m,{value:1},f.now());
 const first=await f.db.prepare('SELECT * FROM verification_votes WHERE message_id=$1').get(m);
 assert(first.effective_at>=f.now()+60000&&first.effective_at<=f.now()+300000);
 f.advance(1000);await voteOnDebate(f.db,b,f.q,m,{value:1},f.now());
 assert.equal((await f.db.prepare('SELECT effective_at FROM verification_votes WHERE message_id=$1').get(m)).effective_at,first.effective_at);
 await voteOnDebate(f.db,b,f.q,m,{value:0},f.now());
 assert.equal((await verificationFields(f.db,a.address,f.now()+300001))[0].net,0);
 await voteOnDebate(f.db,b,f.q,m,{value:-1},f.now());
 assert.equal((await verificationFields(f.db,a.address,f.now()))[0].net,0);
 assert.equal((await verificationFields(f.db,a.address,f.now()+300001))[0].net,-1);
});

test('provider tokens are listener-only, microphone-only and short lived; no admin or recording grants',async()=>{
 const provider=configuredLiveTalk({LIVEKIT_URL:'wss://example.livekit.cloud',LIVEKIT_API_KEY:'test-key',LIVEKIT_API_SECRET:'local-test-secret-not-a-real-credential'});
 const jwt=await provider.token('test-room','opaque-id'),payload=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url'));
 assert.equal(payload.sub,'opaque-id');assert.equal(payload.video.canPublish,false);assert.equal(payload.video.canPublishData,false);
 assert(!payload.video.roomAdmin&&!payload.video.roomRecord&&!payload.video.roomCreate);assert(payload.exp-payload.nbf<=30);
 assert.equal(configuredLiveTalk({}),null);
 assert.throws(()=>configuredLiveTalk({LIVEKIT_URL:'wss://attacker.example',LIVEKIT_API_KEY:'x',LIVEKIT_API_SECRET:'x'}));
});

test('expired room cleanup survives provider failure and cannot restart its allowance',async t=>{
 const f=await fixture(t),a=f.users[0];await f.post(a,'join');
 const original=f.provider.removeRoom;f.provider.removeRoom=async()=>{throw Error('temporary outage');};
 f.advance(600001);await assert.rejects(f.service.tickRoom(f.q),/temporary outage/);
 assert.equal((await f.db.prepare('SELECT ended_at FROM live_talk_rooms').get()).ended_at,null);
 await assert.rejects(f.post(a,'join'),e=>e.status===409);
 f.provider.removeRoom=original;
 await createLiveTalk(f.db,f.provider,f.now).tick();
 assert.equal((await f.db.prepare('SELECT ended_at FROM live_talk_rooms').get()).ended_at,f.now());
 assert.equal(f.rooms.size,0);
});

test('only question author may request an unverified follow-up without a matching field',async t=>{
 const f=await fixture(t),[a,b]=f.users;
 await f.post(a,'join');await f.post(b,'join');
 await f.db.prepare('DELETE FROM profile_categories WHERE address=ANY($1::text[])').run([a.address,b.address]);
 await assert.rejects(f.post(b,'raise',{fieldId:f.field}),e=>e.status===403);
 await f.post(a,'raise',{fieldId:f.field});await f.service.tickRoom(f.q);
 const turn=(await f.service.handle(a,f.q)).turns[0];assert.equal(turn.fieldId,null);
});
