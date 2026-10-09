import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planWalletClone} from '../wallet-clone-plan.mjs';
const input={chainId:9,factory:'0x0011111111111111111111111111111111111111',implementation:'0x0022222222222222222222222222222222222222',x:'0x'+'11'.repeat(32),y:'0x'+'22'.repeat(32)};
test('clone plan is bounded, deterministic, Quai-ledger scoped and not a deposit address',()=>{
 const a=planWalletClone(input);assert.deepEqual(a,planWalletClone(input));assert.match(a.address,/^0x00[0-7]/i);
 assert.equal(a.runtime.length,92);assert.equal(a.receiveAvailable,false);assert(Object.isFrozen(a));
 assert.notEqual(a.address,planWalletClone({...input,y:'0x'+'33'.repeat(32)}).address);
 assert.notEqual(a.address,planWalletClone({...input,implementation:'0x0033333333333333333333333333333333333333'}).address);
});
test('clone planner fails closed on unsupported chain, infrastructure and malformed input',()=>{
 for(const extra of [{chainId:1},{factory:'0x1122222222222222222222222222222222222222'},{implementation:'0x0082222222222222222222222222222222222222'},{implementation:'0x'+'0'.repeat(40)},{x:'0x12'},{start:-1},{start:Infinity},{start:Number.MAX_SAFE_INTEGER}])assert.throws(()=>planWalletClone({...input,...extra}));
});
