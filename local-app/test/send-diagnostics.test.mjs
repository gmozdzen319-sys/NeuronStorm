import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseSend,sendStage,sendStopped} from '../wallet/send-diagnostics.mjs';

test('Send diagnostics preserve errors, redact data, deduplicate and isolate concurrent requests',async()=>{
 const original=console.warn,logs=[];console.warn=(prefix,json)=>logs.push([prefix,JSON.parse(json)]);
 try{
  const secret='PRIVATE_SIGNATURE_ADDRESS_AND_ACCOUNT';
  const error=Object.assign(new Error(secret),{code:'ERR_ASSERTION',actual:secret,expected:secret});
  error.stack=`Error: ${secret}\n at check (file:///private/local-app/wallet/fee-executor.mjs:90:4)`;
  const run=diagnoseSend('confirm',async()=>{sendStage('gate.accounts');sendStopped(error);throw error;});
  await assert.rejects(run(),e=>e===error);
  assert.equal(logs.length,1);assert.deepEqual(logs[0],[ '[wallet-send-stop]',{stage:'gate.accounts',code:'GUARD_REJECTED',guard:'fee-executor:90:4'}]);
  assert(!JSON.stringify(logs).includes(secret));assert(!JSON.stringify(logs).includes('/private'));
  const concurrent=stage=>diagnoseSend(stage,async()=>{await new Promise(r=>setTimeout(r,5));throw Object.assign(Error(secret),{code:'FEE_REQUOTE_REQUIRED'});})();
  await Promise.allSettled([concurrent('prepare.quote'),concurrent('confirm.passkey')]);
  assert.deepEqual(logs.slice(1).map(x=>x[1].stage).sort(),['confirm.passkey','prepare.quote']);
  assert(logs.slice(1).every(x=>x[1].code==='FEE_REQUOTE_REQUIRED'));
  console.warn=()=>{throw Error('logger unavailable');};
  await assert.rejects(diagnoseSend('confirm',async()=>{throw error;})(),e=>e===error);
  assert.equal(await diagnoseSend('success',async()=>42)(),42);
 }finally{console.warn=original;}
});
