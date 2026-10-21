import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {profileErrors,onboardingState} from '../public/profile-validation.js';
import {saveProfile} from '../profiles.mjs';
import {createApp} from './database.mjs';

test('Profile validation module is served publicly for the registration form',async t=>{
 const app=await createApp({database:':memory:'});t.after(()=>app.close());
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const response=await new Promise((resolve,reject)=>{const req=http.get({hostname:'127.0.0.1',port:app.server.address().port,path:'/profile-validation.js',headers:{Host:'localhost:3000'}},res=>{let body='';res.on('data',x=>body+=x);res.on('end',()=>resolve({status:res.statusCode,type:res.headers['content-type'],body}));});req.on('error',reject);});
 assert.equal(response.status,200);assert.match(response.type,/javascript/);
 assert.match(response.body,/export function profileErrors/);
});

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


test('Onboarding locks navigation until saved; only Passkey waits for verified wallet readiness',()=>{
 for(const method of ['passkey','pelagus','blippay']){
 assert.deepEqual(onboardingState({method},null,false),{locked:true,waitingForWallet:method==='passkey'});
 assert.deepEqual(onboardingState({method},null,true),{locked:true,waitingForWallet:false});
 assert.deepEqual(onboardingState({method},{nickname:'User'},false),{locked:false,waitingForWallet:false});
 }
 assert.deepEqual(onboardingState(null,null,false),{locked:false,waitingForWallet:false});
});
