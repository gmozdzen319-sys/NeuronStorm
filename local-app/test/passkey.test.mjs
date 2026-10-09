import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import {convertCOSEtoPKCS,isoCBOR} from '@simplewebauthn/server/helpers';
import {createApp} from './database.mjs';
import {loadLegal} from '../legal.mjs';
import {createPasskeyAccounts,passkeyConfiguration,strictClientData} from '../passkey-accounts.mjs';
import {createPasskeyWallet,createTokenMetadataReader,tokenAddress} from '../passkey-wallet.mjs';
import {Interface} from 'quais';
const config={enabled:true,origin:'http://localhost:3000',rpID:'localhost'},legal=loadLegal({published:false,version:'QA'});
const b64=v=>Buffer.from(v).toString('base64url'),sha=v=>createHash('sha256').update(v).digest();
function authenticator(){
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=randomBytes(32);
 const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
 let handle;
 function client(type,challenge,extra={}){return Buffer.from(JSON.stringify({type,challenge,origin:config.origin,crossOrigin:false,...extra}));}
 function ad(flags,counter){const n=Buffer.alloc(4);n.writeUInt32BE(counter);return Buffer.concat([sha('localhost'),Buffer.from([flags]),n]);}
 return {
  register(options){handle=options.user.id;const size=Buffer.alloc(2);size.writeUInt16BE(id.length);
   const data=Buffer.concat([ad(0x45,0),Buffer.alloc(16),size,id,Buffer.from(cose)]);
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client('webauthn.create',options.challenge)),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(data)]])))}};
  },
  assertion(options,{extra={},counter=0,flags=5}={}){const data=ad(flags,counter),json=client('webauthn.get',options.challenge,extra);
   return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response:{authenticatorData:b64(data),clientDataJSON:b64(json),signature:b64(sign('sha256',Buffer.concat([data,sha(json)]),privateKey)),userHandle:handle}};
  }
 };
}
test('Passkey account integration with actual P-256 signatures and PostgreSQL schema',async t=>{
 const app=await createApp({database:':memory:',legal});t.after(()=>app.close());let clock=Date.now();
 const service=createPasskeyAccounts(app.db,{config,legal,now:()=>clock});
 const wallet=createPasskeyWallet(app.db,{readMetadata:async c=>({contract:tokenAddress(c),name:'Example',symbol:'EX',decimals:18})});
 const device=authenticator(),browser='first-browser';let registered;
 await t.test('registration creates one independent identity and one pending wallet record',async()=>{
  const r=await service.options('register',browser);registered=await service.verify('register',browser,{id:r.id,response:device.register(r.options)});
  assert.equal(registered.account.address,null);assert.equal(registered.account.method,'passkey');
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM accounts').get()).n,0);
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM passkey_wallets').get()).n,1);
  assert.equal((await service.session(registered.raw)).id,registered.account.id);
 });
 await t.test('returning passkey returns same identity and pending wallet, including counter zero',async()=>{
  const r=await service.options('login',browser);const result=await service.verify('login',browser,{id:r.id,response:device.assertion(r.options,{extra:{newAllowedProperty:'browser-data'}})});
  assert.equal(result.account.id,registered.account.id);assert.equal((await wallet.state(result.account)).accountId,registered.account.id);
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM passkey_wallets').get()).n,1);
 });
 await t.test('different users cannot share a provisioning record',async()=>{
  const r=await service.options('register','other'),other=await service.verify('register','other',{id:r.id,response:authenticator().register(r.options)});
  assert.notEqual(other.account.id,registered.account.id);assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM passkey_wallets').get()).n,2);
 });
 await t.test('challenge is browser-bound and consumed atomically',async()=>{
  const r=await service.options('login',browser),response=device.assertion(r.options);
  await assert.rejects(service.verify('login','wrong-browser',{id:r.id,response}));
  const results=await Promise.allSettled([service.verify('login',browser,{id:r.id,response}),service.verify('login',browser,{id:r.id,response})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 });
 for(const [name,extra] of Object.entries({origin:{origin:'https://evil.example'},challenge:{challenge:b64(randomBytes(32))},type:{type:'webauthn.create'},crossOrigin:{crossOrigin:true},topOrigin:{topOrigin:config.origin}})){
  await t.test('rejects '+name,async()=>{const r=await service.options('login',browser);await assert.rejects(service.verify('login',browser,{id:r.id,response:device.assertion(r.options,{extra})}));});
 }
 for(const flags of [0,1,4])await t.test('requires UP and UV, flags '+flags,async()=>{const r=await service.options('login',browser);await assert.rejects(service.verify('login',browser,{id:r.id,response:device.assertion(r.options,{flags})}));});
 await t.test('wrong userHandle cannot switch accounts',async()=>{const r=await service.options('login',browser),response=device.assertion(r.options);response.response.userHandle=b64(randomBytes(32));await assert.rejects(service.verify('login',browser,{id:r.id,response}));});
 await t.test('wrong signature rejected; no reusable failed challenge',async()=>{const r=await service.options('login',browser),response=device.assertion(r.options);response.response.signature=b64(randomBytes(72));await assert.rejects(service.verify('login',browser,{id:r.id,response}));await assert.rejects(service.verify('login',browser,{id:r.id,response:device.assertion(r.options)}));});
 await t.test('expiry and logout invalidate access',async()=>{const r=await service.options('login',browser);clock+=120001;await assert.rejects(service.verify('login',browser,{id:r.id,response:device.assertion(r.options)}));await service.logout(registered.raw);assert.equal(await service.session(registered.raw),null);});
 await t.test('revoked credential cannot login or retain a session',async()=>{const r=await service.options('login',browser),s=await service.verify('login',browser,{id:r.id,response:device.assertion(r.options)});await app.db.prepare('UPDATE passkey_credentials SET revoked_at=$1 WHERE account_id=$2').run(clock,s.account.id);assert.equal(await service.session(s.raw),null);const n=await service.options('login',browser);await assert.rejects(service.verify('login',browser,{id:n.id,response:device.assertion(n.options)}));});
 await t.test('wallet has no fake address, QR, zero balance or authorized send',async()=>{const s=await wallet.state(registered.account);assert.equal(s.address,null);assert.equal(s.quaiBalance,null);assert.equal(s.receiveAvailable,false);assert.equal(s.sendAvailable,false);assert.throws(()=>wallet.blocked(registered.account),e=>e.status===423);assert.throws(()=>wallet.blocked(null),e=>e.status===401);});
 await t.test('token metadata reviewed, duplicates rejected, identities isolated',async()=>{const metadata={contract:'0x0000000000000000000000000000000000000001',name:'Example',symbol:'EX',decimals:18};await assert.rejects(wallet.add(registered.account,{...metadata,symbol:'Trusted NS'}),e=>e.status===409);await wallet.add(registered.account,metadata);await assert.rejects(wallet.add(registered.account,metadata),e=>e.status===409);assert.equal((await wallet.state(registered.account)).tokens.length,1);assert.equal((await wallet.state({id:'unrelated',method:'passkey'})).tokens.length,0);});
 await t.test('database cannot be used to activate an unreviewed wallet',async()=>{await assert.rejects(app.db.prepare("UPDATE passkey_wallets SET status='active' WHERE account_id=$1").run(registered.account.id));});
});
test('strict original client JSON accepts legal variants, rejects duplicate/ambiguous fields',()=>{
 for(const s of ['{"origin":"a","origin":"b"}','{"origin":"a","or\\u0069gin":"b"}','{"extra":{"x":1,"x":2}}','{"crossOrigin":true}','{"crossOrigin":"false"}','{"topOrigin":"x"}','[]','{} garbage'])assert.throws(()=>strictClientData(b64(s)));
 for(const s of ['{ "extra": [1,true,null], "crossOrigin": false, "challenge":"x" }','{"extra":{"x":1},"origin":"a"}'])assert.ok(strictClientData(b64(s)));
});
test('configuration defaults off and rejects unpinned or insecure production RP',()=>{
 assert.equal(passkeyConfiguration(config.origin,{}).enabled,false);
 for(const env of [{NS_PASSKEY_ENABLED:'true'},{NS_PASSKEY_ENABLED:'true',NS_PASSKEY_ORIGIN:config.origin,NS_PASSKEY_RP_ID:'evil.example'}])assert.throws(()=>passkeyConfiguration(config.origin,env));
 assert.equal(passkeyConfiguration(config.origin,{NS_PASSKEY_ENABLED:'true',NS_PASSKEY_ORIGIN:config.origin,NS_PASSKEY_RP_ID:'localhost'}).enabled,true);
});
test('token metadata reader is read-only, chain-bound and rejects unsupported contracts',async()=>{
 const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)']);let invalid=false;const seen=[];
 const read=createTokenMetadataReader(async(url,init)=>{const q=JSON.parse(init.body);seen.push(q.method);let result=q.method==='quai_chainId'?'0x9':q.method==='quai_getCode'?(invalid?'0x':'0x6000'):null;
  if(q.method==='quai_call'){const fn=abi.parseTransaction({data:q.params[0].data}).name;result=abi.encodeFunctionResult(fn,[fn==='decimals'?18:fn==='name'?'Example':'EX']);}
  return {ok:true,text:async()=>JSON.stringify({jsonrpc:'2.0',id:q.id,result})};});
 assert.equal((await read('0x0000000000000000000000000000000000000001')).symbol,'EX');
 assert.ok(seen.every(m=>['quai_chainId','quai_getCode','quai_call'].includes(m)));invalid=true;await assert.rejects(read('0x0000000000000000000000000000000000000001'));
 await assert.rejects(read('https://evil.example'));assert.throws(()=>tokenAddress('0x0000000000000000000000000000000000000000'));
});

// Reopen the actual PostgreSQL-backed app: no in-memory wallet assignment survives.
// This validates a candidate address only; no wallet is activated or funded.
test('Passkey identity and deterministic clone plan survive application restart',async()=>{
 const {planWalletClone}=await import('../wallet-clone-plan.mjs');
 const database='clone-restart-'+randomBytes(8).toString('hex'),device=authenticator();
 let app=await createApp({database,legal});
 try {
  let service=createPasskeyAccounts(app.db,{config,legal});
  const request=await service.options('register','restart');
  const first=await service.verify('register','restart',{id:request.id,response:device.register(request.options)});
  const loadPlan=async()=>{
   const row=await app.db.prepare('SELECT public_key FROM passkey_credentials WHERE account_id=$1').get(first.account.id);
   const key=convertCOSEtoPKCS(Buffer.from(row.public_key,'base64url'));
   return planWalletClone({chainId:9,factory:'0x0011111111111111111111111111111111111111',implementation:'0x0022222222222222222222222222222222222222',x:'0x'+Buffer.from(key.subarray(1,33)).toString('hex'),y:'0x'+Buffer.from(key.subarray(33)).toString('hex')});
  };
  const before=await loadPlan();await app.close();app=await createApp({database,legal});
  service=createPasskeyAccounts(app.db,{config,legal});
  const login=await service.options('login','restart');
  const returning=await service.verify('login','restart',{id:login.id,response:device.assertion(login.options)});
  assert.equal(returning.account.id,first.account.id);
  assert.deepEqual(await loadPlan(),before);
  assert.equal(before.receiveAvailable,false);
  assert.equal((await app.db.prepare('SELECT COUNT(*) AS n FROM passkey_wallets').get()).n,1);
 } finally {await app.close();}
});
