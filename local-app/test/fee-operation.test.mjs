import test from 'node:test';import assert from 'node:assert/strict';
import {feeDigest,quotedFee,tokenAmount,validateFeeExecution,ZERO_TOKEN} from '../wallet/fee-operation.mjs';
const address=n=>'0x00'+String(n).repeat(38);
function operation(){const op={chainId:9,action:6,wallet:address(1),epoch:'0',walletNonce:'0',deadline:'1800000000',quote:{token:ZERO_TOKEN,recipient:address(2),amount:'7',relayer:address(3),networkFee:'1000',gasPrice:'10',requestId:'0x'+'a'.repeat(64)}};op.digest=feeDigest(op);return op;}
test('quoted fee adds only 5% of network cost, with exact integer rounding',()=>{
 assert.deepEqual(quotedFee(100,10),{networkFee:'1000',serviceFee:'50',totalFee:'1050'});
 assert.equal(quotedFee(1,21).serviceFee,'2');assert.equal(quotedFee(1,20).serviceFee,'1');
});
test('amount precision is token-specific and bounded only by uint256',()=>{
 assert.equal(tokenAmount('7.123456',6),'7123456');assert.equal(tokenAmount('7',0),'7');
 assert.equal(tokenAmount('100000000000000000000000000',18),'100000000000000000000000000000000000000000000');
 for(const s of ['0','1e3','-1','1.0000001'])assert.throws(()=>tokenAmount(s,6));
 assert.throws(()=>tokenAmount((1n<<256n).toString(),0));
});
test('quote binds every payment, wallet, chain, action and replay parameter',()=>{
 const op=operation();
 for(const [key,value] of [['recipient',address(4)],['relayer',address(4)],['token',address(4)],['amount','8'],['networkFee','1001'],['gasPrice','11'],['requestId','0x'+'b'.repeat(64)]])assert.notEqual(feeDigest({...op,quote:{...op.quote,[key]:value}}),op.digest,key);
 for(const [key,value] of [['wallet',address(4)],['walletNonce','1'],['epoch','1'],['deadline','1800000001']])assert.notEqual(feeDigest({...op,[key]:value}),op.digest,key);
 assert.throws(()=>feeDigest({...op,chainId:1}));assert.throws(()=>feeDigest({...op,action:5}));
});
test('exact preflight cannot increase signed fees and requires amount plus fee',()=>{
 const op=operation(),state={estimatedGas:'100',gasLimit:'134',gasPrice:'10',walletQuai:'1057'};
 assert.equal(validateFeeExecution(op,state).totalFee,'1050');
 for(const change of [{estimatedGas:'101'},{gasLimit:'99'},{gasPrice:'11'},{walletQuai:'1056'}])assert.throws(()=>validateFeeExecution(op,{...state,...change}));
 op.quote.token=address(4);op.digest=feeDigest(op);assert.equal(validateFeeExecution(op,{...state,walletQuai:'1050',tokenBalance:'7'}).totalFee,'1050');
 assert.throws(()=>validateFeeExecution(op,{...state,tokenBalance:'6'}));
});
