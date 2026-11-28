import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {createPulseAccess} from '../pulse-access.mjs';
test('HTTPS relay routes enforce canonical session, logout, CSRF and bounded input',async()=>{
 const sessions=new Map([['a',{id:'a'}],['b',{id:'b'}]]);let checks=0;
 const route=createPulseAccess({account:async req=>{checks++;return sessions.get(req.headers.cookie);}});
 const server=createServer(async(req,res)=>{if(!await route(req,res,new URL(req.url,'http://local').pathname))res.writeHead(404).end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/api/pulse/live`;
 const body={action:'poll',node:'a'.repeat(32),preferences:{enabled:true,receive:true,mood:'good',mood_until:Date.now()/1000+86400,country:null},blocked:[],acks:[]};
 const request=(cookie,extra={},data=body)=>fetch(url,{method:'POST',headers:{Cookie:cookie,'X-NS-Desktop':'1',...extra},body:JSON.stringify(data)});
 try{
 assert.equal((await request('unknown')).status,401);assert.equal((await request('a',{Origin:'https://attacker.example'})).status,403);
 assert.equal((await request('a',{'X-NS-Desktop':''})).status,403);
 assert.equal((await request('a')).status,200);assert.equal((await request('b')).status,200);
 const sent=await (await request('a',{}, {action:'send',node:body.node})).json();assert.ok(sent.events.some(e=>e.type==='selected'));assert.ok(!sent.events.some(e=>e.type==='delivered'));
 const received=await (await request('b')).json();const incoming=received.events.find(e=>e.type==='received');assert.ok(incoming);
 await request('b',{}, {...body,acks:[incoming.id]});assert.ok((await (await request('a')).json()).events.some(e=>e.type==='delivered'));
 sessions.delete('a');assert.equal((await request('a')).status,401);assert.equal((await fetch(url,{headers:{Cookie:'a'}})).status,401);
 assert.equal((await request('b',{}, {padding:'x'.repeat(70001)})).status,413);assert.ok(checks>=10);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
