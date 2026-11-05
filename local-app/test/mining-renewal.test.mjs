import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renewMiningIdentity} from '../mining-renewal.mjs';
import {assertCanonicalBlock} from '../wallet/head-guard.mjs';
const hash='0x'+'1'.repeat(64),other='0x'+'2'.repeat(64);
const block={hash,woHeader:{hash,parentHash:hash,location:'0x0000',number:'0x4',timestamp:'0x10'},header:{quaiStateSize:'0x1',gasLimit:'0x100'}};
async function mismatch(){await assertCanonicalBlock(async()=>({...block,hash:other,woHeader:{...block.woHeader,hash:other}}),block);}
for(const method of ['passkey','pelagus','blippay'])test(method+' renews through repeated fresh cycles without repeated wallet signatures',async()=>{
 const account=method==='passkey'?{id:'account',method}:{address:'wallet'};
 let calls=0,failures=0,auth=0;
 for(let cycle=0;cycle<200;cycle++){
  let attempts=0;
  const result=await renewMiningIdentity({loadAccount:async()=>{auth++;return account},challenge:String(cycle),observed:method,
   attest:async(a,c,o)=>{calls++;attempts++;assert.equal(a,account);assert.equal(o,method);if(attempts===1&&cycle%7===0){failures++;await mismatch()}return {challenge:c}},sleep:async()=>{}});
  assert.equal(result.challenge,String(cycle));
 }
 assert.equal(calls,200+failures);assert.equal(auth,calls+200);
});
test('persistent canonicality mismatch discards all three snapshots without minting a ticket',async()=>{
 let calls=0;const delays=[];
 await assert.rejects(()=>renewMiningIdentity({loadAccount:async()=>({id:'a'}),attest:async()=>{calls++;await mismatch()},sleep:async ms=>delays.push(ms)}),e=>e.status===503&&e.message==='MINING_SNAPSHOT_RETRY');
 assert.equal(calls,3);assert.deepEqual(delays,[100,250]);
});
test('logout during snapshot rejects completed ticket',async()=>{
 let reads=0;
 await assert.rejects(()=>renewMiningIdentity({loadAccount:async()=>++reads===1?{id:'a'}:null,attest:async()=>({payload:'not delivered'})}),e=>e.status===401);
});
test('wallet/account changes after snapshot reject completed ticket',async()=>{
 let reads=0;
 await assert.rejects(()=>renewMiningIdentity({loadAccount:async()=>({address:++reads===1?'a':'b'}),attest:async()=>({})}),e=>e.status===401);
});
test('runtime, revoked-key and arbitrary errors do not retry or return a ticket',async()=>{
 for(const message of ['Infrastructure runtime mismatch','Wallet key revoked','Invalid wallet RPC response']){
 let calls=0;await assert.rejects(()=>renewMiningIdentity({loadAccount:async()=>({id:'a'}),attest:async()=>{calls++;throw Error(message)}}),new RegExp(message));assert.equal(calls,1);
 }
});
