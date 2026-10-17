import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,AbiCoder} from 'quais';
import {factoryABI} from '../wallet/chain.mjs';
import {checkpointFactoryContext} from '../wallet/factory-checkpoint.mjs';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),q=n=>'0x'+BigInt(n).toString(16);
const infra={generation:3,factory:'0x0000000000000000000000000000000000000005',factoryTransaction:h(90),factoryHash:keccak256('0x1234'),implementation:'0x0000000000000000000000000000000000000006',implementationHash:h(91)};
function fixture(height,{events=[{height:10,key:h(1),wallet:'0x0000000000000000000000000000000000000007'}],db=null}={}){
 const store=new Map();let logReads=0,blockReads=0,mode='',calls=0;
 db??={prepare:sql=>({get:async id=>store.has(id)?{checkpoint:store.get(id)}:undefined,run:async(id,value)=>store.set(id,value)}),transaction:fn=>fn(),lock:async()=>{}};
 const block=n=>({hash:h(n),woHeader:{hash:h(n),parentHash:h(n-1),number:q(n),timestamp:q(n+100),location:'0x0000'},header:{gasLimit:q(10000000),quaiStateSize:'0x1'}});
 const rpc=async(method,args)=>{
  if(method==='quai_getTransactionReceipt')return {status:'0x1',contractAddress:infra.factory,blockNumber:'0x1',blockHash:h(1)};
  if(method==='quai_getCode')return mode==='runtime'?'0x00':'0x1234';
  if(method==='quai_getTransactionCount')return q(1+events.filter(e=>BigInt(e.height)<=BigInt(args[1])).length);
  if(method==='quai_getBlockByNumber'){blockReads++;const n=Number(BigInt(args[0]));const b=block(n);if(mode==='reorg'&&n===height&&++calls>1){b.hash=h(n+999);b.woHeader.hash=b.hash;}return b;}
  if(method==='quai_getLogs'){
   logReads++;const a=BigInt(args[0].fromBlock),b=BigInt(args[0].toBlock);assert(b-a<1024n);
   const logs=events.filter(e=>BigInt(e.height)>=a&&BigInt(e.height)<=b).map(e=>({...factoryABI.encodeEventLog(factoryABI.getEvent('WalletCreated'),[e.key,e.wallet,h(99)]),address:infra.factory,blockNumber:q(e.height),blockHash:h(e.height),removed:false}));
   if(mode==='missing')return [];if(mode==='partial')return logs.slice(1);if(mode==='log-reorg')logs[0].blockHash=h(99999);if(mode==='duplicate')logs.push(logs[0]);return logs;
  }
  if(method==='quai_call'){const key=factoryABI.decodeFunctionData('walletOf',args[0].data)[0];return factoryABI.encodeFunctionResult('walletOf',[mode==='mapping'?infra.factory:events.find(e=>e.key===key).wallet]);}
  throw Error(method);
 };
 return {rpc,db,store,block:()=>block(height),set:v=>{mode=v;},get logs(){return logReads;},get blocks(){return blockReads;}};
}
for(const height of [60000,80000,900000])test('Complete factory history at '+height+' blocks',async()=>{
 const f=fixture(height),keys=await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);
 assert.deepEqual(keys,[keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[h(1),0]))]);
 assert.equal(f.logs,1);assert(f.blocks<200,'Sparse old history must not scan every block');
});
test('Millions of blocks catch up in bounded persisted passes without activation',async()=>{
 const f=fixture(3000000);let passes=0,keys;
 while(!keys){try{keys=await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);}catch(e){assert.match(e.message,/catch-up pending/);}assert(++passes<=4);}
 assert.equal(keys.length,1);assert.equal(passes,3);assert.equal(f.logs,1);
});
for(const mode of ['missing','partial','duplicate','log-reorg','mapping','runtime','reorg'])test('Fail closed on '+mode,async()=>{
 const f=fixture(80000);f.set(mode);await assert.rejects(checkpointFactoryContext(f.rpc,f.block(),infra,f.db));
 if(mode==='reorg'){for(const value of f.store.values())assert(BigInt(JSON.parse(value).block.woHeader.number)<80000n,'Never checkpoint the inconsistent target');}
 else assert.equal(f.store.size,0);
});
test('Cold restart loads durable checkpoint without historical log replay',async()=>{
 const f=fixture(80000);const a=await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);
 const restarted=fixture(80010,{db:f.db});assert.deepEqual(await checkpointFactoryContext(restarted.rpc,restarted.block(),infra,restarted.db),a);assert.equal(restarted.logs,0);
});
test('Reorg of persisted checkpoint stops instead of discarding history',async()=>{
 const f=fixture(80000);await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);
 const restarted=fixture(80010,{db:f.db}),rpc=async(m,a)=>{const r=await restarted.rpc(m,a);if(m==='quai_getBlockByNumber'&&BigInt(a[0])===80000n){r.hash=h(88);r.woHeader.hash=r.hash;}return r;};
 await assert.rejects(checkpointFactoryContext(rpc,restarted.block(),infra,f.db),/noncanonical snapshot/);
});
test('Missing checkpoint entry is rejected by factory nonce',async()=>{
 const f=fixture(80000);await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);
 for(const [id,value]of f.store){const cp=JSON.parse(value);cp.entries=[];f.store.set(id,JSON.stringify(cp));}
 await assert.rejects(checkpointFactoryContext(f.rpc,f.block(),infra,f.db),/Incomplete factory checkpoint/);
});
test('Same-height cached mapping is verified again',async()=>{
 const f=fixture(80000);await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);f.set('mapping');
 await assert.rejects(checkpointFactoryContext(f.rpc,f.block(),infra,f.db),/Factory mapping mismatch/);
});
