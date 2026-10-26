import {randomUUID} from 'node:crypto';
import {requireProfile,allowed} from './threads.mjs';
import {QUESTION_LIFETIME} from './lifecycle.mjs';
import {isBlocked} from './contact-preferences.mjs';
import {debateFields,activeField} from './verification.mjs';
import {LIVE_TALK_LIMITS as limits,checkRoomCapacity,roomDeadline,turnDeadline,checkJoin,audioMonth} from './live-talk-policy.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});

export function createLiveTalk(db,provider,now=Date.now){
 const lock=async id=>{await db.lock('live-talk');await db.lock('question:'+id);};
 const roomFor=id=>db.prepare('SELECT * FROM live_talk_rooms WHERE question_id=$1').get(id);
 const membersFor=id=>db.prepare('SELECT * FROM live_talk_members WHERE question_id=$1 AND left_at IS NULL ORDER BY queued_at NULLS LAST,joined_at,address').all(id);
 const turnFor=id=>db.prepare('SELECT * FROM live_talk_turns WHERE question_id=$1 AND ended_at IS NULL').get(id);
 const used=room=>Math.min(limits.questionMs,room.used_ms+(room.meter_active?Math.max(0,Math.min(now(),room.meter_until)-room.meter_at):0));
 async function meter(room,turn,peers){
  const members=await membersFor(room.question_id),speaker=members.find(m=>m.address===turn?.address),peer=peers.find(p=>p.identity===speaker?.identity);
  // Trust provider microphone publication/mute state, never a client-supplied flag.
  const active=!!turn&&turn.ends_at>now()&&peer?.permission?.canPublish===true&&peer.tracks?.some(t=>t.source===2&&t.type===0&&!t.muted);
  await db.prepare('UPDATE live_talk_rooms SET used_ms=$2,meter_at=$3,meter_active=$4,meter_until=$5,idle_since=$6 WHERE question_id=$1').run(room.question_id,used(room),now(),!!active,active?turn.ends_at:null,active?null:(room.idle_since??now()));
  return roomFor(room.question_id);
 }
 async function permitted(account,id){
  await requireProfile(db,account);const q=await allowed(db,id,account);
  if(q.created_at+QUESTION_LIFETIME<=now())throw fail(409,'This conversation has expired.');
  if(await isBlocked(db,account.address.toLowerCase(),q.author))throw fail(403,'This conversation is unavailable.');
  return q;
 }
 async function endTurn(room,turn,members){
  const member=members.find(m=>m.address===turn.address);
  // Confirm provider revocation BEFORE ending this turn or granting another.
  if(member){const peers=await provider.participants(room.room_name);if(peers.some(p=>p.identity===member.identity))await provider.permission(room.room_name,member.identity,false);}
  await db.prepare('UPDATE live_talk_turns SET ended_at=$2 WHERE id=$1 AND ended_at IS NULL').run(turn.id,now());
  await meter(room,null,[]);
 }
 async function finish(room,permanent=true){
  // If this fails the durable room stays open for background cleanup, never reopens.
  await provider.removeRoom(room.room_name);
  await db.prepare('UPDATE live_talk_rooms SET ended_at=$2,paused=$3,used_ms=$4,meter_active=FALSE,meter_at=$5,meter_until=NULL WHERE question_id=$1 AND ended_at IS NULL').run(room.question_id,permanent?now():null,!permanent,used(room),now());
  // Release unused local budget only after provider deletion is acknowledged.
  // Count every connection minute conservatively for all ten seats, plus margin.
  await db.prepare('UPDATE live_talk_sessions SET ended_at=$2,reserved_minutes=10*CEIL(GREATEST(0,$2-started_at)/60000.0)::int+10 WHERE question_id=$1 AND ended_at IS NULL').run(room.question_id,now());
  await db.prepare('UPDATE live_talk_turns SET ended_at=$2 WHERE question_id=$1 AND ended_at IS NULL').run(room.question_id,now());
  await db.prepare('UPDATE live_talk_members SET left_at=$2,queued_at=NULL WHERE question_id=$1 AND left_at IS NULL').run(room.question_id,now());
 }
 async function state(id,address){
  const room=await roomFor(id),members=await membersFor(id),mine=members.find(m=>m.address===address);
  const q=await db.prepare('SELECT author FROM questions WHERE id=$1').get(id);
  const fields=[];for(const f of await debateFields(db,id))if(await activeField(db,address,f.id))fields.push(f);
  const rows=await db.prepare(`SELECT t.id,t.message_id AS "messageId",t.started_at AS "startedAt",t.ends_at AS "endsAt",t.ended_at AS "endedAt",
   p.nickname,lm.identity,c.field_id AS "fieldId",f.name AS topic,(t.address=$2) AS mine,
   EXISTS(SELECT 1 FROM live_talk_heard h WHERE h.turn_id=t.id AND h.address=$2) AS heard,
   (SELECT count(*) FROM debate_votes v WHERE v.message_id=t.message_id AND v.value=1) AS upvotes,
   (SELECT count(*) FROM debate_votes v WHERE v.message_id=t.message_id AND v.value=-1) AS downvotes,
   COALESCE((SELECT value FROM debate_votes v WHERE v.message_id=t.message_id AND v.voter=$2),0) AS "myVote"
   FROM live_talk_turns t JOIN profiles p ON p.address=t.address JOIN live_talk_members lm ON lm.question_id=t.question_id AND lm.address=t.address JOIN verification_contributions c ON c.message_id=t.message_id
   LEFT JOIN verification_fields f ON f.id=c.field_id WHERE t.question_id=$1 ORDER BY t.id DESC LIMIT 10`).all(id,address);
  for(const turn of rows)turn.canVote=!turn.mine&&turn.heard&&(!turn.fieldId||fields.some(f=>f.id===turn.fieldId));
  const queue=[];for(const m of members.filter(m=>m.queued_at!==null))queue.push({nickname:(await db.prepare('SELECT nickname FROM profiles WHERE address=$1').get(m.address))?.nickname||'Member',mine:m.address===address});
  return {enabled:!!provider,now:now(),endsAt:room?.session_ends_at??null,remainingMs:room?limits.questionMs-used(room):limits.questionMs,speaking:!!room?.meter_active,speakingUntil:room?.meter_until??null,paused:!!room?.paused,idleUntil:room?.idle_since!=null?room.idle_since+15000:null,finished:!!room&&(room.ended_at!==null||used(room)>=limits.questionMs),joined:!!mine,queued:mine?.queued_at!==null&&!!mine,
   participants:members.length,queue,turns:rows,fields,canSpeak:fields.length>0||q?.author===address,limits:{turnSeconds:60,questionSeconds:600,participants:10}};
 }
 async function handle(account,id,input=null){
  const result=await db.transaction(async()=>{
   await lock(id);const q=await permitted(account,id),address=account.address.toLowerCase();
   if(!input)return state(id,address);
   if(!provider)throw fail(503,'Live Talk is not available yet. The text debate is still available.');
   if(!['join','heartbeat','speak','raise','lower','finish','leave','microphone'].includes(input.action))throw fail(400,'Unknown Live Talk action.');
   let room=await roomFor(id),members=await membersFor(id),mine=members.find(m=>m.address===address);
   if(input.action==='join'){
    if(room&&(room.ended_at!==null||used(room)>=limits.questionMs))throw fail(409,'This question has used its 10 minutes of Live Talk.');
    if(!room||room.paused){
     const month=audioMonth(now());const reserved=(await db.prepare('SELECT COALESCE(sum(reserved_minutes),0) AS n FROM live_talk_sessions WHERE budget_month=$1').get(month)).n;
     const active=(await db.prepare('SELECT count(*) AS n FROM live_talk_rooms WHERE ended_at IS NULL AND NOT paused').get()).n;
     try{checkRoomCapacity({reservedMinutes:reserved,activeRooms:active});}catch{throw fail(409,'The free Live Talk allowance is unavailable. Please use the text debate.');}
     const start=now(),name='ns-'+randomUUID();
     if(!room)await db.prepare('INSERT INTO live_talk_rooms(question_id,room_name,started_at,ends_at,budget_month,idle_since,meter_at,session_ends_at) VALUES($1,$2,$3,$4,$5,$3,$3,$4)').run(id,name,start,roomDeadline(start),month);
     else await db.prepare('UPDATE live_talk_rooms SET room_name=$2,paused=FALSE,idle_since=$3,meter_at=$3,meter_active=FALSE,meter_until=NULL,session_ends_at=$4 WHERE question_id=$1').run(id,name,start,roomDeadline(start));
     await db.prepare('INSERT INTO live_talk_sessions(question_id,budget_month,started_at) VALUES($1,$2,$3)').run(id,month,start);
     room=await roomFor(id);
     await provider.create(name);
    }
    if(room.session_ends_at<=now())throw fail(409,'Audio is being paused. Please join again shortly.');
    if(!mine){
     try{checkJoin({now:now(),endsAt:room.session_ends_at,participants:members.length});}catch{throw fail(409,'Live Talk is full or has finished. Please use the text debate.');}
     for(const member of members)if(await isBlocked(db,address,member.address))throw fail(403,'You cannot join this audio group.');
     await db.prepare(`INSERT INTO live_talk_members(question_id,address,identity,seen_at,joined_at) VALUES($1,$2,$3,$4,$4)
      ON CONFLICT(question_id,address) DO UPDATE SET seen_at=excluded.seen_at,joined_at=excluded.joined_at,left_at=NULL,queued_at=NULL,field_id=NULL`).run(id,address,randomUUID(),now());
     mine=await db.prepare('SELECT * FROM live_talk_members WHERE question_id=$1 AND address=$2').get(id,address);
    }
    await db.prepare('UPDATE live_talk_members SET seen_at=$3 WHERE question_id=$1 AND address=$2').run(id,address,now());
    await provider.create(room.room_name);
    return {...await state(id,address),url:provider.url,token:await provider.token(room.room_name,mine.identity)};
   }
   if(!room||!mine)throw fail(409,'Join Live Talk first.');
   const turn=await turnFor(id);
   if(input.action==='leave'){
    await provider.remove(room.room_name,mine.identity);
    if(turn?.address===address){await db.prepare('UPDATE live_talk_turns SET ended_at=$2 WHERE id=$1').run(turn.id,now());await meter(room,null,[]);}
    await db.prepare('UPDATE live_talk_members SET left_at=$3,queued_at=NULL WHERE question_id=$1 AND address=$2').run(id,address,now());
   }else{
    if(room.ended_at!==null||room.paused||room.session_ends_at<=now()||used(room)>=limits.questionMs)throw fail(409,'Audio is paused or finished. Join again if time remains.');
    await db.prepare('UPDATE live_talk_members SET seen_at=$3 WHERE question_id=$1 AND address=$2').run(id,address,now());
    if(input.action==='speak'||input.action==='raise'){
     if(turn)throw fail(409,'Someone is speaking. Try Speak when their turn ends.');
     const peers=await provider.participants(room.room_name);
     if(!peers.some(p=>p.identity===mine.identity))throw fail(409,'Audio is still connecting. Try Speak again.');
     for(const peer of peers)if(peer.permission?.canPublish)await provider.permission(room.room_name,peer.identity,false);
     const fields=[];for(const f of await debateFields(db,id))if(await activeField(db,address,f.id))fields.push(f);
     const field=fields.length===1?fields[0].id:input.fieldId;
     if(fields.length&&!fields.some(f=>f.id===field)||!fields.length&&q.author!==address)throw fail(403,'Choose a debate topic from your profile.');
     const selectedField=fields.length?field:null;
     const start=now(),end=turnDeadline(start,Math.min(room.session_ends_at,start+limits.questionMs-used(room))),client=randomUUID();
     const message=await db.prepare('INSERT INTO debate_messages(question_id,author,body,client_id,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id').get(id,address,'Live Talk contribution · audio not recorded',client,start);
     await db.prepare('INSERT INTO verification_contributions(message_id,field_id,kind) VALUES($1,$2,$3)').run(message.id,selectedField,selectedField===null?'follow_up':'field');
     await db.prepare('INSERT INTO live_talk_turns(question_id,address,message_id,started_at,ends_at) VALUES($1,$2,$3,$4,$5)').run(id,address,message.id,start,end);
     await db.prepare('UPDATE live_talk_members SET queued_at=NULL WHERE question_id=$1 AND address=$2').run(id,address);
    }
    if(input.action==='lower')await db.prepare('UPDATE live_talk_members SET queued_at=NULL WHERE question_id=$1 AND address=$2').run(id,address);
    if(input.action==='finish'&&turn?.address===address)await endTurn(room,turn,members);
    if(input.action==='microphone'&&turn?.address===address)await meter(room,turn,await provider.participants(room.room_name));
   }
   return state(id,address);
  });
  if(input?.action==='speak'||input?.action==='raise'){
   // Grant only after committing the durable turn; worker can recover an interrupted grant.
   await tickRoom(id);
   return state(id,account.address.toLowerCase());
  }
  return result;
 }
 async function tickRoom(id){
  await db.transaction(async()=>{
   await lock(id);let room=await roomFor(id);if(!room||room.ended_at!==null||room.paused)return;
   const q=await db.prepare('SELECT * FROM questions WHERE id=$1').get(id);
   if(used(room)>=limits.questionMs||!q||q.closed_at!==null||q.deleted_at!==null||q.created_at+QUESTION_LIFETIME<=now()){await finish(room);return;}
   let members=await membersFor(id),turn=await turnFor(id);
   const peers=await provider.participants(room.room_name);
   room=await meter(room,turn,peers);
   if(room.used_ms>=limits.questionMs){await finish(room);return;}
   if(room.session_ends_at<=now()||(room.idle_since!==null&&room.idle_since+15000<=now())){await finish(room,false);return;}
   // Reconcile actual media permissions every cycle, including after a restart or
   // uncertain provider response. Never grant a second speaker before revocation.
   for(const peer of peers){
    const member=members.find(m=>m.identity===peer.identity);
    if(!member||member.seen_at<now()-25_000){await provider.remove(room.room_name,peer.identity);continue;}
    if(peer.permission?.canPublish&&(!turn||turn.address!==member.address||turn.ends_at<=now()))await provider.permission(room.room_name,peer.identity,false);
   }
   for(const member of members)if(member.seen_at<now()-25_000){
    await db.prepare('UPDATE live_talk_members SET left_at=$3,queued_at=NULL WHERE question_id=$1 AND address=$2').run(id,member.address,now());
   }
   members=await membersFor(id);
   if(turn&&(turn.ends_at<=now()||!members.some(m=>m.address===turn.address))){await endTurn(room,turn,members);turn=null;}
   if(!turn)return;
   const speaker=members.find(m=>m.address===turn.address),peer=peers.find(p=>p.identity===speaker?.identity);
   if(!peer)return;
   if(!peer.permission?.canPublish)await provider.permission(room.room_name,speaker.identity,true);
   for(const member of members)if(member.address!==turn.address&&peers.some(p=>p.identity===member.identity))await db.prepare('INSERT INTO live_talk_heard(turn_id,address,heard_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING').run(turn.id,member.address,now());
  });
 }
 async function tick(){
  if(!provider)return;
  for(const {question_id:id} of await db.prepare('SELECT question_id FROM live_talk_rooms WHERE ended_at IS NULL AND NOT paused ORDER BY started_at LIMIT 8').all()){
   try{await tickRoom(id);}catch{console.error('[live-talk] reconciliation deferred; no next speaker granted');}
  }
 }
 return {handle,tick,tickRoom};
}
