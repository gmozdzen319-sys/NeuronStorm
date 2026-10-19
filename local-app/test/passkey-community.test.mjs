import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import http from 'node:http';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {createApp} from './database.mjs';
import {loadLegal} from '../legal.mjs';
import {communityAddress} from '../passkey-community.mjs';
const origin='https://neuronstorm.onrender.com',rp='neuronstorm.onrender.com';
const b64=x=>Buffer.from(x).toString('base64url'),sha=x=>createHash('sha256').update(x).digest();
function device(){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
 const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));let handle;
 const auth=flags=>Buffer.concat([sha(rp),Buffer.from([flags]),Buffer.alloc(4)]);
 const client=(type,challenge,extra)=>Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false,...extra}));
 return {
  registration(options){handle=options.user.id;const n=Buffer.alloc(2);n.writeUInt16BE(id.length);const data=Buffer.concat([auth(69),Buffer.alloc(16),n,id,Buffer.from(cose)]);
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client('webauthn.create',options.challenge)),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(data)]])))}};
  },
  assertion(options,extra={},flags=5){const data=auth(flags),json=client('webauthn.get',options.challenge,extra);return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{authenticatorData:b64(data),clientDataJSON:b64(json),signature:b64(sign('sha256',Buffer.concat([data,sha(json)]),privateKey)),userHandle:handle}};}
 };
}
test('Passkey registration joins profiles and Q&A before wallet deployment, without external-wallet signing',async t=>{
 const names=['NS_PASSKEY_ENABLED','NS_PASSKEY_ORIGIN','NS_PASSKEY_RP_ID'],before=names.map(n=>process.env[n]);
 Object.assign(process.env,{NS_PASSKEY_ENABLED:'true',NS_PASSKEY_ORIGIN:origin,NS_PASSKEY_RP_ID:rp});
 let app;try{app=await createApp({database:':memory:',origin,legal:loadLegal({published:false,version:'QA'})});}finally{names.forEach((n,i)=>before[i]===undefined?delete process.env[n]:process.env[n]=before[i]);}
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 function browser(){const jar={};return async(path,data)=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port:app.server.address().port,path,method:data===undefined?'GET':'POST',headers:{Host:rp,Origin:origin,'Content-Type':'application/json',Cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join('; ')}},res=>{
   let text='';res.on('data',c=>text+=c);res.on('end',()=>{for(const raw of res.headers['set-cookie']||[]){const [k,v]=raw.split(';')[0].split('=');jar[k]=v;}resolve({status:res.statusCode,data:JSON.parse(text)});});
  });req.on('error',reject);req.end(data===undefined?undefined:JSON.stringify(data));
 });}
 const a=browser(),b=browser(),da=device(),db=device();
 async function register(request,key){const r=await request('/api/passkey/register/options',{});assert.equal(r.status,200);const s=await request('/api/passkey/register/verify',{id:r.data.id,response:key.registration(r.data.options)});assert.equal(s.status,200);return s.data.account;}
 const aa=await register(a,da),bb=await register(b,db);
 await t.test('independent persistent identity and reserved wallet, no paid execution',async()=>{
  assert(aa.address&&bb.address);assert.notEqual(aa.address,bb.address);
  assert.equal((await app.db.prepare('SELECT count(*) AS n FROM passkey_current_wallet_accounts').get()).n,2);
  assert.equal((await a('/api/profile')).data.profile,null);
  assert.equal(await communityAddress(app.db,aa.id),aa.address);
  assert.equal((await app.db.prepare('SELECT count(*) AS n FROM passkey_clone_approvals').get()).n,0);
 });
 let category;
 await t.test('both accounts complete the same registration fields while activation is pending',async()=>{
  for(const [request,nickname] of [[a,'PasskeyAlice'],[b,'PasskeyBob']]){
   const result=await request('/api/profile',{nickname,firstName:nickname,lastName:'Tester',work:['Engineering'],hobbies:[]});assert.equal(result.status,200);category=result.data.profile.work[0].id;
  }
  assert.equal((await a('/api/profile')).data.profile.nickname,'PasskeyAlice');
  assert.equal((await b('/api/profile')).data.profile.nickname,'PasskeyBob');
 });
 let question;
 await t.test('fresh passkey authorizes exact question; replay is idempotent',async()=>{
  const c=await a('/api/actions/challenge',{path:'/api/questions',payload:{body:'How does this work?',categoryId:category}});assert.equal(c.status,200);assert.equal(c.data.method,'passkey');
  const input={actionId:c.data.id,response:da.assertion(c.data.options)};
  assert.equal((await b('/api/questions',input)).status,403);
  const posted=await a('/api/questions',input);assert.equal(posted.status,201);question=posted.data.id;
  assert.equal((await a('/api/questions',input)).data.id,question);
  assert.equal((await app.db.prepare('SELECT count(*) AS n FROM questions').get()).n,1);
 });
 for(const [label,alter,flags] of [['origin',{origin:'https://evil.example'},5],['challenge',{challenge:b64(randomBytes(32))},5],['cross origin',{crossOrigin:true},5],['UV',{},1]])await t.test('community confirmation rejects '+label,async()=>{
  const c=await a('/api/actions/challenge',{path:'/api/questions',payload:{body:'Rejected question '+label,categoryId:category}});
  assert.equal((await a('/api/questions',{actionId:c.data.id,response:da.assertion(c.data.options,alter,flags)})).status,403);
 });
 await t.test('reply and debate work for another Passkey profile',async()=>{
  const path='/api/questions/'+question+'/replies',c=await b('/api/actions/challenge',{path,payload:{body:'Here is my answer.'}});
  assert.equal((await b(path,{actionId:c.data.id,response:db.assertion(c.data.options)})).status,201);
  assert.equal((await b('/api/questions/'+question+'/debate',{body:'More detail.',clientId:crypto.randomUUID()})).status,200);
  const discussion=await a('/api/questions/'+question+'/debate?presence=1');assert.equal(discussion.status,200);assert(discussion.data.online.includes('PasskeyBob'));
 });
 await t.test('logout/login retains profile, community identity and wallet assignment',async()=>{
  await a('/api/logout',{});assert.equal((await a('/api/profile')).status,401);
  const c=await a('/api/passkey/login/options',{}),s=await a('/api/passkey/login/verify',{id:c.data.id,response:da.assertion(c.data.options)});
  assert.equal(s.status,200);assert.equal(s.data.account.address,aa.address);assert.equal(s.data.account.id,aa.id);
  assert.equal((await a('/api/profile')).data.profile.nickname,'PasskeyAlice');
  assert.equal((await app.db.prepare('SELECT count(*) AS n FROM passkey_community_accounts').get()).n,2);
 });
});
