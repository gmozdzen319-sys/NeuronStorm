import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createApp} from './database.mjs';
import {desktopHeartbeat,desktopStatistics,recordDesktopDownload} from '../desktop-statistics.mjs';
test('desktop presence deduplicates users, counts background mining and expires lost apps',async()=>{
 const {db}=await createApp();try{
 const req={headers:{'x-ns-desktop-presence':'1'}},a='a'.repeat(32),b='b'.repeat(32),c='c'.repeat(32);
 const beat=(id,account,mining,at)=>desktopHeartbeat(db,account,req,{instance:id,mining},at);
 assert.deepEqual(await desktopStatistics(db,100),{online:0,mining:0,downloads:0,asOf:100});
 await beat(a,{id:'same'},false,100);await beat(b,{id:'same'},true,100);
 assert.equal((await desktopStatistics(db,101)).online,1);assert.equal((await desktopStatistics(db,101)).mining,1);
 await beat(c,null,true,100);assert.equal((await desktopStatistics(db,101)).online,2);assert.equal((await desktopStatistics(db,101)).mining,1);
 await beat(b,{id:'same'},false,200);assert.equal((await desktopStatistics(db,201)).mining,0);
 await beat(a,{id:'same'},true,59000);assert.equal((await desktopStatistics(db,60200)).online,1);
 assert.equal((await desktopStatistics(db,119000)).online,0);
 await assert.rejects(desktopHeartbeat(db,null,{headers:{...req.headers,origin:'https://evil.test'}},{instance:a,mining:true},1),e=>e.status===403);
 await assert.rejects(beat('invalid',null,false,1),e=>e.status===400);
 await Promise.all(Array.from({length:5},()=>recordDesktopDownload(db)));assert.equal((await desktopStatistics(db,119000)).downloads,5);
 }finally{await db.close();}
});
test('download counter ignores page views and HEAD; public activity permits only Desktop CORS',async()=>{
 const {db,server}=await createApp();
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const request=(p,options={})=>new Promise((resolve,reject)=>{const req=http.request(base+p,{...options,headers:{Host:'localhost:3000',...options.headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key]??null}}));});req.on('error',reject);req.end();});
 try{
  // Use the configured host required by the production HTTP boundary.
  const stats=await request('/api/desktop-statistics');assert.equal(stats.status,200);
  const head=await request('/downloads/Neuron-Storm-Desktop-Windows-x64.exe',{method:'HEAD'});assert.equal(head.status,200);
  assert.equal((await desktopStatistics(db,Date.now())).downloads,0);
  const download=await request('/downloads/Neuron-Storm-Desktop-Windows-x64.exe');assert.equal(download.status,200);
  for(let i=0;i<20&&(await desktopStatistics(db,Date.now())).downloads===0;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal((await desktopStatistics(db,Date.now())).downloads,1);
  const activity=await request('/api/network-activity',{headers:{origin:'http://tauri.localhost'}});assert.equal(activity.headers.get('access-control-allow-origin'),'http://tauri.localhost');
  const other=await request('/api/network-activity',{headers:{origin:'https://other.example'}});assert.equal(other.headers.get('access-control-allow-origin'),null);
 }finally{await new Promise(resolve=>server.close(resolve));await db.close();}
});
