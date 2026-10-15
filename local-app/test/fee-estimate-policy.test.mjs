import test from 'node:test';
import assert from 'node:assert/strict';
import {feeGasEstimate,FEE_BUFFER_BPS} from '../wallet/fee-estimate-policy.mjs';
import {feeDigest,validateFeeExecution,ZERO_TOKEN} from '../wallet/fee-operation.mjs';
test('Fee allowance uses measured gas, rounds upward, and does not bill execution headroom',()=>{
 assert.equal(FEE_BUFFER_BPS,1500n);assert.equal(feeGasEstimate(429892),494376n);
 assert.equal(feeGasEstimate(1),2n);assert.throws(()=>feeGasEstimate(0));assert.throws(()=>feeGasEstimate(-1));
 assert(feeGasEstimate(429892)<587556n);
});
test('Exact preflight accepts the signed fee boundary and rejects one gas above without mutation',()=>{
 const address=n=>'0x00'+String(n).repeat(38),op={chainId:9,action:6,wallet:address(1),epoch:'0',walletNonce:'0',deadline:'1800000000',quote:{token:ZERO_TOKEN,recipient:address(2),amount:'7',relayer:address(3),networkFee:'1000',gasPrice:'10',requestId:'0x'+'a'.repeat(64)}};op.digest=feeDigest(op);
 const before=JSON.stringify(op),args={estimatedGas:100,gasLimit:134,gasPrice:10,walletQuai:2000};
 assert.equal(validateFeeExecution(op,args).totalFee,'1050');
 assert.throws(()=>validateFeeExecution(op,{...args,estimatedGas:101}),{code:'FEE_REQUOTE_REQUIRED'});
 assert.throws(()=>validateFeeExecution(op,{...args,gasPrice:11}),/Frozen price changed/);
 assert.equal(JSON.stringify(op),before);
});
