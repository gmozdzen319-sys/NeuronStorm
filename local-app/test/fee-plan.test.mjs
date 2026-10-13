import test from 'node:test';
import assert from 'node:assert/strict';
import {executionLimit,reserveFee,createFeeTransaction,verifyFrozenFeeTransaction,feeWalletABI,feeAccessList} from '../wallet/fee-plan.mjs';
import {NS_TOKEN} from '../neuron-token.mjs';
import {feeDigest,ZERO_TOKEN} from '../wallet/fee-operation.mjs';
const addr=n=>'0x00'+String(n).repeat(38);
test('fee ACL supports NS/token storage without weakening duplicate and slot validation',()=>{
 const item={address:NS_TOKEN.address,storageKeys:['0x'+'0'.repeat(64)]};
 assert.equal(feeAccessList([item])[0].address,NS_TOKEN.address.toLowerCase());
 assert.throws(()=>feeAccessList([item,item]));assert.throws(()=>feeAccessList([{...item,storageKeys:['0x01']}]));
 assert.throws(()=>feeAccessList([{...item,storageKeys:[...item.storageKeys,...item.storageKeys]}]));
});
function plan(){
 const operation={chainId:9,action:6,wallet:addr(1),epoch:'0',walletNonce:'0',deadline:'1800000000',quote:{token:ZERO_TOKEN,recipient:addr(2),amount:'7',relayer:addr(3),networkFee:'1000',gasPrice:'10',requestId:'0x'+'a'.repeat(64)}};operation.digest=feeDigest(operation);
 const auth=['0x'+'1'.repeat(64),'0x'+'2'.repeat(64),0,0,'0x'+'00'.repeat(37),'{}'];
 return createFeeTransaction({operation,auth,keyId:'0x'+'b'.repeat(64),relayerNonce:'20',gasLimit:'134',preflightGas:'100',walletQuai:'1057',accessList:[{address:addr(1),storageKeys:['0x'+'0'.repeat(64)]}]});
}
test('fee execution limit follows native and RPC estimates, bounded by the block',()=>{
 assert.equal(executionLimit({nativeMinimum:'1000100',rpcEstimate:'1500000',blockGasLimit:'30000000'}),'1500000');
 assert.equal(executionLimit({nativeMinimum:'1800000',rpcEstimate:'1500000',blockGasLimit:'30000000'}),'1800000');
 assert.throws(()=>executionLimit({nativeMinimum:2,rpcEstimate:3,blockGasLimit:2}));
});
test('relayer reserves full exposure before reimbursement, including independent margin',()=>{
 const data={gasLimit:134,gasPrice:10,relayerBalance:1440,remainingBudget:1340,safetyMargin:100};
 assert.equal(reserveFee(data),'1340');
 for(const extra of [{remainingBudget:1339},{relayerBalance:1439},{gasPrice:11}])assert.throws(()=>reserveFee({...data,...extra}));
});
test('exact signature bytes and frozen transaction cannot change after preflight',()=>{
 const p=plan();verifyFrozenFeeTransaction(p,structuredClone(p.transaction));
 const decoded=feeWalletABI.decodeFunctionData('sendQuoted',p.transaction.data);assert.equal(decoded[0].amount,7n);assert.equal(decoded[0].networkFee,1000n);assert.equal(decoded[3].clientDataJSON,'{}');
 for(const changed of [{gasPrice:'11'},{gasLimit:'135'},{nonce:'21'},{value:'1'},{chainId:1},{to:addr(4)},{data:p.transaction.data+'00'},{accessList:[]}])assert.throws(()=>verifyFrozenFeeTransaction(p,{...p.transaction,...changed}));
 // A newer RPC recommendation is not an input and never mutates the plan.
 const frozen=JSON.stringify(p);for(const recommendation of [9,11,1000]){void recommendation;verifyFrozenFeeTransaction(p,p.transaction);}assert.equal(JSON.stringify(p),frozen);
});
