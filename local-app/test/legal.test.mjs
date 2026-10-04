import http from 'node:http';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {Wallet,isQuaiAddress} from 'quais';
import {createApp} from '../server.mjs';
import {loadLegal} from '../legal.mjs';
import {signIn} from '../public/wallet.js';
const config={published:true,operator:'Disposable QA operator — no real agreement',country:'Test country',contactEmail:'qa@example.test',effectiveDate:'2026-10-04',version:'TEST-1'};
async function setup(t){
  const legal=loadLegal(config),app=createApp({database:':memory:',origin:'http://127.0.0.1:43129',legal});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.db.close();});
  let jar='';
  const request=(path,data)=>new Promise((resolve,reject)=>{const req=http.request('http://127.0.0.1:'+app.server.address().port+path,{method:data===undefined?'GET':'POST',headers:{Host:'127.0.0.1:43129',Origin:'http://127.0.0.1:43129','Content-Type':'application/json',Cookie:jar}},res=>{let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{if(res.headers['set-cookie'])jar=res.headers['set-cookie'].map(v=>v.split(';')[0]).join('; ');resolve({status:res.statusCode,data:JSON.parse(raw)});});});req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));});
  let wallet;do{wallet=new Wallet(randomBytes(32).toString('hex'));}while(!isQuaiAddress(wallet.address));
  return {...app,legal,request,wallet,accept:{address:wallet.address,termsAccepted:true,termsHash:legal.hash}};
}
test('published terms require explicit current acceptance; verified signature alone commits evidence and snapshot',async t=>{
  const f=await setup(t);
  for(const data of [{address:f.wallet.address},{...f.accept,termsAccepted:'true'},{...f.accept,termsAccepted:false},{...f.accept,termsHash:'old'}])assert.equal((await f.request('/api/challenge',data)).status,400);
  assert.equal(f.db.prepare('SELECT count(*) n FROM accounts').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM challenges').get().n,0);
  const {data:c}=await f.request('/api/challenge',f.accept);
  assert.ok(c.message.includes(f.legal.hash));assert.ok(c.message.includes('I am at least 18'));assert.ok(c.message.includes('/privacy'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM legal_acceptances').get().n,0);
  const signature=await f.wallet.signMessage(c.message);
  assert.equal((await f.request('/api/verify',{id:c.id,signature})).status,200);
  const row=f.db.prepare('SELECT * FROM legal_acceptances').get();assert.equal(row.address,f.wallet.address.toLowerCase());assert.equal(row.document_hash,f.legal.hash);assert.equal(row.message,c.message);assert.equal(row.signature,signature);assert.ok(row.accepted_at>0);
  assert.equal(f.db.prepare('SELECT terms FROM legal_documents').get().terms,f.legal.terms);
  assert.equal((await f.request('/api/verify',{id:c.id,signature})).status,401);
});
test('rejected signature cannot record consent; a changed document invalidates outstanding challenge',async t=>{
  const f=await setup(t);let {data:c}=await f.request('/api/challenge',f.accept);
  assert.equal((await f.request('/api/verify',{id:c.id,signature:'bad'})).status,401);
  assert.equal(f.db.prepare('SELECT count(*) n FROM legal_acceptances').get().n,0);
  ({data:c}=await f.request('/api/challenge',f.accept));const signature=await f.wallet.signMessage(c.message);
  f.legal.hash='changed';assert.equal((await f.request('/api/verify',{id:c.id,signature})).status,409);
  assert.equal(f.db.prepare('SELECT count(*) n FROM accounts').get().n,0);
});
test('wallet sends affirmative acceptance before requesting signature and stops if server refuses',async()=>{
  const address='0x'+'00'.repeat(20),calls=[];
  const provider={request:async({method})=>{calls.push(method);return [address];}};
  await assert.rejects(signIn(provider,address,async(path,data)=>{assert.equal(path,'/api/challenge');assert.equal(data.termsAccepted,true);assert.equal(data.termsHash,'current');throw new Error('Stale terms');},()=>{},{accepted:true,hash:'current'}),/Stale terms/);
  assert.deepEqual(calls,['quai_accounts']);
});
test('incomplete operator details cannot be published; document hash covers content and identity',()=>{
  assert.equal(loadLegal({published:false,version:'DRAFT'}).published,false);
  assert.throws(()=>loadLegal({...config,operator:''}),/operator/);
  assert.notEqual(loadLegal(config).hash,loadLegal({...config,operator:'Changed operator'}).hash);
});
