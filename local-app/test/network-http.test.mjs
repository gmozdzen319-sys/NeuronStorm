import http from 'node:http';import test from 'node:test';import assert from 'node:assert/strict';import {createApp} from './database.mjs';
test('live network read-only endpoint and modules work without exposing attachment access',async()=>{
 const app=await createApp({origin:'http://test.local'});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;const get=path=>new Promise((resolve,reject)=>{http.get(base+path,{headers:{host:'test.local'}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key]},json:async()=>JSON.parse(text)}));}).on('error',reject);});
 try{let res=await get('/api/network-activity');assert.equal(res.status,200);const data=await res.json();assert.deepEqual(data.events,[]);assert.ok(Number.isFinite(data.through));
 for(const file of ['network-story-data.js','network-live.js','neuron-background.js']){res=await get('/'+file);assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/javascript/);}
 res=await get('/api/network-avatar/00000000-0000-0000-0000-000000000001');assert.equal(res.status,404);
 res=await get('/api/files/00000000-0000-0000-0000-000000000001');assert.equal(res.status,401);
 }finally{await app.close();}
});
