import assert from 'node:assert/strict';
import {AbiCoder,keccak256} from 'quais';
import {WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {factoryABI} from './chain.mjs';
import {assertCanonicalBlock,validateBlock} from './head-guard.mjs';
const abi=AbiCoder.defaultAbiCoder(),q=n=>'0x'+n.toString(16);
// Bounded reconstruction of this immutable factory's only storage mapping.
// No synthetic factory padding, guessed storage size or silent partial result.
// A long history requires a separately reviewed indexed snapshot, not truncation.
export async function factoryStorageContext(rpc,block){
 const receipt=await rpc('quai_getTransactionReceipt',[infra.factoryTransaction]);assert(receipt&&BigInt(receipt.status)===1n&&receipt.contractAddress.toLowerCase()===infra.factory.toLowerCase());
 const first=BigInt(receipt.blockNumber),last=BigInt(block.woHeader.number);assert(last>=first&&last-first<=65535n,'Factory history exceeds bounded snapshot range');
 const anchor=validateBlock(await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]));assert.equal(anchor.hash,receipt.blockHash);
 const keys=new Set(),topic=factoryABI.getEvent('WalletCreated').topicHash;
 for(let start=first;start<=last;start+=1024n){
  const end=start+1023n>last?last:start+1023n;
  const logs=await rpc('quai_getLogs',[{address:infra.factory,fromBlock:q(start),toBlock:q(end),topics:[topic]}]);assert(Array.isArray(logs)&&logs.length<10000,'Incomplete factory log range');
  for(const log of logs){
   assert(!log.removed&&log.address.toLowerCase()===infra.factory.toLowerCase()&&BigInt(log.blockNumber)>=start&&BigInt(log.blockNumber)<=end);
   const canonical=validateBlock(await rpc('quai_getBlockByNumber',[log.blockNumber,false]));assert.equal(canonical.hash,log.blockHash);
   const event=factoryABI.parseLog(log),keyId=event.args.keyId;assert(!keys.has(keyId),'Duplicate factory event');keys.add(keyId);
   const assigned=factoryABI.decodeFunctionResult('walletOf',await rpc('quai_call',[{to:infra.factory,data:factoryABI.encodeFunctionData('walletOf',[keyId])},block.woHeader.number]))[0];assert.equal(assigned.toLowerCase(),event.args.wallet.toLowerCase());
  }
 }
 await assertCanonicalBlock(rpc,anchor);await assertCanonicalBlock(rpc,block);
 return [...keys].map(key=>keccak256(abi.encode(['bytes32','uint256'],[key,0]))).sort();
}
