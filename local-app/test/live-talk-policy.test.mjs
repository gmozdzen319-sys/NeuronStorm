import test from 'node:test';
import assert from 'node:assert/strict';
import {LIVE_TALK_LIMITS as limits,checkRoomCapacity,roomDeadline,turnDeadline,checkJoin,audioMonth,verificationDueAt} from '../live-talk-policy.mjs';

test('question lifetime is ten minutes; a turn never exceeds one minute or the question deadline',()=>{
 const end=roomDeadline(1_000);
 assert.equal(end,601_000);
 assert.equal(turnDeadline(1_000,end),61_000);
 assert.equal(turnDeadline(600_000,end),end);
 assert.throws(()=>turnDeadline(end,end),{code:'QUESTION_AUDIO_FINISHED'});
 assert.throws(()=>checkJoin({now:end,endsAt:end,participants:0}),{code:'QUESTION_AUDIO_FINISHED'});
});
test('participant admission rejects an eleventh connection',()=>{
 checkJoin({now:1,endsAt:600_000,participants:9});
 assert.throws(()=>checkJoin({now:1,endsAt:600_000,participants:10}),{code:'AUDIO_ROOM_FULL'});
});
test('monthly reservation refuses partial-room budgets; concurrent room cap leaves provider headroom',()=>{
 assert.equal(checkRoomCapacity({reservedMinutes:4290,activeRooms:7}),110);
 assert.throws(()=>checkRoomCapacity({reservedMinutes:4291,activeRooms:0}),{code:'MONTHLY_AUDIO_LIMIT'});
 assert.throws(()=>checkRoomCapacity({reservedMinutes:0,activeRooms:8}),{code:'AUDIO_CAPACITY'});
 assert(limits.concurrentRooms*limits.participants<100);
 assert(limits.monthlyBudgetMinutes<5000);
});
test('budget month uses UTC; existing room deadline does not extend across month boundary',()=>{
 const start=Date.parse('2026-10-31T23:59:00Z'),end=roomDeadline(start);
 assert.equal(audioMonth(start),'2026-10');
 assert.equal(audioMonth(end),'2026-11');
 assert.equal(end-start,600_000);
 assert.throws(()=>checkJoin({now:end,endsAt:end,participants:0}),{code:'QUESTION_AUDIO_FINISHED'});
});
test('verification delay is bounded at one to five minutes, with exclusive random upper bound',()=>{
 assert.equal(verificationDueAt(10,(min,max)=>{assert.equal(min,60000);assert.equal(max,300001);return min;}),60010);
 assert.equal(verificationDueAt(10,()=>300000),300010);
 for(const value of [59999,300001,NaN,1.5])assert.throws(()=>verificationDueAt(10,()=>value),{code:'INVALID_VOTE_DELAY'});
});
test('malformed counters and timestamps fail closed',()=>{
 for(const value of [-1,NaN,Infinity,'1',1.5]){
  assert.throws(()=>roomDeadline(value));
  assert.throws(()=>checkRoomCapacity({reservedMinutes:value,activeRooms:0}));
  assert.throws(()=>checkJoin({now:0,endsAt:1,participants:value}));
 }
 assert.throws(()=>roomDeadline(Number.MAX_SAFE_INTEGER));
});
