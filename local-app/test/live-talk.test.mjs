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
 const microphone=async(user,on)=>{const m=await db.prepare('SELECT identity FROM live_talk_members WHERE question_id=$1 AND address=$2').get(q.id,user.address);for(const peers of rooms.values()){const p=peers.get(m.identity);if(p)p.tracks=[{source:2,type:0,muted:!on}];}await post(user,'microphone');};
 return {app,db,users,q:q.id,field,service,provider,calls,rooms,post,microphone,now:()=>clock,advance:ms=>clock+=ms,revokeFailure:()=>{revokeFails=true;}};
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
 assert.equal(f.rooms.size,0);
 const paused=await f.service.handle(f.users[0],f.q);assert.equal(paused.paused,true);assert.equal(paused.remainingMs,600000);
 await f.post(f.users[0],'join');assert.equal((await f.service.handle(f.users[0],f.q)).remainingMs,600000);
});

test('first Speak gets a durable turn, no queue, no self or non-listener votes',async t=>{
 const f=await fixture(t),[a,b,c]=f.users;
 await f.post(a,'join');await f.post(b,'join');
 await f.post(a,'speak',{fieldId:f.field});await assert.rejects(f.post(b,'speak',{fieldId:f.field}),e=>e.status===409);
 assert.equal((await f.service.handle(b,f.q)).queue.length,0);
 await f.service.tickRoom(f.q);assert.equal(f.calls.filter(c=>c.publish).length,1);
 const s=await f.service.handle(b,f.q),m=s.turns[0].messageId;
 await assert.rejects(voteOnDebate(f.db,a,f.q,m,{value:1},f.now()),e=>e.status===403);
 await assert.rejects(voteOnDebate(f.db,c,f.q,m,{value:1},f.now()),e=>e.status===403);
 await voteOnDebate(f.db,b,f.q,m,{value:1},f.now());
 assert.equal((await verificationFields(f.db,a.address,f.now()))[0].net,0);
 assert.equal((await verificationFields(f.db,a.address,f.now()+300001))[0].net,1);
 await f.post(a,'finish');await f.service.tickRoom(f.q);assert.equal((await f.service.handle(b,f.q)).turns[0].endedAt,f.now());await f.post(b,'speak');
 const publishes=[...f.rooms.values()][0];assert.equal([...publishes.values()].filter(p=>p.permission.canPublish).length,1);
 assert.equal((await f.service.handle(b,f.q)).turns[0].mine,true);
});

test('failed revocation blocks Speak; restart preserves durable turn',async t=>{
 const f=await fixture(t),[a,b]=f.users;
 await f.post(a,'join');await f.post(b,'join');await f.post(a,'speak');await assert.rejects(f.post(b,'speak'),e=>e.status===409);await f.service.tickRoom(f.q);await f.service.tickRoom(f.q);
 await f.microphone(a,true);const before=(await f.service.handle(a,f.q)).turns[0];f.advance(61000);
 await f.post(a,'heartbeat');await f.post(b,'heartbeat');f.revokeFailure();
 const restarted=createLiveTalk(f.db,f.provider,f.now);
 await assert.rejects(restarted.tickRoom(f.q),/provider unavailable/);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_turns').get()).n,1);
 assert.equal(f.calls.filter(c=>c.publish).length,1);
 assert.equal((await restarted.handle(a,f.q)).turns[0].id,before.id);
});

test('disconnect heartbeat expiry releases members and no audio data is stored',async t=>{
 const f=await fixture(t);await f.post(f.users[0],'join');await f.post(f.users[0],'speak');await f.service.tickRoom(f.q);await f.service.tickRoom(f.q);
 f.advance(26000);await f.service.tickRoom(f.q);
 assert.equal((await f.service.handle(f.users[0],f.q)).participants,0);
 assert.equal(f.rooms.size,0);
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
 assert.equal((await f.db.prepare('SELECT reserved_minutes FROM live_talk_sessions').get()).reserved_minutes,110);
 await assert.rejects(f.post(a,'join'),e=>e.status===409);
 f.provider.removeRoom=original;
 await createLiveTalk(f.db,f.provider,f.now).tick();
 assert.equal((await f.db.prepare('SELECT paused FROM live_talk_rooms').get()).paused,true);
 assert.equal(f.rooms.size,0);
});

test('only question author may request an unverified follow-up without a matching field',async t=>{
 const f=await fixture(t),[a,b]=f.users;
 await f.post(a,'join');await f.post(b,'join');
 await f.db.prepare('DELETE FROM profile_categories WHERE address=ANY($1::text[])').run([a.address,b.address]);
 await assert.rejects(f.post(b,'speak',{fieldId:f.field}),e=>e.status===403);
 await f.post(a,'speak',{fieldId:f.field});await f.service.tickRoom(f.q);
 const turn=(await f.service.handle(a,f.q)).turns[0];assert.equal(turn.fieldId,null);
});

test('idle pauses after 15 seconds; restart and rejoin preserve remaining time',async t=>{
 const f=await fixture(t),a=f.users[0];await f.post(a,'join');
 const old=(await f.db.prepare('SELECT room_name FROM live_talk_rooms').get()).room_name;
 f.advance(14000);await f.service.tick();assert.equal((await f.service.handle(a,f.q)).remainingMs,600000);
 f.advance(1000);await f.service.tick();assert.equal(f.rooms.size,0);
 const paused=await createLiveTalk(f.db,f.provider,f.now).handle(a,f.q);assert.equal(paused.paused,true);assert.equal(paused.finished,false);
 const session=await f.db.prepare('SELECT * FROM live_talk_sessions').get();assert.equal(session.reserved_minutes,20);assert.equal(session.ended_at,f.now());
 await f.service.tick();assert.equal((await f.db.prepare('SELECT reserved_minutes FROM live_talk_sessions').get()).reserved_minutes,20);
 await f.post(a,'join');assert.notEqual((await f.db.prepare('SELECT room_name FROM live_talk_rooms').get()).room_name,old);
 assert.equal((await f.service.handle(a,f.q)).remainingMs,600000);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_sessions').get()).n,2);
});

test('only provider-confirmed unmuted microphone consumes time; mute freezes it',async t=>{
 const f=await fixture(t),a=f.users[0];await f.post(a,'join');await f.post(a,'speak');await f.service.tick();await f.service.tick();
 await f.post(a,'microphone',{active:true});f.advance(5000);await f.service.tick();assert.equal((await f.service.handle(a,f.q)).remainingMs,600000);
 await f.microphone(a,true);f.advance(10000);await f.post(a,'heartbeat');await f.service.tick();assert.equal((await f.service.handle(a,f.q)).remainingMs,590000);
 await f.microphone(a,false);f.advance(14000);await f.service.tick();assert.equal((await f.service.handle(a,f.q)).remainingMs,590000);
 f.advance(1000);await f.service.tick();assert.equal((await f.service.handle(a,f.q)).paused,true);
 await f.post(a,'join');assert.equal((await f.service.handle(a,f.q)).remainingMs,590000);
});

test('ten minutes of microphone time is terminal, not resumable',async t=>{
 const f=await fixture(t),a=f.users[0];await f.post(a,'join');
 await f.db.prepare('UPDATE live_talk_rooms SET used_ms=599000 WHERE question_id=$1').run(f.q);
 await f.post(a,'speak');await f.service.tick();await f.service.tick();await f.microphone(a,true);
 f.advance(1000);await f.service.tick();assert.equal((await f.service.handle(a,f.q)).finished,true);
 assert.equal((await f.service.handle(a,f.q)).remainingMs,0);await assert.rejects(f.post(a,'join'),e=>e.status===409);
});

test('resuming checks monthly budget again and does not reset time when admission is rejected',async t=>{
 const f=await fixture(t),a=f.users[0];await f.post(a,'join');f.advance(15000);await f.service.tick();
 await f.db.prepare('UPDATE live_talk_sessions SET reserved_minutes=4400').run();
 await assert.rejects(f.post(a,'join'),e=>e.status===409);
 const state=await f.service.handle(a,f.q);assert.equal(state.paused,true);assert.equal(state.remainingMs,600000);assert.equal(f.rooms.size,0);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_sessions').get()).n,1);
});


test('concurrent Speak clicks select exactly one speaker and never queue the loser',async t=>{
 const f=await fixture(t),[a,b]=f.users;await f.post(a,'join');await f.post(b,'join');
 const results=await Promise.allSettled([f.post(a,'speak'),f.post(b,'speak')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_turns WHERE ended_at IS NULL').get()).n,1);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_members WHERE queued_at IS NOT NULL').get()).n,0);
 assert.equal([...f.rooms.values()][0].values().filter(p=>p.permission.canPublish).toArray().length,1);
});

test('uncertain grant retains durable speaker and blocks another until reconciled',async t=>{
 const f=await fixture(t),[a,b]=f.users;await f.post(a,'join');await f.post(b,'join');
 const original=f.provider.permission;f.provider.permission=async(...args)=>{await original(...args);if(args[2])throw Error('lost acknowledgement');};
 await assert.rejects(f.post(a,'speak'),/lost acknowledgement/);
 await assert.rejects(f.post(b,'speak'),e=>e.status===409);
 f.provider.permission=original;await createLiveTalk(f.db,f.provider,f.now).tickRoom(f.q);
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM live_talk_turns').get()).n,1);
 await f.post(a,'finish');await f.post(b,'speak');assert.equal((await f.service.handle(b,f.q)).turns[0].mine,true);
});
