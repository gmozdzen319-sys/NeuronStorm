import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {recordDailyLogin,activityPoints} from '../daily-activity.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
test('daily points deduplicate concurrent devices and methods, cross UTC midnight, and never affect reputation',async t=>{
 const app=await createApp();t.after(()=>app.close());const db=app.db,address='0x'+'1'.repeat(40),other='0x'+'2'.repeat(40);
 const now=Date.parse('2026-10-26T23:59:59Z');
 for(const a of [address,other])await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(a,now);
 await saveProfile(db,address,{nickname:'Daily member',work:['Travel'],hobbies:[]},now);
 const before=await readProfile(db,address);assert.equal(before.activityPoints,0);
 await recordDailyLogin(db,null,now);
 await Promise.all(Array.from({length:12},(_,i)=>recordDailyLogin(db,{address,method:['passkey','pelagus','blippay'][i%3]},now)));
 assert.equal(await activityPoints(db,address),1);assert.equal(await activityPoints(db,other),0);
 await recordDailyLogin(db,{address},now+1000);assert.equal(await activityPoints(db,address),2);
 const profile=await readProfile(db,address);assert.equal(profile.activityPoints,2);assert.deepEqual(profile.reputation,before.reputation);assert.deepEqual(profile.verification,before.verification);
 await recordDailyLogin(db,{address},now+2000);assert.equal(await activityPoints(db,address),2);
});
