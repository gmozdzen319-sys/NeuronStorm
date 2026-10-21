import test from 'node:test';
import assert from 'node:assert/strict';
import {createSendProgress} from '../wallet/send-progress.mjs';
import {diagnoseSend,sendStage} from '../wallet/send-diagnostics.mjs';
const id='00000000-0000-4000-8000-000000000001',account={id:'owner'};

test('Progress reflects actual preparation events, stays fixed without events, and reaches 100 only on success',async()=>{
 let time=0;const p=createSendProgress({now:()=>time});let finish;
 const done=new Promise(r=>finish=r),result={id:'operation'};
 const running=p.run(account,id,'prepare',diagnoseSend('prepare',async()=>{sendStage('quote.estimation');await done;return result;}));
 assert.equal(p.read(account,id).percent,45);time=20000;assert.equal(p.read(account,id).percent,45);
 assert.equal(p.read({id:'other'},id),null);finish();assert.equal(await running,result);assert.equal(p.read(account,id).percent,100);
});
test('Send progress cannot confirm a pending, stopped, failed or uncertain operation',async()=>{
 for(const status of ['submitting','stopped','failed','confirmed']){
  const p=createSendProgress(),result={status};
  const value=await p.run(account,id,'send',diagnoseSend('confirm',async()=>{sendStage('confirm.credential_and_authorization');assert.equal(p.read(account,id).percent,20);sendStage('execute.broadcast');sendStage('execute.receipt');sendStage('execute.settlement');return result;}));
  assert.equal(value,result);assert.equal(p.read(account,id).percent,status==='confirmed'?100:90);
 }
});
test('Telemetry preserves original error and never exposes its contents',async()=>{
 const p=createSendProgress(),error=Error('PRIVATE_SIGNATURE');
 await assert.rejects(p.run(account,id,'send',async()=>{sendStage('execute.preflight');throw error;}),e=>e===error);
 assert.equal(p.read(account,id).percent,45);assert(!JSON.stringify(p.read(account,id)).includes('PRIVATE_SIGNATURE'));
});
test('Progress isolation, capacity, expiry and duplicate IDs never cause transaction retry',async()=>{
 let time=0,calls=0;const p=createSendProgress({now:()=>time,limit:1,ttl:10});
 const fn=async()=>{calls++;return {status:'submitting'};};
 await p.run(account,id,'send',fn);await p.run({id:'other'},id,'send',fn);
 assert.equal(p.read({id:'other'},id),null);assert.equal(calls,2);
 time=11;assert.equal(p.read(account,id),null);
 await p.run(account,'invalid','send',fn);assert.equal(calls,3);assert.equal(p.read(account,'invalid'),null);
});
