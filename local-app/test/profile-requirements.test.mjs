import test from 'node:test';
import assert from 'node:assert/strict';
import {profileErrors} from '../public/profile-validation.js';
import {saveProfile} from '../profiles.mjs';

test('All registration methods require nickname and at least one selected or entered topic',()=>{
 for(const method of ['passkey','pelagus','blippay']){
  const missing=profileErrors({nickname:'  ',work:[],hobbies:[]});
  assert(missing.nickname&&missing.topics,method);
  assert(profileErrors({nickname:'User',work:[],hobbies:[]}).topics);
  assert(profileErrors({nickname:'',work:['Science']}).nickname);
  for(const fields of [{work:['Science']},{hobbies:['My new topic']}])assert.deepEqual(profileErrors({nickname:'User',...fields}),{nickname:null,topics:null});
 }
});

test('Direct profile writes cannot bypass requirements, before any database mutation',async()=>{
 const db={prepare(){throw Error('Unexpected database access');},transaction:async fn=>fn(),lock:async()=>{}};
 for(const input of [{nickname:'',work:['Science'],hobbies:[]},{nickname:'  ',work:['Science'],hobbies:[]},{nickname:'User',work:[],hobbies:[]},{nickname:'User',work:[' '],hobbies:[]}]){
  await assert.rejects(saveProfile(db,'account',input,1),error=>error.status===400);
 }
});
