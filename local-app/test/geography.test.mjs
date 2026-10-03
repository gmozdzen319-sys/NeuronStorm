import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {saveProfile} from '../profiles.mjs';
import {ipNumber,publicIp,clientIp,lookupCountry,globeData} from '../geography.mjs';
test('IP parsing rejects private addresses and only trusts explicitly configured proxy headers',()=>{
  for(const ip of ['127.0.0.1','10.0.0.3','192.168.1.2','::1','2001:db8::1','bad'])assert.equal(publicIp(ip),false);
  assert.equal(publicIp('8.8.8.8'),true);assert.equal(publicIp('2001:4860:4860::8888'),true);
  assert.deepEqual(ipNumber('::ffff:8.8.8.8'),ipNumber('8.8.8.8'));
  const req={headers:{'x-forwarded-for':'8.8.8.8, 10.0.0.1'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(clientIp(req),null);assert.equal(clientIp(req,true),'8.8.8.8');
  assert.match(lookupCountry('8.8.8.8'),/^[A-Z]{2}$/);assert.match(lookupCountry('2001:4860:4860::8888'),/^[A-Z]{2}$/);assert.equal(lookupCountry('127.0.0.1'),null);
});
test('globe requires a profile, defaults to private, aggregates and expires consented presence',t=>{
  const {db}=createApp({database:':memory:'});t.after(()=>db.close());
  const accounts=[1,2].map(n=>({address:'0x'+String(n).padStart(40,'0'),role:'member'}));
  for(const a of accounts){db.prepare('INSERT INTO accounts VALUES(?,?)').run(a.address,1);saveProfile(db,a.address,{nickname:'Member',work:['Lighting'],hobbies:[]},1);}
  const read=(a,input,now=100000)=>globeData(db,a,'8.8.8.8',input,now,()=> 'GB');
  assert.throws(()=>read(null,{}));assert.equal(read(accounts[0],{active:true}).sharingOnline,0);
  read(accounts[0],{enabled:true,active:true});read(accounts[0],{active:true});
  const both=read(accounts[1],{enabled:true,active:true});assert.deepEqual(both.countries.map(c=>({...c})),[{country:'GB',count:2}]);
  assert.equal(JSON.stringify(both).includes(accounts[0].address),false);assert.equal(JSON.stringify(both).includes('8.8.8.8'),false);
  assert.equal(read(accounts[0],{enabled:false,active:true}).sharingOnline,1);
  assert.equal(read(accounts[0],undefined,165000).sharingOnline,0);
  assert.throws(()=>read(accounts[0],{enabled:'yes'}),e=>e.status===400);
  const unknown=globeData(db,accounts[1],null,{active:true},170000);assert.equal(unknown.viewerCountry,null);assert.equal(unknown.sharingOnline,0);
});
