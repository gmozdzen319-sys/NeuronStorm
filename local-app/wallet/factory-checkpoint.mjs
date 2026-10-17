import assert from 'node:assert/strict';
import {AbiCoder,keccak256} from 'quais';
import {factoryABI} from './chain.mjs';
import {validateBlock,assertCanonicalBlock,assertCanonicalAdvance,MAX_ADVANCE,MAX_TIME_ADVANCE} from './head-guard.mjs';
const abi=AbiCoder.defaultAbiCoder(),hex=n=>'0x'+BigInt(n).toString(16),low=s=>s.toLowerCase();
const lanes=new WeakMap();
// Only the pinned immutable v3 factory: initial nonce 1, exactly one CREATE2
// and one event per successful call. A reverted call rolls both back. No other
// factory method creates contracts, delegates execution or changes the mapping.
export function checkpointFactoryContext(rpc,block,infra,db){
 const prior=lanes.get(rpc)??Promise.resolve();
 const work=prior.then(()=>read(rpc,block,infra,db));lanes.set(rpc,work.catch(()=>{}));return work;
}
async function read(rpc,target,infra,db){
 assert.equal(infra.generation,3);validateBlock(target);
 const identity=JSON.stringify([9,infra.factory,infra.factoryTransaction,infra.factoryHash,infra.implementation,infra.implementationHash]);
 const receipt=await rpc('quai_getTransactionReceipt',[infra.factoryTransaction]);
 assert(receipt&&BigInt(receipt.status)===1n&&low(receipt.contractAddress)===low(infra.factory));
 const first=BigInt(receipt.blockNumber),last=BigInt(target.woHeader.number);assert(last>=first);
 const anchor=validateBlock(await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]));assert.equal(anchor.hash,receipt.blockHash);
 assert.equal(keccak256(await rpc('quai_getCode',[infra.factory,target.woHeader.number])),infra.factoryHash,'Factory runtime mismatch');
 const readCount=async block=>{
  const nonce=BigInt(await rpc('quai_getTransactionCount',[infra.factory,block.woHeader.number]));
  assert(nonce>=1n,'Invalid factory creation nonce');return nonce-1n;
 };
 const wanted=await readCount(target),entries=new Map();let previous=0n,start=first,checkpointBlock=null;
 const saved=db?await db.prepare('SELECT checkpoint FROM passkey_factory_checkpoints WHERE identity=$1').get(identity):null;
 if(saved){
  const cp=JSON.parse(saved.checkpoint);assert.equal(cp.version,1);validateBlock(cp.block);
  await assertCanonicalBlock(rpc,cp.block); // Never silently discard a forked checkpoint.
  assert(BigInt(cp.block.woHeader.number)>=first);
  assert(Array.isArray(cp.entries));
  for(const [key,wallet] of cp.entries){assert(/^0x[0-9a-f]{64}$/.test(key)&&/^0x[0-9a-f]{40}$/.test(wallet)&&!entries.has(key));entries.set(key,wallet);}
  assert.equal(BigInt(entries.size),await readCount(cp.block),'Incomplete factory checkpoint');
  if(BigInt(cp.block.woHeader.number)>last)throw Error('Factory checkpoint newer than requested snapshot');
  previous=BigInt(entries.size);start=BigInt(cp.block.woHeader.number)+1n;checkpointBlock=cp.block;
  const gap=last-BigInt(cp.block.woHeader.number),dt=BigInt(target.woHeader.timestamp)-BigInt(cp.block.woHeader.timestamp);
  if(gap<=MAX_ADVANCE&&dt>=0n&&dt<=MAX_TIME_ADVANCE)await assertCanonicalAdvance(rpc,cp.block,target);
 }
 assert(wanted>=previous,'Factory nonce regressed');
 async function verifyMappings(block){
  for(const [key,wallet] of entries){
   const assigned=factoryABI.decodeFunctionResult('walletOf',await rpc('quai_call',[{to:infra.factory,data:factoryABI.encodeFunctionData('walletOf',[key])},block.woHeader.number]))[0];
   assert.equal(low(assigned),wallet,'Factory mapping mismatch');
  }
 }
 if(start>last)await verifyMappings(target);
 const topic=factoryABI.getEvent('WalletCreated').topicHash;
 let requests=0;
 async function scan(from,to,before,after,endBlock){
  assert(after>=before,'Factory nonce regressed');
  if(after===before)return; // Proven no successful CREATE2 in this interval.
  assert(++requests<=4096,'Factory checkpoint catch-up work budget exceeded');
  if(to-from>=1024n){
   const mid=(from+to)/2n,b=validateBlock(await rpc('quai_getBlockByNumber',[hex(mid),false]));
   assert.equal(BigInt(b.woHeader.number),mid);const count=await readCount(b);assert(count>=before&&count<=after);
   await scan(from,mid,before,count,b);await scan(mid+1n,to,count,after,endBlock);await assertCanonicalBlock(rpc,b);return;
  }
  const logs=await rpc('quai_getLogs',[{address:infra.factory,fromBlock:hex(from),toBlock:hex(to),topics:[topic]}]);
  assert(Array.isArray(logs)&&logs.length<10000&&BigInt(logs.length)===after-before,'Incomplete factory log range');
  for(const log of logs){
   assert(!log.removed&&low(log.address)===low(infra.factory)&&BigInt(log.blockNumber)>=from&&BigInt(log.blockNumber)<=to);
   const b=validateBlock(await rpc('quai_getBlockByNumber',[log.blockNumber,false]));assert.equal(b.hash,log.blockHash);
   const event=factoryABI.parseLog(log),key=low(event.args.keyId),wallet=low(event.args.wallet);
   assert(!entries.has(key),'Duplicate factory event');entries.set(key,wallet);
   await assertCanonicalBlock(rpc,b);
  }
  await assertCanonicalBlock(rpc,endBlock);
 }
 // Checkpoint each bounded window. No lifetime history cap; interrupted cold
 // start resumes from the last fully verified window on the next read.
 let windows=0;
 for(let from=start;from<=last;from+=65536n){
  assert(++windows<=16,'Factory checkpoint catch-up pending');
  const to=from+65535n>last?last:from+65535n;
  const end=to===last?target:validateBlock(await rpc('quai_getBlockByNumber',[hex(to),false]));
  assert.equal(BigInt(end.woHeader.number),to);const count=to===last?wanted:await readCount(end);
  await scan(from,to,previous,count,end);assert.equal(BigInt(entries.size),count,'Incomplete factory history');
  // Validate all persisted mappings, including those loaded after a restart.
  await verifyMappings(end);
  if(checkpointBlock)await assertCanonicalBlock(rpc,checkpointBlock);
  await assertCanonicalBlock(rpc,anchor);await assertCanonicalBlock(rpc,end);await assertCanonicalBlock(rpc,target);
  if(db)await db.transaction(async()=>{
   await db.lock('factory-checkpoint:'+identity);
   const current=await db.prepare('SELECT checkpoint FROM passkey_factory_checkpoints WHERE identity=$1').get(identity);
   if(current){const c=JSON.parse(current.checkpoint);await assertCanonicalBlock(rpc,c.block);if(BigInt(c.block.woHeader.number)>to)return;assert(BigInt(c.block.woHeader.number)!==to||c.block.hash===end.hash);}
   await db.prepare('INSERT INTO passkey_factory_checkpoints(identity,checkpoint) VALUES($1,$2) ON CONFLICT(identity) DO UPDATE SET checkpoint=excluded.checkpoint').run(identity,JSON.stringify({version:1,block:end,entries:[...entries]}));
  });
  checkpointBlock=end;previous=count;
 }
 assert.equal(BigInt(entries.size),wanted);await assertCanonicalBlock(rpc,anchor);await assertCanonicalBlock(rpc,target);
 return [...entries.keys()].map(key=>keccak256(abi.encode(['bytes32','uint256'],[key,0]))).sort();
}
