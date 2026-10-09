import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {createApp} from './database.mjs';
import {loadLegal} from '../legal.mjs';
import {assignCloneWallet,loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {createPasskeyAccounts} from '../passkey-accounts.mjs';
import {createPasskeyWallet} from '../passkey-wallet.mjs';
import {createNativeSend} from '../wallet/native-send.mjs';
import {operationDigest,nativeAmount,nativeRecipient,verifyTransferAssertion} from '../wallet/operation.mjs';
import {configuredExecutor} from '../wallet/configured-executor.mjs';
import {createWalletRPC} from '../wallet/chain.mjs';
const b64=x=>Buffer.from(x).toString('base64url'),sha=x=>createHash('sha256').update(x).digest();
const recipient='0x0000000000000000000000000000000000000001';
function device(){
 const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),id=b64(randomBytes(32));let handle;
 const cose=Buffer.from(isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]])));
 const ad=flags=>Buffer.concat([sha(infra.rpID),Buffer.from([flags]),Buffer.alloc(4)]);
 const client=(type,challenge,extra)=>Buffer.from(JSON.stringify({type,challenge,origin:infra.origin,crossOrigin:false,...extra}));
 return {id,register(options){handle=options.user.id;const size=Buffer.alloc(2);size.writeUInt16BE(Buffer.from(id,'base64url').length);const data=Buffer.concat([ad(0x45),Buffer.alloc(16),size,Buffer.from(id,'base64url'),cose]);return {id,rawId:id,type:'public-key',clientExtensionResults:{},response:{clientDataJSON:b64(client('webauthn.create',options.challenge)),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(data)]])))}};},
 assertion(challenge,{flags=5,extra={}}={}){const auth=ad(flags),json=client('webauthn.get',challenge,extra);return {id,rawId:id,type:'public-key',clientExtensionResults:{},response:{userHandle:handle,authenticatorData:b64(auth),clientDataJSON:b64(json),signature:b64(sign('sha256',Buffer.concat([auth,sha(json)]),privateKey))}};}};
}
const view=()=>({deployed:true,nonce:'0',epoch:'0',balanceWei:'1000000000000000000',quaiBalance:'1.0',observedAt:Date.now()});
test('Persistent production-domain identities, isolated clone assignment and real Receive',async t=>{
 const legal=loadLegal({published:false,version:'test'}),database='wallet-persistence-'+randomBytes(8).toString('hex');let app=await createApp({database,legal});t.after(()=>app.close());
 const accounts=createPasskeyAccounts(app.db,{config:{enabled:true,...infra},legal});
 const d=device(),options=await accounts.options('register','a'),registered=await accounts.verify('register','a',{id:options.id,response:d.register(options.options)});
 const a=registered.account,first=await loadCloneWallet(app.db,a.id);assert(first);assert.equal(first.plan.factory,infra.factory);assert.equal(first.plan.implementation,infra.implementation);
 await t.test('assignment survives concurrent requests, logout and login',async()=>{
  const records=await Promise.all([assignCloneWallet(app.db,a.id),assignCloneWallet(app.db,a.id)]);assert(records.every(r=>r.address===first.address));await accounts.logout(registered.raw);
  const login=await accounts.options('login','a'),returned=await accounts.verify('login','a',{id:login.id,response:d.assertion(login.options.challenge)});assert.equal(returned.account.id,a.id);assert.equal((await loadCloneWallet(app.db,a.id)).address,first.address);
 });
 await t.test('new users have distinct wallets and cannot alter immutable assignment',async()=>{
  const second=device(),o=await accounts.options('register','b'),r=await accounts.verify('register','b',{id:o.id,response:second.register(o.options)});assert.notEqual((await loadCloneWallet(app.db,r.account.id)).address,first.address);
  await assert.rejects(app.db.prepare('UPDATE passkey_clone_wallets SET address=$1 WHERE account_id=$2').run(recipient,a.id));await assert.rejects(app.db.prepare('DELETE FROM passkey_clone_wallets WHERE account_id=$1').run(a.id));
 });
 await t.test('Receive belongs only to authenticated owner; undeployed or inconsistent chain never gets an address',async()=>{
  const w=createPasskeyWallet(app.db,{chain:{snapshot:async()=>view()}}),s=await w.state(a);assert.equal(s.address,first.plan.address);assert.equal(s.quaiBalance,'1.0');assert.equal(s.sendAvailable,false);
  const r=await w.receive(a);assert.equal(r.address,first.plan.address);assert.match(r.qr,/^data:image\/png;base64,/);await assert.rejects(w.receive(null));
  for(const snapshot of [async()=>({deployed:false}),async()=>{throw Error('reorg');}]){const blocked=createPasskeyWallet(app.db,{chain:{snapshot}});const state=await blocked.state(a);assert.equal(state.address,null);assert.equal(state.quaiBalance,null);assert.equal(state.receiveAvailable,false);await assert.rejects(blocked.receive(a));}
 });
 await app.close();app=await createApp({database,legal});assert.equal((await loadCloneWallet(app.db,a.id)).address,first.address);
});
test('Send requires a new authentic assertion, durable one-shot consumption and exact binding',async t=>{
 const legal=loadLegal({published:false,version:'test'}),app=await createApp({database:':memory:',legal});t.after(()=>app.close());let time=Date.now(),executions=0;
 const accounts=createPasskeyAccounts(app.db,{config:{enabled:true,...infra},legal,now:()=>time}),d=device(),options=await accounts.options('register','a'),r=await accounts.verify('register','a',{id:options.id,response:d.register(options.options)}),account=r.account;
 const row=await loadCloneWallet(app.db,account.id);
 const executor={available:async()=>true,prepare:async(row,operation)=>({operation,maximumFeeWei:'75000000000000000000'}),execute:async({id})=>{executions++;await app.db.prepare("UPDATE passkey_native_operations SET phase='confirmed' WHERE id=$1").run(id);}};
 const service=createNativeSend(app.db,{chain:{snapshot:async()=>view()},executor,now:()=>time});
 const prepare=()=>service.prepare(account,{recipient,amount:'0.007'});
  await t.test('exact assertion accepted once, login alone never sends',async()=>{const p=await prepare();assert.equal(executions,0);const response=d.assertion(p.options.challenge);assert.equal((await service.confirm(account,{id:p.id,response})).status,'confirmed');await assert.rejects(service.confirm(account,{id:p.id,response}));assert.equal(executions,1);});
 await t.test('identical operation in the same second cannot reuse a counter-zero assertion',async()=>{const a=await prepare(),old=d.assertion(a.options.challenge);await app.db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE id=$1").run(a.id);const b=await prepare();assert.notEqual(a.options.challenge,b.options.challenge);await assert.rejects(service.confirm(account,{id:b.id,response:old}));assert.equal(executions,1);});
 for(const field of ['recipient','amount','action','walletNonce','wallet','epoch','chainId'])await t.test(field+' substitution invalidates signature',async()=>{
  const p=await prepare(),job=await app.db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1').get(p.id),op=JSON.parse(job.plan).operation,response=d.assertion(p.options.challenge);
  const altered={...op,[field]:field==='recipient'?'0x0000000000000000000000000000000000000002':field==='wallet'?recipient:field==='action'?2:field==='chainId'?1:'1'};
  if(!['action','chainId'].includes(field))altered.digest=operationDigest(altered);
  await assert.rejects(verifyTransferAssertion(altered,response,row));await app.db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE id=$1").run(p.id);
 });
 for(const extra of [{origin:'https://evil.example'},{challenge:'wrong'},{crossOrigin:true},{type:'webauthn.create'}])await t.test('invalid WebAuthn '+JSON.stringify(extra),async()=>{const p=await prepare();await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge,{extra})}));assert.equal((await service.status(account,p.id)).status,'stopped');});
 await t.test('UP and UV required',async()=>{for(const flags of [0,1,4]){const p=await prepare();await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge,{flags})}));}});
 await t.test('expiry, cross-account access, unavailable executor and duplicate preparation',async()=>{const p=await prepare();await assert.rejects(prepare());await assert.rejects(service.status({...account,id:'other'},p.id));time+=120001;await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge)}));await assert.rejects(createNativeSend(app.db,{chain:{snapshot:async()=>view()}}).prepare(account,{recipient,amount:'1'}));});
 await t.test('ambiguity preserves submitting and prevents another attempt',async()=>{executor.execute=async({id})=>{executions++;await app.db.prepare("UPDATE passkey_native_operations SET phase='submitting' WHERE id=$1").run(id);throw Error('HTTP timeout after possible submission');};const p=await prepare();await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge)}));assert.equal((await service.status(account,p.id)).status,'submitting');await assert.rejects(prepare());await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge)}));assert.equal(executions,2);});
});
test('Strict native amount/recipient, read-only transport and default-off paid configuration',async()=>{
 assert.equal(nativeAmount('0.007'),'7000000000000000');for(const amount of ['0','-1','1e2',' 1','1.0000000000000000001',1])assert.throws(()=>nativeAmount(amount));assert.throws(()=>nativeRecipient(recipient,recipient));
 const rpc=createWalletRPC(async()=>{throw Error('Must not fetch');});await assert.rejects(rpc('quai_sendRawTransaction',['0x']));assert.equal(await configuredExecutor({}, {},{}),null);
});
