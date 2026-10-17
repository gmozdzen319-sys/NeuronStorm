import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,AbiCoder} from 'quais';
import {factoryABI} from '../wallet/chain.mjs';
import {checkpointFactoryContext} from '../wallet/factory-checkpoint.mjs';
import {createApp} from './database.mjs';
const h=n=>'0x'+BigInt(n).toString(16).padStart(64,'0'),q=n=>'0x'+BigInt(n).toString(16);
const infra={generation:3,factory:'0x0000000000000000000000000000000000000005',factoryTransaction:h(90),factoryHash:keccak256('0x1234'),implementation:'0x0000000000000000000000000000000000000006',implementationHash:h(91)};
function fixture(height,{events=[{height:10,key:h(1),wallet:'0x0000000000000000000000000000000000000007'}],db=null}={}){
 const store=new Map(),candidates=new Map(),history=[];let logReads=0,blockReads=0,mode='',calls=0;
 db??={prepare:sql=>({get:async id=>sql.includes('passkey_factory_rebuilds')?candidates.get(id):store.has(id)?{checkpoint:store.get(id)}:undefined,run:async(id,value,third)=>{
  if(sql.startsWith('DELETE FROM passkey_factory_rebuilds'))return candidates.delete(id);
  if(sql.startsWith('INSERT INTO passkey_factory_rebuilds'))return candidates.set(id,{source_checkpoint:value,checkpoint:third});
  if(sql.startsWith('INSERT INTO passkey_factory_checkpoint_history'))return history.push({id,checkpoint:value,replacement_hash:third});
  store.set(id,value);
 }}),transaction:async fn=>{const a=new Map(store),b=new Map(candidates),n=history.length;try{return await fn();}catch(e){store.clear();for(const x of a)store.set(...x);candidates.clear();for(const x of b)candidates.set(...x);history.length=n;throw e;}},lock:async()=>{}};
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
 return {rpc,db,store,candidates,history,block:()=>block(height),set:v=>{mode=v;},get logs(){return logReads;},get blocks(){return blockReads;}};
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
test('Shallow orphaned checkpoint is rebuilt from deployment and archived, never trusted',async()=>{
 const f=fixture(80000);await checkpointFactoryContext(f.rpc,f.block(),infra,f.db);
 const restarted=fixture(80010,{db:f.db}),rpc=async(m,a)=>{const r=await restarted.rpc(m,a);if(m==='quai_getBlockByNumber'&&BigInt(a[0])===80000n){r.hash=h(88);r.woHeader.hash=r.hash;}return r;};
 const before=[...f.store.values()][0];
 assert.equal((await checkpointFactoryContext(rpc,restarted.block(),infra,f.db)).length,1);
 assert.equal(f.history.length,1);assert.equal(f.history[0].checkpoint,before);assert.equal(restarted.logs,1);
 assert.equal(JSON.parse([...f.store.values()][0]).block.hash,h(80010));
 assert.equal(f.candidates.size,0);
});

function fork(f,orphanHeight){return async(m,a)=>{const r=await f.rpc(m,a);if(m==='quai_getBlockByNumber'&&BigInt(a[0])===BigInt(orphanHeight)){r.hash=h(99999999);r.woHeader.hash=r.hash;}return r;};}
for(const mode of ['missing','partial','mapping','runtime','reorg','duplicate'])test('Failed orphan rebuild preserves original evidence: '+mode,async()=>{
 const old=fixture(80000);await checkpointFactoryContext(old.rpc,old.block(),infra,old.db);const before=[...old.store];
 const fresh=fixture(200000,{db:old.db});fresh.set(mode);
 await assert.rejects(checkpointFactoryContext(fork(fresh,80000),fresh.block(),infra,old.db));
 assert.deepEqual([...old.store],before);assert.equal(old.history.length,0);
});
test('Deep reorg/restart reconstructs changed event set, does not retain orphan mappings',async()=>{
 const old=fixture(80000);await checkpointFactoryContext(old.rpc,old.block(),infra,old.db);
 const events=[{height:70000,key:h(2),wallet:'0x0000000000000000000000000000000000000008'}];
 const fresh=fixture(900000,{db:old.db,events}),keys=await checkpointFactoryContext(fork(fresh,80000),fresh.block(),infra,old.db);
 assert.deepEqual(keys,[keccak256(AbiCoder.defaultAbiCoder().encode(['bytes32','uint256'],[h(2),0]))]);
 assert.equal(fresh.logs,1);assert(fresh.blocks<200);
 const again=fixture(900010,{db:old.db,events});assert.deepEqual(await checkpointFactoryContext(again.rpc,again.block(),infra,old.db),keys);assert.equal(again.logs,0);
});
test('Nonce/event mismatch during rebuild cannot promote',async()=>{
 const old=fixture(80000);await checkpointFactoryContext(old.rpc,old.block(),infra,old.db);const before=[...old.store];
 const fresh=fixture(80010,{db:old.db}),base=fork(fresh,80000),rpc=async(m,a)=>m==='quai_getTransactionCount'?q(BigInt(await base(m,a))+1n):base(m,a);
 await assert.rejects(checkpointFactoryContext(rpc,fresh.block(),infra,old.db));assert.deepEqual([...old.store],before);assert.equal(old.history.length,0);
});
test('Millions of blocks rebuild in bounded restartable staging, not active checkpoints',async()=>{
 const old=fixture(80000);await checkpointFactoryContext(old.rpc,old.block(),infra,old.db);const before=[...old.store];
 let keys,passes=0;
 while(!keys){const fresh=fixture(3000000,{db:old.db});try{keys=await checkpointFactoryContext(fork(fresh,80000),fresh.block(),infra,old.db);}catch(e){assert.match(e.message,/catch-up pending/);assert.deepEqual([...old.store],before);assert.equal(old.history.length,0);}assert(++passes<=4);}
 assert.equal(passes,3);assert.equal(old.history.length,1);assert.equal(old.candidates.size,0);
});
test('PostgreSQL verified rebuild is atomic and reusable after restart',async t=>{
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db;
 const old=fixture(80000,{db});await checkpointFactoryContext(old.rpc,old.block(),infra,db);
 const before=await db.prepare('SELECT * FROM passkey_factory_checkpoints').get();
 const bad=fixture(80010,{db});bad.set('missing');await assert.rejects(checkpointFactoryContext(fork(bad,80000),bad.block(),infra,db));
 assert.deepEqual(await db.prepare('SELECT * FROM passkey_factory_checkpoints').get(),before);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM passkey_factory_checkpoint_history').get()).n,0);
 const failCommit={...db,prepare:sql=>sql.startsWith('UPDATE passkey_factory_checkpoints SET checkpoint=')?{run:async()=>{throw Error('test promotion failure');}}:db.prepare(sql)};
 const interrupted=fixture(80010,{db:failCommit});await assert.rejects(checkpointFactoryContext(fork(interrupted,80000),interrupted.block(),infra,failCommit),/test promotion failure/);
 assert.deepEqual(await db.prepare('SELECT * FROM passkey_factory_checkpoints').get(),before);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM passkey_factory_checkpoint_history').get()).n,0);
 const fresh=fixture(80010,{db});const keys=await checkpointFactoryContext(fork(fresh,80000),fresh.block(),infra,db);assert.equal(keys.length,1);
 assert.equal((await db.prepare('SELECT checkpoint FROM passkey_factory_checkpoint_history').get()).checkpoint,before.checkpoint);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM passkey_factory_rebuilds').get()).n,0);
 const restarted=fixture(80020,{db});assert.deepEqual(await checkpointFactoryContext(restarted.rpc,restarted.block(),infra,db),keys);assert.equal(restarted.logs,0);
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
