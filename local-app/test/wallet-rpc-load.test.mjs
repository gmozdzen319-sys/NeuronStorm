import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletRPC,factoryABI} from '../wallet/chain.mjs';
import {factoryStorageContext} from '../wallet/factory-context.mjs';
import {WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
test('Only explicit getLogs overload gets at most three read attempts, retaining exact parameters',async()=>{
 const calls=[],delays=[],params=[{fromBlock:'0x1',toBlock:'0x2'}];
 const rpc=createWalletRPC(async(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);
  return {ok:true,status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:request.id,...(calls.length<3?{error:{code:-32000,message:'too many concurrent log queries; retry later'}}:{result:[]})})};
 },undefined,{sleep:async ms=>delays.push(ms)});
 assert.deepEqual(await rpc('quai_getLogs',params),[]);assert.equal(calls.length,3);
 assert.deepEqual(delays,[2000,4000]);assert(calls.every(c=>JSON.stringify(c.params)===JSON.stringify(params)));
 await assert.rejects(rpc('quai_sendRawTransaction',['secret']),/Read-only/);assert.equal(calls.length,3);
});
for(const [method,message,total] of [['quai_getLogs','too many concurrent log queries; retry later',3],['quai_getLogs','noncanonical block',1],['quai_call','too many concurrent log queries; retry later',1]])test('RPC fails closed without unbounded retry: '+method+' '+message,async()=>{
 let calls=0;const rpc=createWalletRPC(async(url,options)=>{const r=JSON.parse(options.body);calls++;return {ok:true,status:200,text:async()=>JSON.stringify({jsonrpc:'2.0',id:r.id,error:{code:-32000,message,data:'excluded'}})};},undefined,{sleep:async()=>{}});
 await assert.rejects(rpc(method,[]),e=>e.walletRPC.code===-32000&&!JSON.stringify(e).includes('excluded'));assert.equal(calls,total);
});
test('Concurrent log reads are serialized, not multiplied',async()=>{
 let active=0,max=0;const rpc=createWalletRPC(async(url,options)=>{const r=JSON.parse(options.body);active++;max=Math.max(active,max);await new Promise(resolve=>setTimeout(resolve,5));active--;return {ok:true,text:async()=>JSON.stringify({jsonrpc:'2.0',id:r.id,result:[]})};});
 await Promise.all([rpc('quai_getLogs',[]),rpc('quai_getLogs',[])]);assert.equal(max,1);
});
function historyFixture(events=[]){
 const blocks=n=>({hash:hash(n),woHeader:{hash:hash(n),parentHash:hash(n-1),location:'0x0000',number:'0x'+n.toString(16),timestamp:'0x'+(100+n).toString(16)},header:{quaiStateSize:'0x1',gasLimit:'0x989680'}});
 const ranges=[];let fork=false;
 const rpc=async(method,args)=>{
  if(method==='quai_getTransactionReceipt')return {status:'0x1',contractAddress:infra.factory,blockNumber:'0x1',blockHash:hash(1)};
  if(method==='quai_getBlockByNumber'){const b=blocks(Number(BigInt(args[0])));if(fork&&args[0]==='0x3'){b.hash=hash(99);b.woHeader.hash=b.hash;}return b;}
  if(method==='quai_getLogs'){ranges.push(args[0]);return events.filter(e=>BigInt(e.blockNumber)>=BigInt(args[0].fromBlock)&&BigInt(e.blockNumber)<=BigInt(args[0].toBlock));}
  if(method==='quai_call')return factoryABI.encodeFunctionResult('walletOf',[infra.implementation]);
  throw Error(method);
 };
 return {rpc,blocks,ranges,fork:()=>{fork=true;}};
}
test('Factory history cache reads only a proven incremental range, including concurrent callers',async()=>{
 const f=historyFixture();await factoryStorageContext(f.rpc,f.blocks(3));
 await Promise.all([factoryStorageContext(f.rpc,f.blocks(4)),factoryStorageContext(f.rpc,f.blocks(4))]);
 assert.equal(f.ranges.length,2);assert.equal(f.ranges[0].fromBlock,'0x1');assert.equal(f.ranges[1].fromBlock,'0x4');assert.equal(f.ranges[1].toBlock,'0x4');
});
test('Cached factory history never hides a canonicality mismatch',async()=>{
 const f=historyFixture();await factoryStorageContext(f.rpc,f.blocks(3));f.fork();
 await assert.rejects(factoryStorageContext(f.rpc,f.blocks(4)),/noncanonical/);assert.equal(f.ranges.length,1);
});
test('Incremental factory context retains old storage keys and discovers each new wallet',async()=>{
 const event=n=>({address:infra.factory,blockNumber:'0x'+n.toString(16),blockHash:hash(n),removed:false,
  ...factoryABI.encodeEventLog(factoryABI.getEvent('WalletCreated'),[hash(n+100),infra.implementation,hash(n+200)])});
 const f=historyFixture([event(2),event(4)]),first=await factoryStorageContext(f.rpc,f.blocks(3)),second=await factoryStorageContext(f.rpc,f.blocks(4));
 assert.equal(first.length,1);assert.equal(second.length,2);assert(second.includes(first[0]));
 const cold=historyFixture([event(2),event(4)]);assert.deepEqual(second,await factoryStorageContext(cold.rpc,cold.blocks(4)));
});
