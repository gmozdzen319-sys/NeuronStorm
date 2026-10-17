import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseActivationPreAttempt,activationPreStage,activationAttemptClaimed} from '../wallet/activation-pre-attempt.mjs';
import {configuredFeeAutoActivation} from '../wallet/fee-auto-activation.mjs';

test('pre-attempt stages log only safe labels and rethrow the identical error, once without retry',async()=>{
 const old=console.warn,logs=[];console.warn=(...v)=>logs.push(v);
 try{
  for(const stage of ['QUEUE_READ','HEAD_READ','HEAD_VALIDATE','FACTORY_CONTEXT','FACTORY_RECEIPT','FACTORY_ANCHOR','FACTORY_RUNTIME','FACTORY_NONCE','CHECKPOINT_LOAD','CHECKPOINT_VALIDATE','CHECKPOINT_ANCESTRY','FACTORY_MAPPINGS','HISTORY_SCAN','HISTORY_LOGS','HISTORY_LOG_VALIDATE','CHECKPOINT_CANONICALITY','CHECKPOINT_SAVE','FACTORY_FINAL_VERIFY','CLAIM_TRANSACTION','CLAIM_LOCK','CLAIM_BLOCKERS','CLAIM_CANDIDATE','CLAIM_GRANT_INSERT','CLAIM_ATTEMPT_INSERT']){
   let calls=0;const error=Object.assign(new Error('SECRET'),{code:'ERR_ASSERTION',actual:'SECRET',stack:'Error: SECRET\n at read (file:///private/factory-checkpoint.mjs:34:7)'});
   await assert.rejects(diagnoseActivationPreAttempt(async()=>{calls++;activationPreStage(stage);throw error;}),e=>e===error);
   assert.equal(calls,1);const record=JSON.parse(logs.at(-1)[1]);assert.deepEqual(record,{stage,code:'INVARIANT_FAILED',subcode:'ASSERTION_FAILED',guard:'factory-checkpoint:34:7'});
  }
  assert.equal(logs.length,24);assert(!JSON.stringify(logs).includes('SECRET'));
 }finally{console.warn=old;}
});
test('success and post-claim failure do not produce pre-attempt diagnostics; logger failure cannot replace error',async()=>{
 const old=console.warn;let calls=0;console.warn=()=>{calls++;throw Error('logger');};
 try{
  assert.equal(await diagnoseActivationPreAttempt(async()=>null),null);
  const e=Error('original');await assert.rejects(diagnoseActivationPreAttempt(async()=>{activationAttemptClaimed();throw e;}),x=>x===e);assert.equal(calls,0);
  await assert.rejects(diagnoseActivationPreAttempt(async()=>{throw e;}),x=>x===e);assert.equal(calls,1);
 }finally{console.warn=old;}
});
test('concurrent contexts stay isolated and arbitrary error data is not logged',async()=>{
 const old=console.warn,logs=[];console.warn=(_,v)=>logs.push(JSON.parse(v));
 try{await Promise.all(['HEAD_READ','CHECKPOINT_LOAD'].map(stage=>assert.rejects(diagnoseActivationPreAttempt(async()=>{activationPreStage(stage);await Promise.resolve();throw {message:'secret',code:'secret',stack:'secret'};}))));assert.deepEqual(logs.map(x=>x.stage).sort(),['CHECKPOINT_LOAD','HEAD_READ']);assert(!JSON.stringify(logs).includes('secret'));}finally{console.warn=old;}
});
test('production wrapper records claim failure without RPC or signer access',async()=>{
 const logs=[],old=console.warn;console.warn=(_,v)=>logs.push(JSON.parse(v));
 let reads=0;const db={transaction:async()=>{throw Error('not-logged');},prepare:()=>({get:async()=>({account_id:'not-logged'})})};
 const fee={registry:{infrastructure:{generation:3}},chain:{rpc:async()=>{reads++;return null;}}};
 const env={NS_FEE_AUTO_ACTIVATE:'true',NS_FEE_SEND_ENABLED:'true',NS_WALLET_NETWORK_POLICY:'official-single-source-v1',NS_WALLET_RELAYER_ADDRESS:'0x001893151cdcc11372f6dd067e3424f47ad8534a'};
 try{await assert.rejects(configuredFeeAutoActivation(db,fee,env).runNext());assert.equal(reads,0);assert.equal(logs.length,1);assert.equal(logs[0].stage,'CLAIM_TRANSACTION');assert(!JSON.stringify(logs).includes('not-logged'));}finally{console.warn=old;}
});
