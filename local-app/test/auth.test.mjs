import {NS_TOKEN,createNeuronReader} from '../neuron-token.mjs';
import {addNeuronToken,createSignedSender} from '../public/wallet.js';
import {mockTokenFetch} from './token-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, isQuaiAddress } from 'quais';
import { createApp, ADMIN } from '../server.mjs';
import { authenticate, walletError, connectWallet, signIn } from '../public/wallet.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import http from 'node:http';
import {formatBalance,createHoldingsReader} from '../holdings.mjs';

test('wallet shows NS only for authenticated address and never calls the asset indexer', async t => {
  const seen=[];
  const f=await fixture(t,{holdingsFetch:async url=>{seen.push(url);return {ok:true,json:async()=>({status:'1',result:url.searchParams.get('action')==='balance'?'123456789012345678901234567890':[{name:'Test token',symbol:'TEST',type:'ERC-20',contractAddress:'0x0000000000000000000000000000000000000001',balance:'1000001',decimals:'6'}]})};}});
  assert.equal((await f.request('/api/wallet')).status,401);assert.equal(seen.length,0);
  await f.login();
  const result=await f.request('/api/wallet?address='+other.address);
  assert.equal(result.status,200);assert.equal(result.data.address,wallet.address);
  assert.deepEqual(result.data.assets.map(a=>a.symbol),['NS']);
  assert.ok(seen.every(url=>url.searchParams.get('address')===wallet.address));
  await f.request('/api/wallet');assert.equal(seen.length,0);
  await f.request('/api/logout',{});assert.equal((await f.request('/api/wallet')).status,401);
});
test('wallet distinguishes empty holdings from explorer failures and invalid data', async()=>{
  assert.equal(formatBalance('1',18),'0.000000000000000001');
  assert.throws(()=>formatBalance('NaN',18));assert.throws(()=>formatBalance('1',256));
  const address='0x0000000000000000000000000000000000000000';
  const read=createHoldingsReader(async url=>({ok:true,json:async()=>url.searchParams.get('action')==='balance'?{status:'1',result:'0'}:{status:'0',message:'No tokens found',result:[]}}));
  assert.equal((await read(address)).assets.length,1);
  for(const data of [{status:'0',message:'Rate limited',result:[]},{status:'1',result:[{contractAddress:address,balance:'invalid',decimals:18}]}]){
    const fail=createHoldingsReader(async url=>({ok:true,json:async()=>url.searchParams.get('action')==='balance'?{status:'1',result:'0'}:data}));
    await assert.rejects(fail(address),e=>e.status===502);
  }
});

const testSigners=new Map();
function newWallet() { let w; do { w = new Wallet(randomBytes(32).toString('hex')); } while (!isQuaiAddress(w.address)); testSigners.set(w.address.toLowerCase(),w); return w; }
const wallet = newWallet(), other = newWallet();
async function fixture(t, extra = {}) {
  const app = createApp({ database: ':memory:', tokenFetch:mockTokenFetch, ...extra });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); app.db.close(); });
  const jar = {};
  async function request(path, data, headers = {}) {
    // Exercise the real signature flow using only disposable test wallets.
    if(data?.body!==undefined&&(path==='/api/questions'||/^\/api\/questions\/[^/]+\/replies$/.test(path))){
      const challenge=await request('/api/actions/challenge',{path,payload:data},headers);
      if(challenge.status!==200)return challenge;
      const session=(headers.Cookie??('ns_session='+jar.ns_session)).match(/ns_session=([^;]+)/)?.[1];
      const account=session&&app.db.prepare('SELECT address FROM sessions WHERE token_hash=?').get(createHash('sha256').update(session).digest('hex'));
      const signer=account&&testSigners.get(account.address);
      if(signer)data={actionId:challenge.data.id,signature:await signer.signMessage(challenge.data.message)};
    }
    return new Promise((resolve,reject)=>{
      const req=http.request(url+path,{method:data===undefined?'GET':'POST',headers:{Host:'localhost:3000',Origin:'http://localhost:3000','Content-Type':'application/json',Cookie:Object.entries(jar).map(([k,v])=>`${k}=${v}`).join('; '),...headers}},res=>{
        let raw='';res.on('data',chunk=>raw+=chunk);res.on('end',()=>{
          for(const c of res.headers['set-cookie']||[]){const [k,v]=c.split(';')[0].split('=');jar[k]=v;}
          resolve({status:res.statusCode,data:JSON.parse(raw),headers:{get:name=>String(res.headers[name])}});
        });
      });req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));
    });
  }
  const challenge = async (address = wallet.address) => (await request('/api/challenge', { address })).data;
  const login = async (signer = wallet) => { const c = await challenge(signer.address); const result=await request('/api/verify', { id: c.id, signature: await signer.signMessage(c.message) });if(result.status===200)await request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true});return result; };
  return { ...app, request, challenge, login, jar };
}
test('address alone is not authentication; signature creates session; logout revokes it', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/session')).data.account, null);
  const c = await f.challenge();
  assert.equal((await f.request('/api/session')).data.account, null);
  const result = await f.request('/api/verify', { id: c.id, signature: await wallet.signMessage(c.message) });
  assert.equal(result.status, 200); assert.equal(result.data.account.address, wallet.address); assert.equal(result.data.account.role, 'member');
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const old = f.jar.ns_session;
  assert.equal((await f.request('/api/session')).data.account.address, wallet.address);
  assert.equal(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash === old, false);
  assert.equal((await f.request('/api/logout', {})).status, 200);
  assert.equal((await f.request('/api/session', undefined, { Cookie: `ns_session=${old}` })).data.account, null);
});
test('invalid signature is rejected and consumes the challenge', async t => {
  const f = await fixture(t), c = await f.challenge();
  assert.equal((await f.request('/api/verify', { id:c.id, signature:'0x00' })).status, 401);
  assert.equal((await f.request('/api/verify', { id:c.id, signature:await wallet.signMessage(c.message) })).status, 401);
});
test('signature from another wallet is rejected', async t => {
  const f = await fixture(t), c = await f.challenge();
  assert.equal((await f.request('/api/verify', { id:c.id, signature:await other.signMessage(c.message) })).status, 401);
});
test('replay and simultaneous replay are rejected', async t => {
  const f = await fixture(t), c = await f.challenge(), signature = await wallet.signMessage(c.message);
  const results = await Promise.all([f.request('/api/verify', {id:c.id,signature}),f.request('/api/verify', {id:c.id,signature})]);
  assert.deepEqual(results.map(r=>r.status).sort(), [200,401]);
  assert.equal((await f.request('/api/verify', {id:c.id,signature})).status,401);
});
test('challenge is bound to the issuing browser', async t => {
  const f = await fixture(t), c = await f.challenge();
  assert.equal((await f.request('/api/verify', {id:c.id,signature:await wallet.signMessage(c.message)}, {Cookie:''})).status,401);
});
test('expired challenges and sessions are rejected', async t => {
  let time=Date.now(); const f=await fixture(t,{now:()=>time}), c=await f.challenge();
  time+=300001;
  assert.equal((await f.request('/api/verify',{id:c.id,signature:await wallet.signMessage(c.message)})).status,401);
  assert.equal((await f.login()).status,200); time+=28800001;
  assert.equal((await f.request('/api/session')).data.account,null);
});
test('foreign origins, host spoofing and invalid addresses are rejected', async t => {
  const f=await fixture(t);
  assert.equal((await f.request('/api/challenge',{address:wallet.address},{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.request('/api/session',undefined,{Host:'evil.example'})).status,403);
  assert.equal((await f.request('/api/challenge',{address:'bad'})).status,400);
});
test('administrator address does not grant access without its signature', async t => {
  const f=await fixture(t), c=await f.challenge(ADMIN);
  assert.equal((await f.request('/api/verify',{id:c.id,signature:await wallet.signMessage(c.message),role:'admin'})).status,401);
  assert.equal((await f.request('/api/session')).data.account,null);
});
test('repeat login keeps one account and rotates session', async t => {
  const f=await fixture(t); await f.login(); const previous=f.jar.ns_session; await f.login();
  assert.notEqual(f.jar.ns_session,previous);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM accounts').get().n,1);
  assert.equal((await f.request('/api/session',undefined,{Cookie:`ns_session=${previous}`})).data.account,null);
});
test('session and account persist after database is reopened', async t => {
  const folder=mkdtempSync(join(tmpdir(),'neuron-auth-')), database=join(folder,'auth.sqlite');
  const first=createApp({database});
  first.db.prepare('INSERT INTO accounts VALUES(?,?)').run(wallet.address.toLowerCase(),Date.now());
  const session=randomBytes(32).toString('hex');
  first.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),wallet.address.toLowerCase(),Date.now()+60000);
  first.db.close();
  const second=await fixture(t,{database});
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
  assert.equal(second.db.prepare('SELECT address FROM accounts').get().address,wallet.address.toLowerCase());
  assert.equal((await second.request('/api/session',undefined,{Cookie:`ns_session=${session}`})).data.account.address,wallet.address);
});
test('malformed JSON values do not create accounts', async t => {
  const f=await fixture(t);
  assert.equal((await f.request('/api/challenge',null)).status,400);
  assert.equal((await f.request('/api/challenge',[])).status,400);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM accounts').get().n,0);
});
test('missing wallet and refused signature leave user unauthenticated', async () => {
  await assert.rejects(authenticate(undefined,()=>assert.fail()), /Pelagus was not detected/);
  let verified=false;
  const provider={request:async ({method})=>{if(method==='quai_requestAccounts'||method==='quai_accounts') return [wallet.address]; throw Object.assign(new Error('rejected'),{code:4001});}};
  await assert.rejects(authenticate(provider,async path=>{if(path==='/api/verify') verified=true; return {id:'test',message:'test'};}));
  assert.equal(verified,false); assert.match(walletError({code:4001}), /code alone cannot distinguish/);
});
test('frontend RPC flow signs UTF-8 with Quai SDK and verifies through real HTTP server', async t => {
  const f=await fixture(t); const methods=[];
  const provider={request:async ({method,params})=>{methods.push(method); if(method==='quai_requestAccounts'||method==='quai_accounts') return [wallet.address]; if(method==='personal_sign') return wallet.signMessage(Buffer.from(params[0].slice(2),'hex')); throw new Error(method);}};
  const result=await authenticate(provider,async(path,data)=>{const r=await f.request(path,data);if(r.status!==200)throw new Error(r.data.error);return r.data;});
  assert.equal(result.account.address,wallet.address);
  assert.deepEqual(methods,['quai_requestAccounts','quai_accounts','personal_sign','quai_accounts']);
});
test('account switch during signing is rejected before verification', async () => {
  const provider={request:async({method})=>method==='quai_requestAccounts'?[wallet.address]:method==='quai_accounts'?[other.address]:'signature'};
  await assert.rejects(authenticate(provider,async path=>{assert.equal(path,'/api/challenge');return {id:'id',message:'message'};}),/account has changed/);
});


test('connection alone neither requests signature nor creates challenge', async () => {
  const methods=[];
  const address=await connectWallet({request:async({method})=>{methods.push(method);return [wallet.address];}});
  assert.equal(address,wallet.address);
  assert.deepEqual(methods,['quai_requestAccounts']);
});

test('4001 after signing is reported as ambiguous wallet failure with signing stage', async () => {
  const methods=[];
  const provider={request:async({method})=>{
    methods.push(method);
    if(method==='quai_accounts') return [wallet.address];
    throw Object.assign(new Error('The user rejected the request.'),{code:4001});
  }};
  let caught;
  try { await signIn(provider,wallet.address,async path=>{assert.equal(path,'/api/challenge');return {id:'id',message:'Test podpisu — ąęł'};}); } catch(error) {caught=error;}
  assert.equal(caught.stage,'sign');
  assert.match(walletError(caught),/message signing; code: 4001/);
  assert.match(walletError(caught),/wallet error/);
  assert.doesNotMatch(walletError(caught),/Sign-in cancelled/);
  assert.deepEqual(methods,['quai_accounts','personal_sign']);
});

test('server verification errors are distinct from wallet errors', async () => {
  const provider={request:async({method})=>method==='quai_accounts'?[wallet.address]:'0x'+'ab'.repeat(65)};
  await assert.rejects(signIn(provider,wallet.address,async path=>{if(path==='/api/challenge')return {id:'id',message:'test'};throw new Error('Podpis nie pasuje do wybranego konta.');}),error=>{
    assert.equal(error.stage,'verify');
    assert.match(walletError(error),/server verification/);
    assert.doesNotMatch(walletError(error),/cancelled/);return true;
  });
});

test('nested error codes preserve pending/unsupported/authorization diagnostics', () => {
  assert.match(walletError({error:{code:-32002},stage:'sign'}),/earlier request/);
  assert.match(walletError({info:{error:{code:4200}},stage:'sign'}),/does not support/);
  assert.match(walletError({code:4100,stage:'connect'}),/has not granted/);
});

const profileInput = {nickname:'  Nova  ',firstName:'',lastName:'',work:[],hobbies:['  Star Gazing  ']};
test('profile creation, reload, repeat login and editing preserve one profile',async t=>{
  const f=await fixture(t);await f.login();
  assert.equal((await f.request('/api/profile')).data.profile,null);
  let saved=await f.request('/api/profile',profileInput);
  assert.equal(saved.status,200);assert.equal(saved.data.profile.nickname,'Nova');assert.equal(saved.data.profile.hobbies[0].name,'Star Gazing');
  assert.deepEqual((await f.request('/api/profile')).data.profile,saved.data.profile);
  await f.request('/api/logout',{});await f.login();
  assert.equal((await f.request('/api/profile')).data.profile.nickname,'Nova');
  saved=await f.request('/api/profile',{nickname:'Nova 2',firstName:'Éva',lastName:'Kowalska',work:['Electrical Engineering'],hobbies:[]});
  assert.equal(saved.data.profile.firstName,'Éva');assert.equal(saved.data.profile.work.length,1);assert.equal(saved.data.profile.hobbies.length,0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM profiles').get().n,1);
});
test('profiles and category lists require a valid session; claimed address grants no access',async t=>{
  const f=await fixture(t);
  assert.equal((await f.request('/api/profile')).status,401);
  assert.equal((await f.request('/api/categories')).status,401);
  assert.equal((await f.request('/api/profile',{...profileInput,address:wallet.address})).status,401);
  await f.login();await f.request('/api/profile',profileInput);await f.request('/api/logout',{});
  assert.equal((await f.request('/api/profile')).status,401);
});
test('shared categories ignore case and all whitespace; accounts stay isolated',async t=>{
  const f=await fixture(t);await f.login();
  const a=(await f.request('/api/profile',{...profileInput,hobbies:['Star Gazing','starGAZING',' star   gazing ']})).data.profile;
  assert.equal(a.hobbies.length,1);
  await f.login(other);
  assert.equal((await f.request('/api/profile?address='+wallet.address)).data.profile,null);
  assert.equal((await f.request('/api/categories')).data.categories.hobbies[0].id,a.hobbies[0].id);
  const b=await f.request('/api/profile',{nickname:'Orion',work:[],hobbies:[' STARGAZING ','Painting'],address:wallet.address,role:'admin'});
  assert.equal(b.status,200);assert.equal(b.data.profile.hobbies.find(x=>x.name==='Star Gazing').id,a.hobbies[0].id);
  assert.equal((await f.request('/api/session')).data.account.role,'member');
  await f.login();assert.equal((await f.request('/api/profile')).data.profile.nickname,'Nova');
  assert.equal((await f.request('/api/profile')).data.profile.hobbies.length,1);
  assert.equal((await f.request('/api/categories')).data.categories.hobbies.length,2);
});
test('invalid profile does not overwrite existing data or create orphan topics',async t=>{
  const f=await fixture(t);await f.login();await f.request('/api/profile',profileInput);
  for(const payload of [{...profileInput,nickname:''},{...profileInput,work:[],hobbies:[]},{...profileInput,nickname:'x'.repeat(41)},{...profileInput,hobbies:['New topic'],firstName:5},{...profileInput,hobbies:['x'.repeat(61)]},{...profileInput,hobbies:Array.from({length:21},(_,i)=>'Topic '+i)},{...profileInput,work:'Engineering'}])assert.equal((await f.request('/api/profile',payload)).status,400);
  assert.equal((await f.request('/api/profile')).data.profile.nickname,'Nova');
  assert.equal((await f.request('/api/categories')).data.categories.hobbies.length,1);
});
test('profile writes reject foreign origin and expired sessions',async t=>{
  let time=Date.now();const f=await fixture(t,{now:()=>time});await f.login();
  assert.equal((await f.request('/api/profile',profileInput,{Origin:'https://evil.example'})).status,403);
  time+=28800001;
  assert.equal((await f.request('/api/profile',profileInput)).status,401);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM profiles').get().n,0);
});
test('profile and categories survive database reopening',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'neuron-profile-')),database=join(folder,'profile.sqlite');
  const first=await fixture(t,{database});await first.login();await first.request('/api/profile',profileInput);
  const second=await fixture(t,{database});await second.login();
  assert.equal((await second.request('/api/profile')).data.profile.nickname,'Nova');
  assert.equal((await second.request('/api/categories')).data.categories.hobbies[0].name,'Star Gazing');
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
});
test('administrator also starts with no profile and profile data cannot alter role',async t=>{
  const f=await fixture(t),session=randomBytes(32).toString('hex');
  f.db.prepare('INSERT INTO accounts VALUES(?,?)').run(ADMIN,Date.now());
  f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),ADMIN,Date.now()+60000);
  f.jar.ns_session=session;await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true});
  assert.equal((await f.request('/api/profile')).data.profile,null);
  assert.equal((await f.request('/api/profile',{...profileInput,role:'member'})).status,200);
  assert.equal((await f.request('/api/session')).data.account.role,'admin');
});

async function createMember(f,signer,nickname,work){delete f.jar.ns_session;await f.login(signer);await f.request('/api/profile',{nickname,work,hobbies:[]});return {Cookie:`ns_session=${f.jar.ns_session}`};}
test('shared thread reaches two recipients; outsiders blocked; unread, snapshots and admin enforced',async t=>{
  let time=Date.now();const f=await fixture(t,{now:()=>time});
  const author=newWallet(),a=newWallet(),b=newWallet(),outsider=newWallet();
  const authorHeaders=await createMember(f,author,'Cook',['Cooking']);
  const aHeaders=await createMember(f,a,'Electrician A',['Electrical work']);
  const bHeaders=await createMember(f,b,'Electrician B',['Electrical work']);
  const outsiderHeaders=await createMember(f,outsider,'Observer',['Gardening']);
  const category=(await f.request('/api/categories',undefined,authorHeaders)).data.categories.work.find(c=>c.name==='Electrical work').id;
  const sent=await f.request('/api/questions',{categoryId:category,body:'How can I plan the lighting in my kitchen?',author:outsider.address},authorHeaders);
  assert.equal(sent.status,201);assert.equal(sent.data.recipientCount,2);const id=sent.data.id;
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM questions').get().n,1);
  for(const h of [aHeaders,bHeaders]){const q=(await f.request('/api/questions?view=inbox',undefined,h)).data.questions;assert.equal(q.length,1);assert.equal(q[0].unread,true);assert.equal(q[0].author,'Cook');}
  assert.equal((await f.request('/api/questions?view=mine',undefined,authorHeaders)).data.questions[0].id,id);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,authorHeaders)).data.questions.length,0);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,outsiderHeaders)).data.questions.length,0);
  assert.equal((await f.request('/api/questions?view=mine',undefined,outsiderHeaders)).data.questions.length,0);
  for(const action of ['', '/replies','/read'])assert.equal((await f.request('/api/questions/'+id+action,action===''?undefined:action==='/read'?{revision:1}:{body:'Intrusion'},outsiderHeaders)).status,404);
  assert.equal((await f.request('/api/questions/'+id,undefined,{Cookie:''})).status,401);
  assert.equal((await f.request('/api/questions/'+id+'/read',{revision:2},aHeaders)).status,400);
  await f.request('/api/questions/'+id+'/read',{revision:1},aHeaders);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,aHeaders)).data.questions[0].unread,false);
  time+=100;
  await f.request('/api/questions/'+id+'/replies',{body:'Start with a lighting plan.',author:outsider.address},aHeaders);
  for(const h of [bHeaders,authorHeaders]){const thread=(await f.request('/api/questions/'+id,undefined,h)).data.thread;assert.equal(thread.replies[0].body,'Start with a lighting plan.');assert.equal(thread.replies[0].author,'Electrician A');}
  assert.equal((await f.request('/api/questions?view=mine',undefined,authorHeaders)).data.questions[0].unread,true);
  await f.request('/api/questions/'+id+'/read',{revision:1},aHeaders);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,aHeaders)).data.questions[0].unread,true);
  await f.request('/api/questions/'+id+'/read',{revision:2},bHeaders);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,bHeaders)).data.questions[0].unread,false);
  await f.request('/api/questions/'+id+'/replies',{body:'Thank you!'},authorHeaders);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,bHeaders)).data.questions[0].unread,true);
  await f.request('/api/profile',{nickname:'Electrician A',work:['Gardening'],hobbies:[]},aHeaders);
  await f.request('/api/profile',{nickname:'Observer',work:['Electrical work'],hobbies:[]},outsiderHeaders);
  assert.equal((await f.request('/api/questions/'+id,undefined,aHeaders)).status,200);
  assert.equal((await f.request('/api/questions/'+id+'/replies',{body:'Still here.'},aHeaders)).status,201);
  assert.equal((await f.request('/api/questions/'+id,undefined,outsiderHeaders)).status,404);
  const newer=await f.request('/api/questions',{categoryId:category,body:'Another question.'},authorHeaders);
  assert.equal(newer.data.recipientCount,2);
  assert.equal((await f.request('/api/questions/'+newer.data.id,undefined,aHeaders)).status,404);
  assert.equal((await f.request('/api/questions/'+newer.data.id,undefined,outsiderHeaders)).status,200);
  const adminToken=randomBytes(32).toString('hex');f.db.prepare('INSERT INTO accounts VALUES(?,?)').run(ADMIN,time);f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(adminToken).digest('hex'),ADMIN,time+60000);
  const adminHeaders={Cookie:`ns_session=${adminToken}`};await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true},adminHeaders);await f.request('/api/profile',{nickname:'Admin',work:['Administration'],hobbies:[]},adminHeaders);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,adminHeaders)).data.questions.length,2);
  assert.equal((await f.request('/api/questions/'+id,undefined,adminHeaders)).status,200);
  assert.equal((await f.request('/api/questions/'+id+'/replies',{body:'Admin note'},adminHeaders)).status,400);
});
test('no recipients, invalid messages, incomplete profiles and foreign origins cannot create threads',async t=>{
  const f=await fixture(t);await f.login();
  assert.equal((await f.request('/api/questions?view=inbox')).status,403);
  await f.request('/api/profile',{nickname:'Solo',work:['Solo topic'],hobbies:[]});
  const category=(await f.request('/api/categories')).data.categories.work[0].id;
  assert.equal((await f.request('/api/questions',{categoryId:category,body:'Hello'})).status,409);
  assert.equal((await f.request('/api/questions',{categoryId:category,body:' '})).status,400);
  assert.equal((await f.request('/api/questions',{categoryId:category,body:'x'.repeat(4001)})).status,400);
  assert.equal((await f.request('/api/questions',{categoryId:99999,body:'Hello'})).status,400);
  assert.equal((await f.request('/api/questions',{categoryId:category,body:'Hello'},{Origin:'https://evil.example'})).status,403);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM questions').get().n,0);
});
test('questions, replies, recipients and read state survive database reopening',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'neuron-threads-')),database=join(folder,'threads.sqlite');
  const first=await fixture(t,{database});const author=newWallet(),recipient=newWallet();
  const ah=await createMember(first,author,'Author',['Writing']),rh=await createMember(first,recipient,'Reader',['Books']);
  const category=(await first.request('/api/categories',undefined,ah)).data.categories.work.find(c=>c.name==='Books').id;
  const id=(await first.request('/api/questions',{categoryId:category,body:'Any book suggestions?'},ah)).data.id;
  await first.request('/api/questions/'+id+'/replies',{body:'Try a library.'},rh);await first.request('/api/questions/'+id+'/read',{revision:2},rh);
  const second=await fixture(t,{database});await second.login(recipient);
  assert.equal((await second.request('/api/questions/'+id)).data.thread.replies[0].body,'Try a library.');
  assert.equal((await second.request('/api/questions?view=inbox')).data.questions[0].unread,false);
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
});


test('multiple topic groups deliver once per member and expose aggregate statistics only',async t=>{
  const f=await fixture(t);assert.equal((await f.request('/api/stats')).status,200);
  const ah=await createMember(f,newWallet(),'Author',['Writing']);
  const rh=await createMember(f,newWallet(),'Reader',['Books']);
  await f.request('/api/profile',{nickname:'Reader',work:['Books'],hobbies:['Gardening']},rh);
  const sh=await createMember(f,newWallet(),'Gardener',['Other']);
  await f.request('/api/profile',{nickname:'Gardener',work:[],hobbies:['Gardening']},sh);
  const catalog=(await f.request('/api/categories',undefined,ah)).data.categories;
  const ids=[catalog.work.find(c=>c.name==='Books').id,catalog.hobbies[0].id];
  for(const categoryIds of [[],[999999],[ids[0],'bad'],'bad'])assert.equal((await f.request('/api/questions',{categoryIds,body:'Question'},ah)).status,400);
  const sent=await f.request('/api/questions',{categoryIds:[...ids,ids[0]],body:'A question for both groups'},ah);
  assert.equal(sent.status,201);assert.equal(sent.data.recipientCount,2);
  for(const headers of [rh,sh]){const list=(await f.request('/api/questions?view=inbox',undefined,headers)).data.questions;assert.equal(list.length,1);assert.equal(list[0].categories.length,2);}
  assert.equal((await f.request('/api/questions/'+sent.data.id,undefined,ah)).data.thread.categories.length,2);
  await f.request('/api/questions/'+sent.data.id+'/replies',{body:'Reply'},rh);
  assert.deepEqual((await f.request('/api/stats',undefined,ah)).data.stats,{members:3,topics:4,questions:1,replies:1});
});

test('ratings are one per voter, private, reversible and award only received upvotes',async t=>{
  const f=await fixture(t),ah=await createMember(f,newWallet(),'Author',['Books']),rh=await createMember(f,newWallet(),'Reader',['Books']),bh=await createMember(f,newWallet(),'Second',['Books']),oh=await createMember(f,newWallet(),'Outsider',['Other']);
  const categoryId=(await f.request('/api/categories',undefined,ah)).data.categories.work.find(c=>c.name==='Books').id;
  const id=(await f.request('/api/questions',{categoryId,body:'Question'},ah)).data.id;
  await f.request('/api/questions/'+id+'/replies',{body:'An answer'},rh);
  const reply=(await f.request('/api/questions/'+id,undefined,ah)).data.thread.replies[0],path='/api/questions/'+id+'/replies/'+reply.id+'/vote';
  assert.equal((await f.request(path,{value:1},rh)).status,403);
  assert.equal((await f.request(path,{value:1},oh)).status,404);
  assert.equal((await f.request(path,{value:1},{Cookie:''})).status,401);
  assert.equal((await f.request(path,{value:1},{...ah,Origin:'https://evil.example'})).status,403);
  for(const value of [2,'1',null])assert.equal((await f.request(path,{value},ah)).status,400);
  await Promise.all([f.request(path,{value:1},ah),f.request(path,{value:1},ah)]);
  await f.request(path,{value:1},bh);
  assert.equal((await f.request('/api/profile',undefined,rh)).data.profile.points,2);
  let rated=(await f.request('/api/questions/'+id,undefined,ah)).data.thread.replies[0];
  assert.equal(rated.upvotes,2);assert.equal(rated.myVote,1);
  await f.request(path,{value:-1},ah);
  rated=(await f.request('/api/questions/'+id,undefined,ah)).data.thread.replies[0];assert.equal(rated.upvotes,1);assert.equal(rated.downvotes,1);
  assert.equal((await f.request('/api/profile',undefined,rh)).data.profile.points,1);
  await f.request(path,{value:0},bh);
  assert.equal((await f.request('/api/profile',undefined,rh)).data.profile.points,0);
  await f.request('/api/profile',{nickname:'Reader',work:['Books'],hobbies:[],points:999},rh);
  assert.equal((await f.request('/api/profile',undefined,rh)).data.profile.points,0);
});

test('available question topics exclude categories no longer used by any profile',async t=>{
  const f=await fixture(t);const headers=await createMember(f,newWallet(),'Member',['Old topic']);
  await f.request('/api/profile',{nickname:'Member',work:['Current topic'],hobbies:['Photography']},headers);
  const available=(await f.request('/api/categories?available=1',undefined,headers)).data.categories;
  assert.deepEqual(available.work.map(c=>c.name),['Current topic']);assert.deepEqual(available.hobbies.map(c=>c.name),['Photography']);
});

test('ratings and profile stars survive reopening the database',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'neuron-votes-')),database=join(folder,'votes.sqlite');
  const first=await fixture(t,{database}),author=newWallet(),recipient=newWallet();
  const ah=await createMember(first,author,'Author',['Books']),rh=await createMember(first,recipient,'Reader',['Books']);
  const categoryId=(await first.request('/api/categories',undefined,ah)).data.categories.work[0].id;
  const id=(await first.request('/api/questions',{categoryId,body:'Question'},ah)).data.id;
  await first.request('/api/questions/'+id+'/replies',{body:'Answer'},rh);
  const reply=(await first.request('/api/questions/'+id,undefined,ah)).data.thread.replies[0];
  await first.request('/api/questions/'+id+'/replies/'+reply.id+'/vote',{value:1},ah);
  const second=await fixture(t,{database});await second.login(recipient);
  assert.equal((await second.request('/api/profile')).data.profile.points,1);
  assert.equal((await second.request('/api/questions/'+id)).data.thread.replies[0].upvotes,1);
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
});

async function adminMember(f){
  const session=randomBytes(32).toString('hex');f.db.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?)').run(ADMIN,Date.now());f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(session).digest('hex'),ADMIN,Date.now()+600000);
  const headers={Cookie:`ns_session=${session}`};await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true},headers);await f.request('/api/profile',{nickname:'Administrator',work:['Administration'],hobbies:[]},headers);return headers;
}
test('admin dashboard protects endpoints, soft-deletes, audits and restores without losing participants',async t=>{
  const f=await fixture(t),ah=await createMember(f,newWallet(),'Author',['Books']),rh=await createMember(f,newWallet(),'Reader',['Books']),admin=await adminMember(f);
  const categoryId=(await f.request('/api/categories',undefined,ah)).data.categories.work.find(c=>c.name==='Books').id;
  const id=(await f.request('/api/questions',{categoryId,body:'Private book discussion'},ah)).data.id,path='/api/admin/conversations/'+id;
  await f.request('/api/questions/'+id+'/replies',{body:'A useful answer'},rh);
  const reply=(await f.request('/api/questions/'+id,undefined,ah)).data.thread.replies[0];await f.request('/api/questions/'+id+'/replies/'+reply.id+'/vote',{value:1},ah);
  assert.equal((await f.request('/api/admin/conversations',undefined,{Cookie:''})).status,401);
  for(const endpoint of ['/api/admin/conversations',path])assert.equal((await f.request(endpoint,undefined,ah)).status,403);
  assert.equal((await f.request(path+'/delete',{confirmation:id},rh)).status,403);
  await f.request('/api/profile',{nickname:'Author',work:['Books'],hobbies:[],role:'admin'},ah);
  assert.equal((await f.request('/api/admin/conversations',undefined,ah)).status,403);
  assert.equal((await f.request(path,undefined,admin)).data.thread.replies[0].body,'A useful answer');
  assert.equal((await f.request(path+'/delete',undefined,admin)).status,405);
  for(const confirmation of [undefined,'other'])assert.equal((await f.request(path+'/delete',{confirmation},admin)).status,400);
  assert.equal((await f.request(path+'/delete',{confirmation:id},{...admin,Origin:'https://evil.example'})).status,403);
  assert.equal((await f.request(path+'/delete',{confirmation:id},admin)).status,200);
  assert.equal((await f.request(path+'/delete',{confirmation:id},admin)).status,409);
  for(const h of [ah,rh,admin]){
    assert.equal((await f.request('/api/questions/'+id,undefined,h)).status,404);
    assert.equal((await f.request('/api/questions/'+id+'/replies',{body:'Blocked'},h)).status,404);
    assert.equal((await f.request('/api/questions/'+id+'/read',{revision:2},h)).status,404);
    assert.equal((await f.request('/api/questions/'+id+'/replies/'+reply.id+'/vote',{value:1},h)).status,404);
    assert.equal((await f.request('/api/questions?view=inbox',undefined,h)).data.questions.length,0);
    assert.equal((await f.request('/api/notifications',undefined,h)).data.notifications.length,0);
  }
  assert.equal((await f.request('/api/profile',undefined,rh)).data.profile.points,0);
  assert.equal((await f.request('/api/stats',undefined,rh)).data.stats.questions,0);
  assert.equal((await f.request('/api/admin/conversations?state=deleted',undefined,admin)).data.questions[0].id,id);
  const deleted=(await f.request(path,undefined,admin)).data;assert.ok(deleted.thread.deletedAt);assert.equal(deleted.audit[0].action,'delete');assert.equal(deleted.audit[0].actor,ADMIN);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM replies').get().n,1);assert.equal(f.db.prepare('SELECT count(*) AS n FROM profiles').get().n,3);
  assert.equal((await f.request(path+'/restore',{confirmation:id},admin)).status,200);
  assert.equal((await f.request('/api/questions/'+id,undefined,rh)).status,200);
  assert.equal((await f.request('/api/profile',undefined,rh)).data.profile.points,1);
  assert.equal((await f.request('/api/notifications',undefined,rh)).data.unread,0);
  assert.deepEqual((await f.request(path,undefined,admin)).data.audit.map(x=>x.action),['restore','delete']);
});

test('admin search pagination and deleted state persist across database reopening',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'neuron-admin-')),database=join(folder,'admin.sqlite'),first=await fixture(t,{database});
  const ah=await createMember(first,newWallet(),'Author',['Books']),rh=await createMember(first,newWallet(),'Reader',['Books']),admin=await adminMember(first);
  const categoryId=(await first.request('/api/categories',undefined,ah)).data.categories.work.find(c=>c.name==='Books').id;
  let id;for(let i=0;i<21;i++)id=(await first.request('/api/questions',{categoryId,body:'Book question '+i},ah)).data.id;
  const a=(await first.request('/api/admin/conversations',undefined,admin)).data,b=(await first.request('/api/admin/conversations?page=2',undefined,admin)).data;
  assert.equal(a.questions.length,20);assert.equal(b.questions.length,1);assert.equal(new Set([...a.questions,...b.questions].map(q=>q.id)).size,21);
  assert.equal((await first.request('/api/admin/conversations?search=question%2020',undefined,admin)).data.total,1);
  assert.equal((await first.request('/api/admin/conversations?search=%25',undefined,admin)).data.total,0);
  assert.equal((await first.request('/api/admin/conversations?page=-1',undefined,admin)).status,400);
  await first.request('/api/admin/conversations/'+id+'/delete',{confirmation:id},admin);
  const second=await fixture(t,{database}),admin2=await adminMember(second);
  const result=(await second.request('/api/admin/conversations/'+id,undefined,admin2)).data;assert.ok(result.thread.deletedAt);assert.equal(result.audit.length,1);
  assert.equal((await second.request('/api/notifications',undefined,rh)).data.total,20);
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
});

test('notifications target participants once, isolate accounts and read only displayed events',async t=>{
  const f=await fixture(t),ah=await createMember(f,newWallet(),'Author',['Writing']),rh=await createMember(f,newWallet(),'Reader',['Books','History']),sh=await createMember(f,newWallet(),'Second',['History']),oh=await createMember(f,newWallet(),'Outsider',['Other']),admin=await adminMember(f);
  const categories=(await f.request('/api/categories',undefined,ah)).data.categories.work;
  const id=(await f.request('/api/questions',{categoryIds:categories.filter(c=>['Books','History'].includes(c.name)).map(c=>c.id),body:'History books?'},ah)).data.id;
  const read=h=>f.request('/api/notifications',undefined,h);
  for(const h of [rh,sh])assert.equal((await read(h)).data.unread,1);
  for(const h of [ah,oh,admin])assert.equal((await read(h)).data.total,0);
  assert.equal((await f.request('/api/notifications',undefined,{Cookie:''})).status,401);
  const first=(await read(rh)).data.notifications[0];assert.equal((await f.request('/api/notifications/read',{id:first.id},oh)).status,404);
  await f.request('/api/questions/'+id+'/replies',{body:'First answer'},rh);
  assert.equal((await read(rh)).data.total,1);assert.equal((await read(ah)).data.unread,1);assert.equal((await read(sh)).data.unread,2);assert.equal((await read(admin)).data.total,0);
  await f.request('/api/questions/'+id+'/read',{revision:1},sh);assert.equal((await read(sh)).data.unread,1);
  const before=(await read(sh)).data.throughId;
  await f.request('/api/questions/'+id+'/replies',{body:'Thanks'},ah);
  await f.request('/api/notifications/read-all',{throughId:before},sh);assert.equal((await read(sh)).data.unread,1);
  await f.request('/api/questions/'+id+'/read',{revision:3},sh);assert.equal((await read(sh)).data.unread,0);
  await f.request('/api/notifications/read',{id:first.id},rh);assert.equal((await read(rh)).data.unread,1);
  assert.equal((await f.request('/api/notifications/read-all',{throughId:99999},{...rh,Origin:'https://evil.example'})).status,403);
});

test('notification read state survives reopening with no migration duplicates',async t=>{
  const folder=mkdtempSync(join(tmpdir(),'neuron-notices-')),database=join(folder,'notifications.sqlite'),first=await fixture(t,{database}),recipient=newWallet();
  const ah=await createMember(first,newWallet(),'Author',['Books']),rh=await createMember(first,recipient,'Reader',['Books']);
  const categoryId=(await first.request('/api/categories',undefined,ah)).data.categories.work[0].id;
  await first.request('/api/questions',{categoryId,body:'Question'},ah);
  const notice=(await first.request('/api/notifications',undefined,rh)).data.notifications[0];await first.request('/api/notifications/read',{id:notice.id},rh);
  const second=await fixture(t,{database});await second.login(recipient);const result=(await second.request('/api/notifications')).data;assert.equal(result.total,1);assert.equal(result.unread,0);assert.equal(result.notifications[0].id,notice.id);
  t.after(()=>rmSync(folder,{recursive:true,force:true}));
});

test('public statistics match signed-in totals without exposing private resources',async t=>{
  const f=await fixture(t),ah=await createMember(f,newWallet(),'Private author',['Books']),rh=await createMember(f,newWallet(),'Private reader',['Books']),admin=await adminMember(f),anonymous={Cookie:''};
  const categoryId=(await f.request('/api/categories',undefined,ah)).data.categories.work.find(c=>c.name==='Books').id;
  const id=(await f.request('/api/questions',{categoryId,body:'Private question content'},ah)).data.id;
  await f.request('/api/questions/'+id+'/replies',{body:'Private reply content'},rh);
  const publicStats=await f.request('/api/stats',undefined,anonymous);
  assert.equal(publicStats.status,200);assert.deepEqual(publicStats.data,(await f.request('/api/stats',undefined,ah)).data);
  assert.deepEqual(publicStats.data,{stats:{members:3,topics:2,questions:1,replies:1}});
  for(const path of ['/api/profile','/api/categories','/api/questions','/api/questions/'+id,'/api/notifications','/api/admin/conversations'])assert.equal((await f.request(path,undefined,anonymous)).status,401);
  await f.request('/api/admin/conversations/'+id+'/delete',{confirmation:id},admin);
  assert.deepEqual((await f.request('/api/stats',undefined,anonymous)).data,{stats:{members:3,topics:2,questions:0,replies:0}});
  await f.request('/api/admin/conversations/'+id+'/restore',{confirmation:id},admin);
  assert.deepEqual((await f.request('/api/stats',undefined,anonymous)).data,publicStats.data);
});

test('registration requires an authenticated explicit NS confirmation and persists it',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true})).status,401);
 const c=await f.challenge();await f.request('/api/verify',{id:c.id,signature:await wallet.signMessage(c.message)});
 assert.equal((await f.request('/api/profile')).data.tokenSetupRequired,true);
 assert.equal((await f.request('/api/profile',profileInput)).status,409);
 assert.equal((await f.request('/api/token/confirm',{contract:other.address,confirmed:true})).status,400);
 assert.equal((await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:false})).status,400);
 assert.equal((await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true},{Origin:'https://evil.example'})).status,403);
 await f.request('/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true});
 assert.equal((await f.request('/api/profile',profileInput)).status,200);
 assert.equal((await f.request('/api/profile')).data.tokenSetupRequired,false);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM token_confirmations').get().n,1);
});
test('NS balance uses session address and on-chain calls only; public supply exposes no balances',async t=>{
 const calls=[];const f=await fixture(t,{tokenFetch:async(url,options)=>{calls.push(JSON.parse(options.body));return mockTokenFetch(url,options);}});
 assert.equal((await f.request('/api/token/balance')).status,401);assert.equal(calls.length,0);
 const stats=(await f.request('/api/token')).data;assert.equal(stats.totalSupply,'10000000');assert.equal(stats.balance,undefined);
 await f.login();const result=(await f.request('/api/token/balance?address='+other.address)).data;
 assert.equal(result.address,wallet.address);assert.equal(result.balance,'1234.56789');
 assert.ok(calls.some(c=>c.method==='quai_call'&&c.params[0].data==='0x70a08231'+wallet.address.slice(2).toLowerCase().padStart(64,'0')));
 assert.ok(calls.every(c=>['quai_chainId','quai_blockNumber','quai_call'].includes(c.method)));
});
test('NS reader rejects wrong networks, invalid contract results and network failures',async()=>{
 for(const fetcher of [async()=>({ok:false}),async()=>({ok:true,json:async()=>({result:'0x3a98'})}),async(url,opts)=>JSON.parse(opts.body).method==='quai_call'?{ok:true,json:async()=>({result:'0x'})}:mockTokenFetch(url,opts)]){
  await assert.rejects(createNeuronReader(fetcher)(wallet.address),e=>e.status===502);
 }
});
test('adding NS checks account and mainnet, sends only watchAsset, handles refusal and switches',async()=>{
 const calls=[];const provider={request:async request=>{calls.push(request);return request.method==='quai_accounts'?[wallet.address]:request.method==='quai_chainId'?'0x9':true;}};
 assert.equal(await addNeuronToken(provider,wallet.address,NS_TOKEN),true);
 assert.deepEqual(calls.map(c=>c.method),['quai_accounts','quai_chainId','wallet_watchAsset','quai_accounts']);
 assert.deepEqual(calls[2].params,{type:'ERC20',options:{address:NS_TOKEN.address,symbol:'NS',decimals:18,chainId:9}});
 await assert.rejects(addNeuronToken({request:async()=>[other.address]},wallet.address,NS_TOKEN),/signed-in account/);
 await assert.rejects(addNeuronToken({request:async r=>r.method==='quai_accounts'?[wallet.address]:'0x3a98'},wallet.address,NS_TOKEN),/Mainnet/);
 await assert.rejects(addNeuronToken({request:async r=>r.method==='quai_accounts'?[wallet.address]:r.method==='quai_chainId'?'0x9':false},wallet.address,NS_TOKEN),/not accepted/);
 let reads=0;await assert.rejects(addNeuronToken({request:async r=>r.method==='quai_accounts'?[++reads===1?wallet.address:other.address]:r.method==='quai_chainId'?'0x9':true},wallet.address,NS_TOKEN),/account changed/);
});


test('signed sends bind content, account, session and route; repeated confirmation writes once',async t=>{
  let time=Date.now();const f=await fixture(t,{now:()=>time}),a=newWallet(),r=newWallet();
  const ah=await createMember(f,a,'Author',['Writing']),rh=await createMember(f,r,'Driver',['Driver']);
  await f.request('/api/profile',{nickname:'Driver',work:['Driver'],hobbies:['Travel']},rh);
  const topics=(await f.request('/api/categories',undefined,ah)).data.categories,ids=[topics.work.find(x=>x.name==='Driver').id,topics.hobbies[0].id];
  const prepare=async(path,payload,headers=ah)=> (await f.request('/api/actions/challenge',{path,payload},headers)).data;
  assert.equal((await f.request('/api/questions',{},ah)).status,400);
  const c=await prepare('/api/questions',{body:'One question',categoryIds:ids});
  assert.match(c.message,/Driver/);assert.match(c.message,/Travel/);assert.match(c.message,/One question/);
  const signed={actionId:c.id,signature:await a.signMessage(c.message)};
  assert.equal((await f.request('/api/questions',{...signed,signature:await r.signMessage(c.message)},ah)).status,403);
  assert.equal((await f.request('/api/questions',signed,rh)).status,403);
  const results=await Promise.all([f.request('/api/questions',signed,ah),f.request('/api/questions',signed,ah)]);
  assert.equal(results[0].status,201);assert.deepEqual(results[0].data,results[1].data);const id=results[0].data.id;
  assert.equal(results[0].data.recipientCount,1);
  const again=await f.request('/api/questions',{body:'One question',categoryIds:[...ids].reverse()},ah);assert.equal(again.data.id,id);
  assert.equal((await f.request('/api/questions?view=inbox',undefined,rh)).data.questions.length,1);
  assert.equal((await f.request('/api/notifications',undefined,rh)).data.notifications.length,1);
  const path='/api/questions/'+id+'/replies';assert.equal((await f.request(path,signed,ah)).status,403);
  const reply=await prepare(path,{body:'One reply'},rh),rs={actionId:reply.id,signature:await r.signMessage(reply.message)};
  await f.request(path,rs,rh);await f.request(path,rs,rh);await f.request(path,{body:'One reply'},rh);
  assert.equal((await f.request('/api/questions/'+id,undefined,ah)).data.thread.replies.length,1);
  assert.equal((await f.request('/api/notifications',undefined,ah)).data.notifications.length,1);
  const expires=await prepare(path,{body:'Expired'},rh);time+=300001;
  assert.equal((await f.request(path,{actionId:expires.id,signature:await r.signMessage(expires.message)},rh)).status,409);
  await f.login(a);const newSession={Cookie:'ns_session='+f.jar.ns_session};
  assert.equal((await f.request('/api/questions',signed,newSession)).status,403);
});

test('Debate is private, unsigned, idempotent and separate from formal replies; presence expires',async t=>{
  let time=Date.now();const f=await fixture(t,{now:()=>time});
  const ah=await createMember(f,newWallet(),'Author',['Writing']),rh=await createMember(f,newWallet(),'Reader',['Books']),oh=await createMember(f,newWallet(),'Outsider',['Other']);
  const categoryId=(await f.request('/api/categories',undefined,ah)).data.categories.work.find(x=>x.name==='Books').id;
  const id=(await f.request('/api/questions',{categoryId,body:'Discuss books'},ah)).data.id,path='/api/questions/'+id+'/debate';
  assert.equal((await f.request(path,undefined,oh)).status,404);
  assert.equal((await f.request(path,undefined,{Cookie:''})).status,401);
  const message={body:'A live idea',clientId:'11111111-1111-4111-8111-111111111111'};
  assert.equal((await f.request(path,message,oh)).status,404);
  assert.equal((await f.request(path,message,{...rh,Origin:'https://evil.example'})).status,403);
  assert.equal((await f.request(path,message,rh)).status,200);await f.request(path,message,rh);
  assert.equal((await f.request(path,{...message,body:'Changed'},rh)).status,409);
  const seen=(await f.request(path+'?presence=1',undefined,ah)).data;
  assert.equal(seen.messages.length,1);assert.equal(seen.messages[0].mine,0);assert.equal((await f.request(path,undefined,rh)).data.messages[0].mine,1);assert.deepEqual(seen.online,['Author','Reader']);
  assert.equal((await f.request('/api/questions/'+id,undefined,ah)).data.thread.replies.length,0);
  assert.equal((await f.request('/api/notifications',undefined,ah)).data.notifications.length,0);
  time+=26000;assert.deepEqual((await f.request(path,undefined,ah)).data.online,[]);
  // Seed older history only in the disposable database to verify both paging directions.
  const address=f.db.prepare('SELECT author FROM questions WHERE id=?').get(id).author;
  for(let n=0;n<60;n++)f.db.prepare('INSERT INTO debate_messages(question_id,author,body,client_id,created_at) VALUES(?,?,?,?,?)').run(id,address,'Older '+n,'seed-'+n,time);
  const last=(await f.request(path,undefined,ah)).data;assert.equal(last.messages.length,50);assert.equal(last.hasEarlier,true);
  const earlier=(await f.request(path+'?before='+last.messages[0].id,undefined,ah)).data;
  assert.equal(earlier.messages.length,11);assert.equal(earlier.hasEarlier,false);
  const newer=(await f.request(path+'?after='+earlier.messages.at(-1).id,undefined,ah)).data;assert.deepEqual(newer.messages,last.messages);
  f.db.prepare('UPDATE questions SET deleted_at=? WHERE id=?').run(time,id);
  assert.equal((await f.request(path,undefined,ah)).status,404);assert.equal((await f.request(path,message,rh)).status,404);
});


test('frontend signed sender reuses confirmation after a network error without signing twice',async t=>{
  const old=globalThis.window;t.after(()=>{if(old===undefined)delete globalThis.window;else globalThis.window=old;});
  let signs=0,commits=0;const requests=[];const account={address:wallet.address};
  globalThis.window={pelagus:{request:async({method})=>{if(method==='quai_accounts')return [wallet.address];if(method==='personal_sign'){signs++;return 'test-signature';}throw Error('Unexpected wallet method');}}};
  const api=async(path,data)=>{if(path==='/api/actions/challenge')return {id:'nonce',message:'Exact message'};requests.push(data);if(++commits===1)throw Error('Connection lost');return {id:'one-question'};};
  const send=createSignedSender(api,()=>account);
  await assert.rejects(send('/api/questions',{body:'Question',categoryIds:[1]}),/Connection lost/);
  assert.deepEqual(await send('/api/questions',{body:'Question',categoryIds:[1]}),{id:'one-question'});
  assert.equal(signs,1);assert.deepEqual(requests[0],requests[1]);
});

test('frontend signed sender never posts when Pelagus declines or the account changes',async t=>{
  const old=globalThis.window;t.after(()=>{if(old===undefined)delete globalThis.window;else globalThis.window=old;});
  let commits=0,current=wallet.address,decline=true;
  globalThis.window={pelagus:{request:async({method})=>{if(method==='quai_accounts')return [current];if(decline)throw Error('Request declined');current=other.address;return 'test-signature';}}};
  const api=async(path)=>{if(path==='/api/actions/challenge')return {id:'nonce',message:'Exact message'};commits++;};
  const send=createSignedSender(api,()=>({address:wallet.address}));
  await assert.rejects(send('/api/questions',{body:'Question',categoryIds:[1]}),/declined/);
  decline=false;await assert.rejects(send('/api/questions',{body:'Question',categoryIds:[1]}),/signed-in account/);assert.equal(commits,0);
});
