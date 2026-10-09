// Production adaptation of clones/native-preflight.mjs. No signer or broadcast.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {AbiCoder,toBeHex,keccak256} from 'quais';
import {WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {canonicalACL} from './transaction-policy.mjs';
import {captureAccounts,assertCanonicalBlock} from './head-guard.mjs';
const exec=promisify(execFile),q=n=>'0x'+BigInt(n).toString(16),abi=AbiCoder.defaultAbiCoder();
export function rpcTransaction(tx){return {from:tx.from,to:tx.to,nonce:q(tx.nonce),value:'0x0',data:tx.data,gas:q(tx.gasLimit),gasPrice:q(tx.gasPrice),...(tx.accessList?{accessList:tx.accessList}:{})};}
export function createNativePreflight({binary,binaryHash}){
 assert(binary&&/^[0-9a-f]{64}$/i.test(binaryHash),'Pinned native verifier required');
 return async(rpc,tx,row,block)=>{
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),binaryHash,'Native verifier changed');
  const addresses=new Map(canonicalACL(tx.accessList).map(a=>[a.address,a.storageKeys]));
  const add=(a,keys)=>addresses.set(a.toLowerCase(),[...new Set([...(addresses.get(a.toLowerCase())||[]),...keys])].sort());
  add(tx.from,[]);add(tx.to,[]);add(infra.implementation,[toBeHex(0,32)]);
  if(tx.to.toLowerCase()===infra.factory.toLowerCase()){
   assert(Array.isArray(row.factoryStorageKeys),'Complete factory storage context required');
   add(infra.factory,row.factoryStorageKeys);
  }
  const base=BigInt(keccak256(abi.encode(['bytes32','uint256'],[row.plan.keyId,1])));
  // Full committed one-key clone storage, including untouched nonzero slots.
  // Multiple/revoked keys are rejected by the executor until the context expands.
  add(row.plan.address,[...Array.from({length:6},(_,i)=>toBeHex(i,32)),keccak256(toBeHex(5,32)),...Array.from({length:3},(_,i)=>toBeHex(base+BigInt(i),32))]);
  const entries=[...addresses].map(([address,storageKeys])=>({address,storageKeys})).sort((a,b)=>a.address.localeCompare(b.address));
  const accounts=await captureAccounts(rpc,entries,block);
  const input={Single:true,FinalizeSnapshot:true,Sender:tx.from,Block:block.woHeader.number,Time:block.woHeader.timestamp,StateSize:block.header.quaiStateSize,Price:q(tx.gasPrice),StartNonce:Number(tx.nonce),Accounts:accounts,AccessList:tx.accessList,Txs:[{Name:'native-send',To:tx.to,Data:tx.data,Value:'0x0',Nonce:Number(tx.nonce),Gas:Number(tx.gasLimit)}]};
  const dir=await mkdtemp(join(tmpdir(),'ns-wallet-preflight-'));
  try{
   const source=join(dir,'input.json'),output=join(dir,'output.json');await writeFile(source,JSON.stringify(input),{mode:0o600});
   await exec(binary,[source,output],{windowsHide:true,timeout:30000,maxBuffer:1048576});const result=JSON.parse(await readFile(output,'utf8'));
   assert.equal(result.snapshotCommitted,true);assert(!result.outcome.error,'Native execution failed');assert.deepEqual(canonicalACL(result.discoveredAccessList),canonicalACL(tx.accessList));
   const acl=await rpc('quai_createAccessList',[rpcTransaction(tx),block.woHeader.number]);assert(!acl.error);assert.deepEqual(canonicalACL(acl.accessList),canonicalACL(tx.accessList));assert.equal(BigInt(acl.gasUsed),BigInt(result.outcome.gas));
   const estimate=BigInt(await rpc('quai_estimateGas',[rpcTransaction(tx),block.woHeader.number]));
   assert(estimate>0n&&estimate<=BigInt(tx.gasLimit)&&BigInt(result.estimate)<=BigInt(tx.gasLimit)&&BigInt(result.outcome.gas)>0n&&BigInt(result.outcome.gas)<=BigInt(tx.gasLimit));await assertCanonicalBlock(rpc,block);
   return {accounts,block,gasUsed:String(result.outcome.gas),estimate:String(estimate),returnValue:result.outcome.return,accessList:canonicalACL(tx.accessList)};
  }finally{const relativePath=relative(resolve(tmpdir()),resolve(dir));assert(!isAbsolute(relativePath)&&!relativePath.startsWith('..')&&relativePath.startsWith('ns-wallet-preflight-'));await rm(dir,{recursive:true,force:true});}
 };
}
