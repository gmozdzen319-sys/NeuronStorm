// Exact execution on pinned RPC state using the reviewed go-quai binary.
// Quai ToMessage-based simulation RPCs zero GASPRICE and cannot verify sendQuoted.
// This path never treats an RPC revert as success: all success must come from
// native Debug=false execution of unchanged bytecode, assertion and transaction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AbiCoder,keccak256,toBeHex} from 'quais';
import {feeWalletABI,feeAccessList,boundFeeTransaction} from './fee-plan.mjs';
import {captureAccounts,assertCanonicalBlock,assertSameAccounts,accountEntries,validateBlock} from './head-guard.mjs';
const exec=promisify(execFile),abi=AbiCoder.defaultAbiCoder();

export function createFeeSendPreflight({binary,binaryHash,infrastructure}){
 assert(binary&&/^[0-9a-f]{64}$/i.test(binaryHash));
 const infra=Object.freeze({...infrastructure});assert.equal(infra.generation,3);
 return async(rpc,tx,row,block)=>{
  const original=JSON.stringify(tx);validateBlock(block);
  assert.equal(BigInt(await rpc('quai_chainId',[])),9n);
  assert.equal(BigInt(tx.chainId),9n);assert.equal(BigInt(tx.type),0n);assert.equal(BigInt(tx.value),0n);
  assert.equal(tx.to.toLowerCase(),row.plan.address.toLowerCase());assert.equal(row.generation,3);
  assert.equal(row.plan.implementation,infra.implementation);assert.equal(row.plan.factory,infra.factory);
  assert(BigInt(tx.gasPrice)>0n&&BigInt(tx.gasLimit)>0n&&BigInt(tx.gasLimit)<=BigInt(block.header.gasLimit));
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),binaryHash,'Verifier changed');
  const decoded=feeWalletABI.decodeFunctionData('sendQuoted',tx.data),quote=decoded[0];
  assert.equal(feeWalletABI.encodeFunctionData('sendQuoted',decoded).toLowerCase(),tx.data.toLowerCase(),'Noncanonical send calldata');
  assert.equal(quote.relayer.toLowerCase(),tx.from.toLowerCase());assert.equal(quote.gasPrice,BigInt(tx.gasPrice));
  assert.equal(decoded[2].toLowerCase(),row.plan.keyId.toLowerCase());
  assert(BigInt(block.woHeader.timestamp)<=decoded[1],'Expired operation');
  const fixed=tx.accessList!==undefined;let acl=fixed?feeAccessList(tx.accessList):[];
  const entries=new Map();
  function add(a,keys=[]){a=a.toLowerCase();const prior=entries.get(a)||new Set();for(const k of keys)prior.add(k.toLowerCase());entries.set(a,prior);}
  add(tx.from);add(tx.to);add(quote.recipient);add(quote.relayer);if(BigInt(quote.token)!==0n)add(quote.token);
  add(infra.implementation,[toBeHex(0,32)]);
  const base=BigInt(keccak256(abi.encode(['bytes32','uint256'],[row.plan.keyId,1])));
  add(tx.to,[...Array.from({length:6},(_,i)=>toBeHex(i,32)),keccak256(toBeHex(5,32)),...Array.from({length:3},(_,i)=>toBeHex(base+BigInt(i),32))]);
  const dir=await mkdtemp(join(tmpdir(),'ns-fee-exact-'));
  try{
   for(let attempt=0;attempt<6;attempt++){
    for(const item of acl)add(item.address,item.storageKeys);
    assert(entries.size<=128&&[...entries.values()].reduce((n,s)=>n+s.size,0)<=2048,'Execution context too large');
    const accounts=await captureAccounts(rpc,[...entries].map(([address,keys])=>({address,storageKeys:[...keys].sort()})).sort((a,b)=>a.address.localeCompare(b.address)),block);
    const wallet=accounts.find(a=>a.Address===tx.to.toLowerCase()),logic=accounts.find(a=>a.Address===infra.implementation.toLowerCase()),sender=accounts.find(a=>a.Address===tx.from.toLowerCase());
    assert.equal(keccak256(wallet.Code),row.plan.runtimeHash);assert.equal(keccak256(logic.Code),infra.implementationHash);
    assert.equal(wallet.Storage[toBeHex(base,32)],row.plan.x.toLowerCase());assert.equal(wallet.Storage[toBeHex(base+1n,32)],row.plan.y.toLowerCase());
    assert.equal(BigInt(sender.Nonce),BigInt(tx.nonce));assert(BigInt(sender.Balance)>=BigInt(tx.gasLimit)*BigInt(tx.gasPrice));
    const input={Single:true,FinalizeSnapshot:true,Sender:tx.from,Block:block.woHeader.number,Time:block.woHeader.timestamp,StateSize:block.header.quaiStateSize,Price:toBeHex(BigInt(tx.gasPrice)),StartNonce:Number(tx.nonce),Accounts:accounts,AccessList:acl,Txs:[{Name:'exact-fee-send',To:tx.to,Data:tx.data,Value:'0x0',Nonce:Number(tx.nonce),Gas:Number(tx.gasLimit)}]};
    await writeFile(join(dir,'input.json'),JSON.stringify(input),{mode:0o600});
    await exec(binary,[join(dir,'input.json'),join(dir,'output.json')],{windowsHide:true,timeout:30000,maxBuffer:1048576});
    const result=JSON.parse(await readFile(join(dir,'output.json'),'utf8'));assert.equal(result.snapshotCommitted,true);
    const discovered=feeAccessList(result.discoveredAccessList);
    if(JSON.stringify(discovered)!==JSON.stringify(acl)){
     assert(!fixed,'Frozen access list changed');acl=discovered;continue;
    }
    assert(!result.outcome.error,'Exact native execution failed');
    assert(BigInt(result.outcome.gas)>0n&&BigInt(result.outcome.gas)<=BigInt(tx.gasLimit));
    assert(BigInt(result.minimumGas)>0n&&BigInt(result.minimumGas)<=BigInt(tx.gasLimit));
    assert.equal(result.outcome.return,'0x','Unexpected send return');
    // Re-read every observed address/slot at the same canonical block. Never
    // accept partial/moving state or a result from a mutated transaction.
    assertSameAccounts(accounts,await captureAccounts(rpc,accountEntries(accounts),block));
    await assertCanonicalBlock(rpc,block);assert.equal(JSON.stringify(tx),original,'Transaction mutated');
    boundFeeTransaction({...tx,accessList:acl});
    return {accounts,block,gasUsed:String(result.outcome.gas),estimate:String(result.minimumGas),returnValue:result.outcome.return,accessList:acl,mode:'exact-native-quai'};
   }
   throw Error('Native access-list discovery did not stabilize');
  }finally{
   const path=relative(resolve(tmpdir()),resolve(dir));assert(!isAbsolute(path)&&path.startsWith('ns-fee-exact-')&&!path.startsWith('..'));
   await rm(dir,{recursive:true,force:true});
  }
 };
}
