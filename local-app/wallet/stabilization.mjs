// Read-only readiness diagnostic; never grants or resumes execution authority.
import assert from 'node:assert/strict';
import {validateBlock,assertCanonicalAdvance,captureAccounts,assertSameAccounts} from './head-guard.mjs';
export async function observeStability({sources,entries=[],samples=3,depth=3,intervalMs=2000,timeoutMs=30000,maxAgeMs=120000,now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),record=()=>{}}){
 assert(sources.length>=1&&sources.length<=3);assert(new Set(sources.map(s=>s.name)).size===sources.length);assert(Number.isInteger(samples)&&samples>=3&&samples<=5);assert(Number.isInteger(depth)&&depth>=2&&depth<=8);assert(intervalMs>=0&&intervalMs<=5000);assert(timeoutMs>0&&timeoutMs<=60000);assert(maxAgeMs>0&&maxAgeMs<=120000);
 const end=now()+timeoutMs;let anchor,baseline,last=[];
 const limited=async promise=>{const left=end-now();assert(left>0,'stabilization timeout');let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('stabilization timeout')),left))]);}finally{clearTimeout(timer);}};
 const clients=sources.map(s=>({name:s.name,rpc:async(method,params=[])=>{assert(['quai_chainId','quai_getBlockByNumber','quai_getBalance','quai_getTransactionCount','quai_getCode','quai_getStorageAt'].includes(method),'diagnostic method forbidden');assert(now()<end,'stabilization timeout');const startedAt=now();const result=await limited(s.rpc(method,params));await record({source:s.name,method,params,startedAt,receivedAt:now(),result});return result;}}));
 function fresh(b){const age=now()-Number(BigInt(b.woHeader.timestamp))*1000;assert(age>=-15000&&age<=maxAgeMs,'stale/future backend head');}
 for(let round=0;round<samples;round++){
  for(let i=0;i<clients.length;i++){
   const {rpc}=clients[i];assert.equal(BigInt(await rpc('quai_chainId')),9n);const head=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));fresh(head);
   if(!anchor){assert(BigInt(head.woHeader.number)>=BigInt(depth));anchor=validateBlock(await rpc('quai_getBlockByNumber',['0x'+(BigInt(head.woHeader.number)-BigInt(depth)).toString(16),false]));assert.equal(BigInt(anchor.woHeader.number),BigInt(head.woHeader.number)-BigInt(depth));}
   // A single anchor for this whole window. Never reset it to hide disagreement.
   await assertCanonicalAdvance(rpc,anchor,head);if(last[i])await assertCanonicalAdvance(rpc,last[i],head);
   const accounts=await captureAccounts(rpc,entries,head);if(baseline)assertSameAccounts(baseline,accounts);else baseline=accounts;
   last[i]=head;
  }
  if(round<samples-1)await limited(sleep(intervalMs));
 }
 assert(now()<end,'stabilization timeout');
 return {stable:true,authorization:false,executionAllowed:false,independenceEstablished:false,observedAt:now(),expiresAt:now()+15000,anchor,heads:last,accounts:baseline,samples};
}
export async function revalidateObservation(view,rpc,entries,{now=Date.now}={}){
 assert(view.stable&&view.authorization===false&&view.executionAllowed===false);assert(now()<view.expiresAt,'stabilization evidence expired');
 assert.equal(BigInt(await rpc('quai_chainId')),9n);const head=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));const age=now()-Number(BigInt(head.woHeader.timestamp))*1000;assert(age>=-15000&&age<=120000,'stale/future backend head');await assertCanonicalAdvance(rpc,view.anchor,head);await assertSameAccounts(view.accounts,await captureAccounts(rpc,entries,head));assert(now()<view.expiresAt,'stabilization evidence expired');return {valid:true,executionAllowed:false};
}
