import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {Wallet,QuaiTransaction} from 'quais';import {isoCBOR} from '@simplewebauthn/server/helpers';
import {createApp} from './database.mjs';
import {assignCloneWallet,loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {factoryABI} from '../wallet/chain.mjs';
import {createAutoActivation,validateAutoQuote} from '../wallet/auto-activation.mjs';
import {createCloneProvisioner} from '../wallet/provisioner.mjs';
import {quoteProvisioning} from '../wallet/provisioning-quote.mjs';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),q=n=>'0x'+BigInt(n).toString(16);
let signer;for(let n=1;n<10000;n++){const s=new Wallet(hash(n));if(/^0x00[0-7]/i.test(s.address)){signer=s;break;}}assert(signer);
async function fixture(t){
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db,accountId=randomUUID(),credentialId=randomUUID(),grantId=randomUUID(),now=Date.now();
 const {publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),cose=Buffer.from(isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]))).toString('base64url');
 await db.prepare('INSERT INTO passkey_accounts VALUES($1,$2,$3,NULL,$4,$5)').run(accountId,randomUUID(),now,infra.rpID,infra.origin);await db.prepare("INSERT INTO passkey_credentials VALUES($1,$2,$3,0,'Test',FALSE,$4,$4,NULL)").run(credentialId,accountId,cose,now);await assignCloneWallet(db,accountId);const row=await loadCloneWallet(db,accountId),relayer=await signer.getAddress();
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run(grantId,relayer,'100000000000000000000',now+600000);
 let sends=0,signed,ambiguous=false,wrongReturn=false,wrongNonce=false,mutateInput=false;
 const block=n=>({hash:hash(n),woHeader:{hash:hash(n),parentHash:hash(n-1),location:'0x0000',number:q(n),timestamp:q(Math.floor(now/1000))},header:{quaiStateSize:'0x1',gasLimit:'0x989680'}});
 const rpc=async(method,args=[])=>{
  if(method==='quai_chainId')return '0x9';if(method==='quai_getBlockByNumber')return block(args[0]==='latest'?(sends?19:16):Number(BigInt(args[0])));
  if(method==='quai_getTransactionCount')return q(sends||wrongNonce?1:0);if(method==='quai_getBalance')return q(10n**21n);if(method==='quai_gasPrice')return q(30000000000000n);
  if(method==='quai_getTransactionReceipt'){if(args[0]===infra.factoryTransaction)return {status:'0x1',contractAddress:infra.factory,blockNumber:'0x1',blockHash:hash(1)};return {status:'0x1',blockNumber:'0x10',blockHash:hash(16),transactionHash:signed.hash,transactionIndex:'0x0',gasUsed:q(240000),effectiveGasPrice:q(signed.gasPrice)};}
  if(method==='quai_getLogs')return [];if(method==='quai_createAccessList')return {gasUsed:q(240000),accessList:[{address:infra.factory.toLowerCase(),storageKeys:[]}]};if(method==='quai_estimateGas')return q(320000);
  if(method==='quai_getTransactionByHash')return {type:'0x0',chainId:'0x9',from:relayer,to:infra.factory,nonce:'0x0',value:'0x0',gasPrice:q(signed.gasPrice),gas:q(signed.gasLimit),input:signed.data,accessList:signed.accessList};
  throw Error(method);
 };
 const chain={rpc,snapshot:async()=>({deployed:sends>0,nonce:'0',epoch:'0',block:block(16)})};
 const preflight=async(rpc,tx,row,block)=>({block,accounts:[],gasUsed:'240000',returnValue:factoryABI.encodeFunctionResult('createWallet',[wrongReturn?infra.implementation:row.plan.address])});
 const makeProvisioner=id=>createCloneProvisioner(db,{chain,relayer,grantId:id,stabilize:async()=>({stable:true}),signer:{getAddress:()=>signer.getAddress(),signTransaction:tx=>{if(mutateInput)tx.data+='00';return signer.signTransaction(tx);}},sendRaw:async raw=>{sends++;signed=QuaiTransaction.from(raw);if(ambiguous)throw Error('uncertain network');return signed.hash;},preflight,verifyNetwork:async()=>true});
 const provisioner=makeProvisioner(grantId);
 return {db,accountId,relayer,chain,provisioner,makeProvisioner,get sends(){return sends;},set:k=>{if(k==='ambiguous')ambiguous=true;if(k==='address')wrongReturn=true;if(k==='nonce')wrongNonce=true;if(k==='input')mutateInput=true;},approve:()=>db.prepare('UPDATE passkey_clone_approvals SET approved=TRUE WHERE account_id=$1').run(accountId)};
}
test('Provision quote is exact to RPC/native simulation, creates no wallet and needs separate approval',async t=>{const f=await fixture(t),quote=await f.provisioner.quote(f.accountId);assert.equal(quote.expectedCostQuai,'7.2');assert.equal(quote.maximumCostQuai,'9.9');assert.equal(quote.broadcastAllowed,false);assert.equal(quote.nativePreflightRequired,false);assert.equal(f.sends,0);await assert.rejects(f.provisioner.execute(f.accountId));assert.equal(f.sends,0);});
test('Approved provisioning calls only the existing factory once and verifies assigned clone',async t=>{const f=await fixture(t),quote=await f.provisioner.quote(f.accountId);await f.approve();const r=await f.provisioner.execute(f.accountId);assert.equal(r.address,quote.address);assert.equal(r.status,'confirmed');assert.equal(f.sends,1);await assert.rejects(f.provisioner.execute(f.accountId));assert.equal(f.sends,1);});
for(const kind of ['address','nonce','input'])test('Provisioning stops '+kind+' mismatch without spending',async t=>{const f=await fixture(t);await f.provisioner.quote(f.accountId);await f.approve();f.set(kind);await assert.rejects(f.provisioner.execute(f.accountId));assert.equal(f.sends,0);});
test('Ambiguous factory call stays durable and cannot be resubmitted',async t=>{const f=await fixture(t);await f.provisioner.quote(f.accountId);await f.approve();f.set('ambiguous');await assert.rejects(f.provisioner.execute(f.accountId));assert.equal(f.sends,1);assert.equal((await f.db.prepare('SELECT phase FROM passkey_clone_approvals WHERE account_id=$1').get(f.accountId)).phase,'submitting');await assert.rejects(f.provisioner.execute(f.accountId));assert.equal(f.sends,1);});
test('RPC-only quote cannot become an executable native preflight proof',async t=>{const f=await fixture(t),quote=await quoteProvisioning(f.db,{accountId:f.accountId,relayer:f.relayer,chain:f.chain});assert.equal(quote.nativePreflightRequired,true);assert.equal(quote.native,null);assert.equal(f.sends,0);});

test('Automatic activation runs real sender once, retains wallet and disables account grant',async t=>{
 const f=await fixture(t),before=await loadCloneWallet(f.db,f.accountId);
 const worker=createAutoActivation(f.db,f);
 assert.equal((await worker.runNext()).status,'confirmed');assert.equal(f.sends,1);
 assert.equal((await loadCloneWallet(f.db,f.accountId)).address,before.address);
 const g=await f.db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1').get('auto-activation-v1:'+f.accountId);
 assert.equal(g.enabled,false);assert.equal(g.budget_wei,'15000000000000000000');
 assert.equal(await createAutoActivation(f.db,f).runNext(),null);assert.equal(f.sends,1);
});
test('Concurrent workers cannot claim or pay for the same account twice',async t=>{
 const f=await fixture(t);const result=await Promise.all([createAutoActivation(f.db,f).runNext(),createAutoActivation(f.db,f).runNext()]);
 assert.equal(result.filter(Boolean).length,1);assert.equal(f.sends,1);
});
test('Existing expired unapproved quote safely enters automatic activation with same assignment',async t=>{
 const f=await fixture(t);await f.provisioner.quote(f.accountId);
 await f.db.prepare('UPDATE passkey_clone_approvals SET expires_at=0 WHERE account_id=$1').run(f.accountId);
 assert.equal((await createAutoActivation(f.db,f).runNext()).status,'confirmed');assert.equal(f.sends,1);
});
for(const kind of ['nonce','input','address','ambiguous'])test('Automatic activation stops '+kind+' without automatic retry after restart',async t=>{
 const f=await fixture(t);const makeProvisioner=id=>{const p=f.makeProvisioner(id);return {...p,quote:async account=>{const q=await p.quote(account);f.set(kind);return q;}};};const r=await createAutoActivation(f.db,{...f,makeProvisioner}).runNext();
 assert.equal(r.status,kind==='ambiguous'?'ambiguous':'stopped');
 assert.equal(f.sends,kind==='ambiguous'?1:0);
 assert.equal(await createAutoActivation(f.db,f).runNext(),null);
 assert.equal(f.sends,kind==='ambiguous'?1:0);
});
for(const patch of ['cap','balance','chain','wallet','stale','proof'])test('Auto quote rejects '+patch+' before sender executes',async t=>{
 const f=await fixture(t);let executeCalls=0;
 const makeProvisioner=id=>{const p=f.makeProvisioner(id);return {quote:async account=>{const q=await p.quote(account);
  if(patch==='cap'){q.transaction.gasPrice='50000000000000';q.maximumCostQuai='16.5';}
  if(patch==='balance')q.balanceQuai='10';if(patch==='chain')q.chainId=1;
  if(patch==='wallet')q.address=infra.factory;if(patch==='stale')q.quotedAt='2000-01-01T00:00:00Z';
  if(patch==='proof')q.native=null;return q;},execute:async()=>{executeCalls++;}};};
 assert.equal((await createAutoActivation(f.db,{...f,makeProvisioner}).runNext()).status,'stopped');
 assert.equal(executeCalls,0);assert.equal(f.sends,0);assert.equal(await createAutoActivation(f.db,f).runNext(),null);
});
test('Prior stopped/paid/ambiguous history never gets an automatic reapproval',async t=>{
 const f=await fixture(t);await f.provisioner.quote(f.accountId);await f.approve();
 await f.db.prepare("UPDATE passkey_clone_approvals SET approved=FALSE,phase='quoted',expires_at=0 WHERE account_id=$1").run(f.accountId);
 assert.equal(await createAutoActivation(f.db,f).runNext(),null);assert.equal(f.sends,0);
});
test('Process crash claim remains blocked after restart',async t=>{
 const f=await fixture(t);const id='auto-activation-v1:'+f.accountId;
 await f.db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at) VALUES($1,$2,$3,0)').run(id,f.relayer,'15000000000000000000');
 await f.db.prepare("INSERT INTO passkey_auto_activations VALUES($1,$2,$3,'running',0)").run(f.accountId,f.relayer.toLowerCase(),id);
 assert.equal(await createAutoActivation(f.db,f).runNext(),null);assert.equal(f.sends,0);
});
test('Auto cap accepts below 15 QUAI and rejects the next whole-wei gas price above it',async t=>{
 const f=await fixture(t),q=await f.provisioner.quote(f.accountId),price=15000000000000000000n/330000n;
 const {formatUnits}=await import('quais');
 q.transaction.gasPrice=String(price);q.maximumCostQuai=formatUnits(price*330000n,18);
 assert.equal(validateAutoQuote(q,{accountId:f.accountId,address:q.address,relayer:f.relayer}),price*330000n);
 q.transaction.gasPrice=String(price+1n);q.maximumCostQuai=formatUnits((price+1n)*330000n,18);
 assert.throws(()=>validateAutoQuote(q,{accountId:f.accountId,address:q.address,relayer:f.relayer}));
});
test('Wallet view switches from automatic preparation to Receive only after confirmed deployment',async t=>{
 const f=await fixture(t),{createPasskeyWallet}=await import('../passkey-wallet.mjs');
 const chain={...f.chain,snapshot:async plan=>({...await f.chain.snapshot(plan),quaiBalance:'0.0',observedAt:Date.now()})};
 const service=createPasskeyWallet(f.db,{chain,autoActivation:true}),account={id:f.accountId,method:'passkey'};
 const pending=await service.state(account);assert.equal(pending.status,'activating');assert.equal(pending.address,null);assert.equal(pending.receiveAvailable,false);
 await createAutoActivation(f.db,f).runNext();
 const active=await service.state(account);assert.equal(active.status,'active');assert.equal(active.quaiBalance,'0.0');assert.equal(active.receiveAvailable,true);assert.equal(active.sendAvailable,false);
 const receive=await service.receive(account);assert.equal(receive.address,active.address);assert.match(receive.qr,/^data:image\/png;base64,/);
 assert.equal((await createPasskeyWallet(f.db,{chain,autoActivation:true}).state(account)).address,active.address);
});
test('Stopped automatic activation leaves Receive unavailable with English waiting state',async t=>{
 const f=await fixture(t),{createPasskeyWallet}=await import('../passkey-wallet.mjs');f.set('address');
 await createAutoActivation(f.db,f).runNext();
 const state=await createPasskeyWallet(f.db,{chain:f.chain,autoActivation:true}).state({id:f.accountId,method:'passkey'});
 assert.equal(state.status,'activation_waiting');assert.equal(state.address,null);assert.equal(state.receiveAvailable,false);assert.match(state.reason,/No automatic retry/);assert.equal(f.sends,0);
});
