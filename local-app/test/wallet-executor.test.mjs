import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {Wallet,QuaiTransaction} from 'quais';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {createApp} from './database.mjs';
import {assignCloneWallet,loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {createWalletExecutor} from '../wallet/executor.mjs';
import {walletABI} from '../wallet/chain.mjs';
import {operationDigest} from '../wallet/operation.mjs';
import {captureAccounts} from '../wallet/head-guard.mjs';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),q=n=>'0x'+BigInt(n).toString(16),recipient='0x0000000000000000000000000000000000000001';
// Public synthetic test key, generated in the correct Quai ledger/shard.
let signer;for(let i=1;i<10000;i++){const candidate=new Wallet('0x'+i.toString(16).padStart(64,'0'));if(/^0x00[0-7]/i.test(candidate.address)){signer=candidate;break;}}assert(signer);
async function fixture(t){
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db,accountId=randomUUID(),credentialId=randomUUID(),id=randomUUID(),grantId=randomUUID(),now=Date.now();
 const {publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),cose=Buffer.from(isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]))).toString('base64url');
 await db.prepare('INSERT INTO passkey_accounts VALUES($1,$2,$3,NULL,$4,$5)').run(accountId,randomUUID(),now,infra.rpID,infra.origin);
 await db.prepare("INSERT INTO passkey_credentials VALUES($1,$2,$3,0,'Test',FALSE,$4,$4,NULL)").run(credentialId,accountId,cose,now);await assignCloneWallet(db,accountId);const row=await loadCloneWallet(db,accountId),relayer=await signer.getAddress();
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run(grantId,relayer,'300000000000000000000',now+600000);
 const operation={chainId:9,wallet:row.plan.address,recipient,amount:'7000000000000000',action:5,epoch:'0',walletNonce:'0',deadline:String(Math.floor(now/1000)+120)};operation.digest=operationDigest(operation);
 const auth=[hash(1),hash(1),0,0,'0x'+'00'.repeat(37),'{}'];let sent=0,signed,gasPrice=30000000000000n,nonce=0n,alterACL=false,aclDrift=false,preflightFail=false,ambiguous=false,failedReceipt=false,changedData=false;
 const block=n=>({hash:hash(n),woHeader:{hash:hash(n),parentHash:hash(n-1),location:'0x0000',number:q(n),timestamp:q(Math.floor(now/1000))},header:{quaiStateSize:'0x1',gasLimit:'0x989680'}});
 const balance=10n**21n,walletBalance=10n**18n,gas=400000n;
 const rpc=async(method,args=[])=>{
  if(method==='quai_chainId')return '0x9';if(method==='quai_getBlockByNumber')return block(args[0]==='latest'?(sent?18:16):Number(BigInt(args[0])));
  if(method==='quai_gasPrice')return q(gasPrice);
  if(method==='quai_getTransactionCount')return q(sent?1:nonce);
  if(method==='quai_getCode')return '0x6000';if(method==='quai_getStorageAt')return hash(0);
  if(method==='quai_getBalance'){const address=args[0].toLowerCase(),amount=sent&&!failedReceipt?BigInt(operation.amount):0n;return q(address===relayer.toLowerCase()?balance-(sent?gas*BigInt(signed.gasPrice):0n):address===row.address?walletBalance-amount:amount);}
  if(method==='quai_call'){const p=walletABI.parseTransaction({data:args[0].data});let out;switch(p.name){case 'nonce':out=[sent&&!failedReceipt?1:0];break;case 'epoch':out=[0];break;case 'keys':out=[row.plan.x,row.plan.y,true];break;case 'keyCount':case 'keySlotCount':out=[1];break;case 'verifyProbe':out=[true];break;default:throw Error(p.name);}return walletABI.encodeFunctionResult(p.name,out);}
  if(method==='quai_createAccessList')return {accessList:[{address:row.address,storageKeys:alterACL?[hash(9)]:[]}]};
  if(method==='quai_getTransactionReceipt')return {transactionHash:signed.hash,blockHash:hash(16),blockNumber:'0x10',transactionIndex:'0x0',status:failedReceipt?'0x0':'0x1',gasUsed:q(gas),effectiveGasPrice:q(signed.gasPrice)};
  if(method==='quai_getTransactionByHash')return {type:'0x0',chainId:'0x9',from:relayer,to:row.plan.address,nonce:'0x0',value:'0x0',gasPrice:q(signed.gasPrice),gas:q(signed.gasLimit),input:signed.data,accessList:signed.accessList};
  throw Error(method);
 };
 const chain={rpc,snapshot:async()=>({deployed:true,nonce:'0',epoch:'0',balanceWei:String(walletBalance),block:block(16)})};
 const executor=createWalletExecutor(db,{chain,relayer,grantId,stabilize:async()=>({stable:true}),signer:{getAddress:()=>signer.getAddress(),signTransaction:async tx=>{if(changedData)tx.data+='00';return signer.signTransaction(tx);}},sendRaw:async raw=>{sent++;signed=QuaiTransaction.from(raw);if(ambiguous)throw Error('uncertain network');return signed.hash;},verifyNetwork:async()=>true,preflight:async(rpc,tx,row,block)=>{if(preflightFail)throw Error('native mismatch');if(aclDrift)alterACL=true;return {accounts:await captureAccounts(rpc,[{address:row.address,storageKeys:[]}],block),block};}});
 const prepare=()=>executor.prepare(row,operation);
 async function execute(prepared){await db.prepare("INSERT INTO passkey_native_operations(id,account_id,credential_id,phase,plan,assertion,created_at,expires_at) VALUES($1,$2,$3,'authorized',$4,$5,$6,$7)").run(id,accountId,credentialId,JSON.stringify(prepared),JSON.stringify(auth),now,now+120000);return executor.execute({id,accountId,row,prepared,auth});}
 return {db,executor,prepare,execute,id,grantId,get sent(){return sent;},set:(key,value)=>{if(key==='price')gasPrice=value;if(key==='nonce')nonce=value;if(key==='acl')aclDrift=value;if(key==='preflight')preflightFail=value;if(key==='ambiguous')ambiguous=value;if(key==='failed')failedReceipt=value;if(key==='data')changedData=value;},get signed(){return signed;}};
}
test('Executor freezes fee, checks signed bytes and commits one confirmed transfer',async t=>{const f=await fixture(t),p=await f.prepare();f.set('price',999999999999999n);await f.execute(p);assert.equal(f.sent,1);assert.equal(String(f.signed.gasPrice),p.gasPrice);assert.equal((await f.db.prepare('SELECT phase FROM passkey_native_operations WHERE id=$1').get(f.id)).phase,'confirmed');await assert.rejects(f.executor.execute({}));assert.equal(f.sent,1);});
test('Executor rejects gas cap and insufficient approved budget before signing',async t=>{const f=await fixture(t);f.set('price',75000000000001n);await assert.rejects(f.prepare());f.set('price',30000000000000n);await f.db.prepare('UPDATE passkey_relayer_grants SET budget_wei=1 WHERE id=$1').run(f.grantId);await assert.rejects(f.prepare());assert.equal(f.sent,0);});
for(const kind of ['nonce','preflight','data','acl'])test('Executor stops '+kind+' mismatch without broadcast',async t=>{const f=await fixture(t),p=await f.prepare();f.set(kind,kind==='nonce'?1n:true);await assert.rejects(f.execute(p));assert.equal(f.sent,0);});
test('Ambiguous submission leaves durable intent and never broadcasts a second time',async t=>{const f=await fixture(t),p=await f.prepare();f.set('ambiguous',true);await assert.rejects(f.execute(p));assert.equal(f.sent,1);assert.equal((await f.db.prepare('SELECT phase FROM passkey_relayer_intents WHERE operation_id=$1').get(f.id)).phase,'submitting');assert.equal((await f.db.prepare('SELECT phase FROM passkey_native_operations WHERE id=$1').get(f.id)).phase,'submitting');});
test('Failed canonical receipt stays failed, charged once and not retried',async t=>{const f=await fixture(t),p=await f.prepare();f.set('failed',true);await f.execute(p);assert.equal(f.sent,1);assert.equal((await f.db.prepare('SELECT phase FROM passkey_native_operations WHERE id=$1').get(f.id)).phase,'failed');});
