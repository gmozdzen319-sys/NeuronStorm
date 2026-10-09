// Adapted principles from quai-provider confirmation.rs: read-only bounded observations.
// Confirmation count is caller policy, never a PoEM finality claim.
import assert from 'node:assert/strict';import {isDeepStrictEqual} from 'node:util';import {validateBlock} from './head-guard.mjs';
const hash=x=>typeof x==='string'&&/^0x[0-9a-f]{64}$/i.test(x),quantity=x=>typeof x==='string'&&/^0x[0-9a-f]+$/i.test(x);
function receiptCheck(r,h){assert(r&&r.transactionHash?.toLowerCase()===h.toLowerCase(),'wrong receipt transaction');assert(hash(r.blockHash)&&quantity(r.blockNumber)&&quantity(r.transactionIndex),'malformed receipt inclusion');assert(['0x0','0x1'].includes(r.status),'invalid receipt status');assert(quantity(r.gasUsed),'invalid receipt gas');}
export async function observeReceipt(rpc,h,count){
 assert(hash(h));assert(Number.isSafeInteger(count)&&count>0);
 const read=async(m,p)=>{assert.equal(BigInt(await rpc('quai_chainId',[])),9n,'wrong chain');return rpc(m,p);};
 const r=await read('quai_getTransactionReceipt',[h]);if(!r)return {status:'pending',reason:'missing'};receiptCheck(r,h);
 const head=validateBlock(await read('quai_getBlockByNumber',['latest',false]));const depth=BigInt(head.woHeader.number)-BigInt(r.blockNumber)+1n;
 if(depth<BigInt(count))return {status:'pending',reason:'depth'};
 const block=await read('quai_getBlockByNumber',[r.blockNumber,false]);if(!block)return {status:'pending',reason:'missing block'};validateBlock(block);assert.equal(BigInt(block.woHeader.number),BigInt(r.blockNumber),'wrong receipt block height');if(block.hash!==r.blockHash)return {status:'pending',reason:'orphaned inclusion'};
 const again=await read('quai_getTransactionReceipt',[h]);if(!again)return {status:'pending',reason:'vanished'};receiptCheck(again,h);
 if(again.blockHash!==r.blockHash||again.blockNumber!==r.blockNumber||again.transactionIndex!==r.transactionIndex)return {status:'pending',reason:'reincluded'};
 assert(isDeepStrictEqual(again,r),'receipt changed within identical inclusion');
 // Re-read the numbered observed head, never demand latest==latest.
 const canonical=await read('quai_getBlockByNumber',[head.woHeader.number,false]);if(!canonical)return {status:'pending',reason:'missing head'};validateBlock(canonical);assert.equal(BigInt(canonical.woHeader.number),BigInt(head.woHeader.number),'wrong observed head height');if(canonical.hash!==head.hash)return {status:'pending',reason:'head reorganized'};assert(isDeepStrictEqual(canonical.header,head.header)&&isDeepStrictEqual(canonical.woHeader,head.woHeader),'inconsistent head content');
 return {status:'confirmed',receipt:again,confirmations:Number(depth),observedHead:head,finalityProven:false};
}
export async function waitCanonicalReceipt(rpc,h,{confirmations,timeoutMs,pollMs,maxPolls,now=()=>performance.now(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),record=()=>{}}){
 assert(Number.isSafeInteger(confirmations)&&confirmations>0);assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=900000);assert(Number.isSafeInteger(pollMs)&&pollMs>0&&pollMs<=timeoutMs);assert(Number.isSafeInteger(maxPolls)&&maxPolls>0&&maxPolls<=1000);
 const end=now()+timeoutMs;let active=true;const bounded=async(m,p)=>{assert(active&&now()<end,'confirmation timeout');const left=end-now();let timer;try{return await Promise.race([rpc(m,p),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('confirmation timeout')),left))]);}finally{clearTimeout(timer);}};
 try{for(let i=0;i<maxPolls&&now()<end;i++){const result=await observeReceipt(bounded,h,confirmations);assert(now()<end,'confirmation timeout');await record(result);if(result.status==='confirmed')return result;await sleep(Math.min(pollMs,Math.max(0,end-now())));}throw Error('confirmation timeout/max polls; no resubmission');}finally{active=false;}
}
