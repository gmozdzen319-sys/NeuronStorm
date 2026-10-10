import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ACTIVATION as A,activateOnce,validateActivationQuote} from '../wallet/activate-once.mjs';
import {createApp} from './database.mjs';
function quote(){return {accountId:A.accountId,address:A.wallet,chainId:9,transaction:{from:A.relayer,value:'0',gas:'330000',gasPrice:'30000000000000'},gasLimit:'330000',maximumCostQuai:'9.9',balanceQuai:'100',native:{verified:true},nativePreflightRequired:false,approvalRequired:true,broadcastAllowed:false,quotedAt:new Date().toISOString(),commitment:'test-commitment'};}
test('Activation cap binds actual gas reserve, wallet, account and preflight evidence',()=>{
 assert.equal(validateActivationQuote(quote()),9900000000000000000n);
 for(const patch of [{accountId:randomUUID()},{address:A.relayer},{chainId:1},{maximumCostQuai:'0'},{balanceQuai:'10'},{native:null},{broadcastAllowed:true},{quotedAt:'2000-01-01T00:00:00Z'},{transaction:{...quote().transaction,gasPrice:'50000000000000'},maximumCostQuai:'16.5'}])assert.throws(()=>validateActivationQuote({...quote(),...patch}));
});
async function fixture(t,{overBudget=false,fail=false}={}){
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db,credential=randomUUID(),now=Date.now();
 await db.prepare('INSERT INTO passkey_accounts VALUES($1,$2,$3,NULL,$4,$5)').run(A.accountId,randomUUID(),now,'neuronstorm.onrender.com','https://neuronstorm.onrender.com');
 await db.prepare("INSERT INTO passkey_credentials VALUES($1,$2,$3,0,'Test',FALSE,$4,$4,NULL)").run(credential,A.accountId,'synthetic',now);
 await db.prepare('INSERT INTO passkey_clone_wallets VALUES($1,$2,$3,$4,$5,$6)').run(A.accountId,credential,A.wallet.toLowerCase(),randomUUID(),'{}',now);
 let executed=0,quotes=0;
 const provisioner={quote:async()=>{
  quotes++;const q=quote();if(overBudget){q.transaction.gasPrice='50000000000000';q.maximumCostQuai='16.5';}
  await db.prepare('INSERT INTO passkey_clone_approvals(account_id,quote,commitment,expires_at) VALUES($1,$2,$3,$4)').run(A.accountId,JSON.stringify(q),q.commitment,now+120000);return q;
 },execute:async()=>{
  executed++;const grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1').get(A.attemptId);assert.equal(String(grant.budget_wei),String(A.maximumWei));assert.equal(grant.enabled,true);
  if(fail)throw Error('ambiguous result');return {status:'confirmed'};
 }};
 return {db,provisioner,get executed(){return executed;},get quotes(){return quotes;}};
}
for(const mode of ['success','over-budget','ambiguous'])test('One-shot '+mode+' is durable and cannot repeat or leave sponsorship enabled',async t=>{
 const f=await fixture(t,{overBudget:mode==='over-budget',fail:mode==='ambiguous'});
 if(mode==='success')assert.equal((await activateOnce(f.db,f)).status,'confirmed');else await assert.rejects(activateOnce(f.db,f));
 assert.equal(f.executed,mode==='over-budget'?0:1);
 assert.equal((await f.db.prepare('SELECT enabled FROM passkey_relayer_grants WHERE id=$1').get(A.attemptId)).enabled,false);
 await assert.rejects(activateOnce(f.db,f));assert.equal(f.quotes,1);assert.equal(f.executed,mode==='over-budget'?0:1);
});
