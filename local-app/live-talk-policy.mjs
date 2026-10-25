// Policy only. No network, audio, credentials, database or worker initialization.
export const LIVE_TALK_LIMITS=Object.freeze({
 turnMs:60_000,
 questionMs:600_000,
 participants:10,
 concurrentRooms:8,
 // Reserve a complete room plus disconnect/reconciliation headroom before opening.
 roomBudgetMinutes:110,
 monthlyBudgetMinutes:4_400,
 voteDelayMinMs:60_000,
 voteDelayMaxMs:300_000,
});

const reject=(code)=>Object.assign(new Error(code),{code});
function time(value){if(!Number.isSafeInteger(value)||value<0)throw reject('INVALID_TIME');return value;}
function count(value){if(!Number.isSafeInteger(value)||value<0)throw reject('INVALID_COUNT');return value;}

// The caller must read these counters and reserve capacity atomically in PostgreSQL.
// A local allowance is not a substitute for LiveKit's provider-enforced Build cap.
export function checkRoomCapacity({reservedMinutes,activeRooms}){
 count(reservedMinutes);count(activeRooms);
 if(reservedMinutes+LIVE_TALK_LIMITS.roomBudgetMinutes>LIVE_TALK_LIMITS.monthlyBudgetMinutes)throw reject('MONTHLY_AUDIO_LIMIT');
 if(activeRooms>=LIVE_TALK_LIMITS.concurrentRooms)throw reject('AUDIO_CAPACITY');
 return LIVE_TALK_LIMITS.roomBudgetMinutes;
}

// Persist this timestamp once per question; neither reconnect nor month rollover resets it.
export function roomDeadline(startedAt){return time(time(startedAt)+LIVE_TALK_LIMITS.questionMs);}
export function turnDeadline(now,endsAt){
 time(now);time(endsAt);
 if(now>=endsAt)throw reject('QUESTION_AUDIO_FINISHED');
 return Math.min(time(now+LIVE_TALK_LIMITS.turnMs),endsAt);
}
export function checkJoin({now,endsAt,participants}){
 time(now);time(endsAt);count(participants);
 if(now>=endsAt)throw reject('QUESTION_AUDIO_FINISHED');
 if(participants>=LIVE_TALK_LIMITS.participants)throw reject('AUDIO_ROOM_FULL');
}
export function audioMonth(now){return new Date(time(now)).toISOString().slice(0,7);}

// Pass crypto.randomInt in production. Persist the result once, never redraw on polling.
export function verificationDueAt(now,randomInt){
 time(now);
 const delay=randomInt(LIVE_TALK_LIMITS.voteDelayMinMs,LIVE_TALK_LIMITS.voteDelayMaxMs+1);
 if(!Number.isSafeInteger(delay)||delay<LIVE_TALK_LIMITS.voteDelayMinMs||delay>LIVE_TALK_LIMITS.voteDelayMaxMs)throw reject('INVALID_VOTE_DELAY');
 return time(now+delay);
}
