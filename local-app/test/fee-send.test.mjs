import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,createHash,sign} from 'node:crypto';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {createApp} from './database.mjs';
import {loadLegal} from '../legal.mjs';
import {loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {createPasskeyAccounts} from '../passkey-accounts.mjs';
import {createFeeSend} from '../wallet/fee-send.mjs';
import {feeDigest,ZERO_TOKEN} from '../wallet/fee-operation.mjs';
import {createFeeAssignments} from '../wallet/fee-assignment.mjs';
import {verifyQuotedAssertion} from '../wallet/operation.mjs';
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

test('Quoted Send: genuine WebAuthn, PostgreSQL consumption, token amounts and ambiguity',async t=>{
 const legal=loadLegal({published:false,version:'test'}),app=await createApp({database:':memory:',legal});t.after(()=>app.close());
 let time=Date.now(),executions=0,generation=3;
 const accounts=createPasskeyAccounts(app.db,{config:{enabled:true,...infra},legal}),d=device(),o=await accounts.options('register','a');
 const {account}=await accounts.verify('register','a',{id:o.id,response:d.register(o.options)});
 // Synthetic deployment manifest used only by the isolated database test.
 const registry=createFeeAssignments({...infra,generation:3,confirmed:true,factory:'0x0000000000000000000000000000000000000005',implementation:'0x0000000000000000000000000000000000000006',implementationTransaction:'0x'+'a'.repeat(64)});
 const legacy=await loadCloneWallet(app.db,account.id);
 const assigned=await registry.assign(app.db,account.id);
 const loadWallet=async(db,id)=>({...await registry.load(db,id),generation});
 const row=await loadWallet(app.db,account.id);
 await t.test('fee wallet persists independently without changing v2 or passkey',async()=>{
  const again=await registry.assign(app.db,account.id);assert.equal(again.address,assigned.address);
  assert.notEqual(assigned.address,legacy.address);assert.equal(assigned.credential_id,legacy.credential_id);
  assert.equal((await loadCloneWallet(app.db,account.id)).address,legacy.address);
  await assert.rejects(app.db.prepare('DELETE FROM passkey_fee_wallets WHERE account_id=$1').run(account.id));
  await assert.rejects(app.db.prepare('UPDATE passkey_fee_wallets SET address=$1 WHERE account_id=$2').run(recipient,account.id));
 });
 const view={deployed:true,epoch:'0',nonce:'0',balanceWei:'100000000000000000000',block:{}};
 const chain={snapshot:async()=>view,token:async()=>({decimals:6,symbol:'TEST',balanceWei:'7000000'})};
 const executor={available:async()=>true,quote:async()=>({relayer:'0x0000000000000000000000000000000000000003',networkFee:'1000000000000000000',gasPrice:'100'}),prepare:async(row,operation)=>({operation}),execute:async({id})=>{executions++;await app.db.prepare("UPDATE passkey_native_operations SET phase='confirmed' WHERE id=$1").run(id);}};
 const service=createFeeSend(app.db,{loadWallet,chain,executor,now:()=>time});
 const prepare=(extra={})=>service.prepare(account,{recipient,amount:'0.007',token:ZERO_TOKEN,...extra});
 const stop=id=>app.db.prepare("UPDATE passkey_native_operations SET phase='stopped' WHERE id=$1").run(id);
 await t.test('default disabled and v2 cannot use fee path',async()=>{await assert.rejects(createFeeSend(app.db,{loadWallet,chain}).prepare(account,{}));generation=2;await assert.rejects(prepare());generation=3;});
 await t.test('one fresh assertion sends once, fee review is exact',async()=>{const p=await prepare();assert.equal(p.review.networkFee,'1.0');assert.equal(p.review.serviceFee,'0.05');assert.equal(p.review.totalFee,'1.05');assert.equal(p.review.amount,'0.007');assert.equal(executions,0);const response=d.assertion(p.options.challenge);assert.equal((await service.confirm(account,{id:p.id,response})).status,'confirmed');await assert.rejects(service.confirm(account,{id:p.id,response}));assert.equal(executions,1);});
 await t.test('token precision comes from server; no fee deduction from token amount',async()=>{const p=await prepare({token:'0x0000000000000000000000000000000000000004',amount:'7',decimals:18});const job=await app.db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1').get(p.id);assert.equal(JSON.parse(job.plan).operation.quote.amount,'7000000');assert.equal(p.review.totalFee,'1.05');assert.equal((await service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge)})).status,'confirmed');await assert.rejects(prepare({token:'0x0000000000000000000000000000000000000004',amount:'7.1'}));});
 await t.test('native validity stays 120 seconds; arbitrary compatible tokens receive bounded 300 seconds',async()=>{
  for(const token of [ZERO_TOKEN,'0x0000000000000000000000000000000000000004','0x0000000000000000000000000000000000000005']){
   const p=await prepare({token,amount:'1'}),job=await app.db.prepare('SELECT plan,expires_at FROM passkey_native_operations WHERE id=$1').get(p.id),op=JSON.parse(job.plan).operation;
   assert.equal(job.expires_at-time,token===ZERO_TOKEN?120000:300000);
   assert.equal(op.deadline,String(Math.floor(job.expires_at/1000)));assert.equal(p.options.timeout,120000);
   const response=d.assertion(p.options.challenge),changed={...op,deadline:String(BigInt(op.deadline)+1n)};changed.digest=feeDigest(changed);
   await assert.rejects(verifyQuotedAssertion(changed,response,row));await stop(p.id);
  }
 });
 await t.test('every quote parameter is authenticated',async()=>{const p=await prepare(),job=await app.db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1').get(p.id),op=JSON.parse(job.plan).operation,response=d.assertion(p.options.challenge);for(const [key,value] of [['amount','8'],['recipient','0x0000000000000000000000000000000000000004'],['token','0x0000000000000000000000000000000000000004'],['networkFee','2'],['gasPrice','101'],['relayer','0x0000000000000000000000000000000000000004'],['requestId','0x'+'b'.repeat(64)]]){const changed={...op,quote:{...op.quote,[key]:value}};changed.digest=feeDigest(changed);await assert.rejects(verifyQuotedAssertion(changed,response,row),key);}await stop(p.id);});
 await t.test('same operation never reuses challenge, even at same timestamp',async()=>{const p=await prepare(),response=d.assertion(p.options.challenge);await stop(p.id);const q=await prepare();assert.notEqual(q.options.challenge,p.options.challenge);await assert.rejects(service.confirm(account,{id:q.id,response}));});
 await t.test('invalid origin, RP and user presence stop without execution',async()=>{for(const opts of [{extra:{origin:'https://evil.example'}},{extra:{crossOrigin:true}},{flags:1}]){const before=executions,p=await prepare();await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge,opts)}));assert.equal(executions,before);assert.equal((await service.status(account,p.id)).status,'stopped');}});
 await t.test('over-fee preflight stops and requires a new quote and fresh passkey',async()=>{
  const normalExecute=executor.execute,before=executions,p=await prepare(),oldResponse=d.assertion(p.options.challenge);
  executor.execute=async()=>{throw Object.assign(Error('above accepted fee'),{code:'FEE_REQUOTE_REQUIRED'});};
  await assert.rejects(service.confirm(account,{id:p.id,response:oldResponse}),/Review a new quote and approve it again with your passkey/);
  assert.equal(executions,before);assert.equal((await service.status(account,p.id)).status,'stopped');
  await assert.rejects(service.confirm(account,{id:p.id,response:oldResponse}));executor.execute=normalExecute;
  const next=await prepare();assert.notEqual(next.options.challenge,p.options.challenge);
  const saved=await app.db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1').get(next.id);
  await assert.rejects(verifyQuotedAssertion(JSON.parse(saved.plan).operation,oldResponse,row));
  assert.equal((await service.confirm(account,{id:next.id,response:d.assertion(next.options.challenge)})).status,'confirmed');assert.equal(executions,before+1);
 });
 await t.test('insufficient QUAI for fee, cross-account access, expiry and parallel prepare',async()=>{view.balanceWei='1';await assert.rejects(prepare());view.balanceWei='100000000000000000000';const p=await prepare();await assert.rejects(prepare());await assert.rejects(service.status({...account,id:'other'},p.id));time+=120001;await assert.rejects(service.confirm(account,{id:p.id,response:d.assertion(p.options.challenge)}));});
 await t.test('ambiguous send stays durable and cannot resubmit',async()=>{executor.execute=async({id})=>{executions++;await app.db.prepare("UPDATE passkey_native_operations SET phase='submitting' WHERE id=$1").run(id);throw Error('ambiguous');};const p=await prepare(),before=executions,response=d.assertion(p.options.challenge);await assert.rejects(service.confirm(account,{id:p.id,response}));assert.equal((await service.status(account,p.id)).status,'submitting');await assert.rejects(service.confirm(account,{id:p.id,response}));await assert.rejects(prepare());assert.equal(executions,before+1);});
});
