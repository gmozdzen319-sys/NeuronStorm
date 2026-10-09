import assert from 'node:assert/strict';
const hex=x=>'0x'+BigInt(x).toString(16),hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x);
export const MAX_ADVANCE=32n,MAX_TIME_ADVANCE=120n;
export function validateBlock(b){
 assert(b&&hash(b.hash)&&b.woHeader&&b.header,'incomplete canonical block');
 assert.equal(b.woHeader.hash,b.hash,'inconsistent header hash');assert(hash(b.woHeader.parentHash),'missing zone parent');assert.equal(b.woHeader.location,'0x0000','wrong shard');
 for(const x of [b.woHeader.number,b.woHeader.timestamp,b.header.quaiStateSize,b.header.gasLimit])assert(typeof x==='string'&&/^0x[0-9a-f]+$/i.test(x),'missing block context');return b;
}
export async function assertCanonicalBlock(rpc,block){
 validateBlock(block);const requestedAt=new Date().toISOString();const current=validateBlock(await rpc('quai_getBlockByNumber',[block.woHeader.number,false]));
 try{assert.equal(BigInt(current.woHeader.number),BigInt(block.woHeader.number),'RPC returned wrong pinned height');assert.equal(current.hash,block.hash,'noncanonical snapshot/reorg');assert.deepEqual(current.woHeader,block.woHeader,'inconsistent header data');assert.deepEqual(current.header,block.header,'inconsistent block context');}
 catch(e){e.canonicalityEvidence={requestedAt,receivedAt:new Date().toISOString(),requestedHeight:block.woHeader.number,expected:block,observed:current};throw e;}
 return current;
}
export async function assertCanonicalAdvance(rpc,from,to){
 validateBlock(from);validateBlock(to);const a=BigInt(from.woHeader.number),b=BigInt(to.woHeader.number),dt=BigInt(to.woHeader.timestamp)-BigInt(from.woHeader.timestamp);
 assert(b>=a&&b-a<=MAX_ADVANCE,'stale or backwards head');assert(dt>=0n&&dt<=MAX_TIME_ADVANCE,'stale block timestamp');
 await assertCanonicalBlock(rpc,from);await assertCanonicalBlock(rpc,to);
 let parent=from;for(let n=a+1n;n<=b;n++){const child=n===b?to:validateBlock(await rpc('quai_getBlockByNumber',[hex(n),false]));assert.equal(BigInt(child.woHeader.number),n,'RPC returned wrong height');assert.equal(child.woHeader.parentHash,parent.hash,'broken canonical ancestry');assert(BigInt(child.woHeader.timestamp)>=BigInt(parent.woHeader.timestamp),'timestamp regression');parent=child;}
 // Re-check both endpoints after the bounded ancestry read, not a retry loop.
 await assertCanonicalBlock(rpc,from);await assertCanonicalBlock(rpc,to);return {from:from.hash,to:to.hash,blocks:Number(b-a)};
}
export async function captureAccounts(rpc,entries,block){
 await assertCanonicalBlock(rpc,block);const tag=block.woHeader.number;
 const accounts=await Promise.all(entries.map(async({address,storageKeys})=>{
  const [Balance,n,Code,values]=await Promise.all([rpc('quai_getBalance',[address,tag]),rpc('quai_getTransactionCount',[address,tag]),rpc('quai_getCode',[address,tag]),Promise.all(storageKeys.map(k=>rpc('quai_getStorageAt',[address,k,tag])))]);
  assert(typeof Code==='string'&&/^0x(?:[0-9a-f]{2})*$/i.test(Code),'invalid code response');assert(BigInt(n)<=BigInt(Number.MAX_SAFE_INTEGER));
  const Storage={};storageKeys.forEach((k,i)=>{assert(hash(values[i]),'invalid storage response');Storage[k]=values[i].toLowerCase();});
  return {Address:address.toLowerCase(),Balance:hex(Balance),Nonce:Number(BigInt(n)),Code:Code.toLowerCase(),Storage};
 }));await assertCanonicalBlock(rpc,block);return accounts;
}
export function accountEntries(accounts){return accounts.map(a=>({address:a.Address,storageKeys:Object.keys(a.Storage).sort()}));}
export function assertSameAccounts(before,after){assert.deepEqual(after,before,'relevant account code/storage/nonce/balance changed');}
export function assertContextCompatible(before,after,tx,op){
 // Quai state-size affects gas pricing. A changed value requires new approval,
 // not silent reuse of an older gas simulation. Unrelated head hashes may advance.
 assert.equal(BigInt(after.header.quaiStateSize),BigInt(before.header.quaiStateSize),'gas-relevant Quai state size changed');
 assert(BigInt(after.header.gasLimit)>=BigInt(tx.gasLimit),'block gas limit below frozen plan');
 if(op.deadline!==undefined)assert(BigInt(after.woHeader.timestamp)+30n<=BigInt(op.deadline),'passkey deadline too close or expired');
}
