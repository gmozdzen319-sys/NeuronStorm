import test from 'node:test';
import assert from 'node:assert/strict';
import {createMiningPairs} from '../mining-pairs.mjs';
const address='0x0011111111111111111111111111111111111111';
function setup(){
 let now=0;const pairs=createMiningPairs({clock:()=>now});const {id,control,invite}=pairs.open('blippay');
 const {heartbeat}=pairs.claim({id,invite},'session',address,'blippay');
 const ch=()=>pairs.challenge({id,heartbeat},'session').challenge;
 const confirm=(challenge,extra={})=>pairs.confirm({id,heartbeat,challenge,address,method:'blippay',chain:'9',...extra},'session',address);
 return {pairs,id,control,invite,heartbeat,ch,confirm,time:t=>now=t};
}
test('poll cannot extend phone confirmation; delayed proof loses its transit time',()=>{
 const f=setup();const ch=f.ch();f.time(1500);f.confirm(ch);
 assert.equal(f.pairs.poll(f).remainingMs,2500);f.time(3999);assert.equal(f.pairs.poll(f).remainingMs,1);
 f.time(4000);assert.throws(()=>f.pairs.poll(f),/expired/);
});
test('disconnect and account change invalidate pair permanently',()=>{
 const f=setup();f.confirm(f.ch());f.pairs.close(f);assert.throws(()=>f.pairs.poll(f),/expired/);
 const g=setup();assert.throws(()=>g.confirm(g.ch(),{address:'0x0022222222222222222222222222222222222222'}));assert.throws(()=>g.pairs.poll(g));
});
test('reject reused invite, foreign reader, expired confirmations and session substitution',()=>{
 const f=setup();assert.throws(()=>f.pairs.claim(f,'other',address,'blippay'));assert.throws(()=>f.pairs.poll({...f,control:f.invite}));
 const ch=f.ch();f.time(4100);assert.throws(()=>f.confirm(ch));
 const g=setup();assert.throws(()=>g.pairs.challenge(g,'other'));assert.throws(()=>g.pairs.poll(g));
});
for(const method of ['pelagus','blippay'])test(method+' renews the same authenticated wallet for 20 minutes while preserving the four-second deadline',()=>{
 let now=0;const pairs=createMiningPairs({clock:()=>now});const f=pairs.open(method);
 const {heartbeat}=pairs.claim({...f},'session',address,method);
 for(let cycle=0;cycle<1200;cycle++){
  now=cycle*1000;const {challenge}=pairs.challenge({...f,heartbeat},'session');
  pairs.confirm({...f,heartbeat,challenge,address,method,chain:'9'},'session',address);
  const state=pairs.poll(f);assert.equal(state.address,address);assert.equal(state.remainingMs,4000);
 }
 now+=4000;assert.throws(()=>pairs.poll(f),/expired/);
});
