import assert from 'node:assert/strict';
import {Interface,getAddress} from 'quais';
import {feeDigest,QUOTE_TUPLE,validateFeeExecution} from './fee-operation.mjs';
import {fingerprint} from './transaction-policy.mjs';

// Legacy native-only policy intentionally excludes token storage and fixes gas.
// Keep that path unchanged; fee sends must bind arbitrary validated token ACLs.
export function feeAccessList(list){
 assert(Array.isArray(list)&&list.length>0);const seen=new Set();
 return list.map(a=>{
  assert.deepEqual(Object.keys(a).sort(),['address','storageKeys']);
  const address=getAddress(a.address).toLowerCase();assert(!seen.has(address));seen.add(address);
  assert(Array.isArray(a.storageKeys));const storageKeys=a.storageKeys.map(k=>{assert(typeof k==='string'&&/^0x[0-9a-f]{64}$/i.test(k));return k.toLowerCase();});
  assert.equal(new Set(storageKeys).size,storageKeys.length);
  return {address,storageKeys:storageKeys.sort()};
 }).sort((a,b)=>a.address.localeCompare(b.address));
}
export function boundFeeTransaction(tx){
 assert(Object.keys(tx).every(k=>['chainId','type','from','to','nonce','value','gasPrice','gasLimit','data','accessList'].includes(k)));
 assert.equal(BigInt(tx.chainId),9n);assert.equal(BigInt(tx.type),0n);assert.equal(BigInt(tx.value),0n);
 assert(BigInt(tx.nonce)>=0n&&BigInt(tx.nonce)<=BigInt(Number.MAX_SAFE_INTEGER));
 assert(BigInt(tx.gasPrice)>0n&&BigInt(tx.gasLimit)>0n&&BigInt(tx.gasLimit)<=BigInt(Number.MAX_SAFE_INTEGER));
 assert(/^0x(?:[0-9a-f]{2})+$/i.test(tx.data));
 return {chainId:'9',type:'0',from:getAddress(tx.from).toLowerCase(),to:getAddress(tx.to).toLowerCase(),nonce:String(BigInt(tx.nonce)),value:'0',gasPrice:String(BigInt(tx.gasPrice)),gasLimit:String(BigInt(tx.gasLimit)),data:tx.data.toLowerCase(),accessList:feeAccessList(tx.accessList)};
}

export const feeWalletABI=new Interface([
 `function sendQuoted(${QUOTE_TUPLE},uint256,bytes32,(bytes32 r,bytes32 s,uint256 challengeIndex,uint256 typeIndex,bytes authenticatorData,string clientDataJSON))`,
 'event QuotedSend(bytes32 indexed requestId,address indexed token,address indexed recipient,uint256 amount,address relayer,uint256 networkFee,uint256 serviceFee)'
]);

// Native minimum and RPC estimate come from the exact transaction/state. There
// is no fixed million-gas ceiling or transaction-amount cap. A larger estimate
// never silently increases a signed quote or available relayer exposure.
export function executionLimit({nativeMinimum,rpcEstimate,blockGasLimit}){
 const native=BigInt(nativeMinimum),rpc=BigInt(rpcEstimate),block=BigInt(blockGasLimit);
 assert(native>0n&&rpc>0n&&block>0n);
 const limit=native>rpc?native:rpc;
 assert(limit<=block,'Transaction exceeds the current block gas limit');
 return String(limit);
}
export function reserveFee({gasLimit,gasPrice,relayerBalance,remainingBudget,safetyMargin}){
 const gas=BigInt(gasLimit),price=BigInt(gasPrice),balance=BigInt(relayerBalance),budget=BigInt(remainingBudget),margin=BigInt(safetyMargin);
 assert(gas>0n&&price>0n&&margin>=0n&&budget>=0n&&balance>=0n);
 const reserve=gas*price;
 // Do not count expected reimbursement as money already available to the
 // relayer. A revert pays no reimbursement and must still fit this reserve.
 assert(reserve<=budget,'Remaining authorized budget is insufficient');
 assert(reserve+margin<=balance,'Relayer balance is insufficient');
 return String(reserve);
}
export function createFeeTransaction({operation,auth,keyId,relayerNonce,gasLimit,accessList,preflightGas,walletQuai,tokenBalance}){
 assert.equal(feeDigest(operation),operation.digest);
 const gasPrice=operation.quote.gasPrice;
 validateFeeExecution(operation,{estimatedGas:preflightGas,gasLimit,gasPrice,walletQuai,tokenBalance});
 assert(BigInt(relayerNonce)>=0n&&BigInt(relayerNonce)<=BigInt(Number.MAX_SAFE_INTEGER));
 const tx={type:0,chainId:9,from:operation.quote.relayer,to:operation.wallet,nonce:String(relayerNonce),value:'0',gasPrice:String(gasPrice),gasLimit:String(gasLimit),data:feeWalletABI.encodeFunctionData('sendQuoted',[operation.quote,operation.deadline,keyId,auth]),accessList:feeAccessList(accessList)};
 return {transaction:tx,commitment:fingerprint(boundFeeTransaction(tx))};
}
export function verifyFrozenFeeTransaction(plan,transaction){
 assert.equal(fingerprint(boundFeeTransaction(plan.transaction)),plan.commitment,'Stored transaction changed');
 assert.equal(fingerprint(boundFeeTransaction(transaction)),plan.commitment,'Frozen transaction changed');
}
