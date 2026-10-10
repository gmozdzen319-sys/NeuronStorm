import test from 'node:test';
import assert from 'node:assert/strict';
import {ATTEMPT as A,validateV2Quote,executeV2Once} from '../wallet/activate-receive-v2.mjs';
const quote=()=>({accountId:A.account,address:A.wallet,factory:A.factory,chainId:9,transaction:{from:A.relayer,to:A.factory,nonce:'9',value:'0',gas:'330000',gasPrice:'32000000000000'},gasLimit:'330000',maximumCostQuai:'10.56',balanceQuai:'322.872178548658006361',native:{verified:true},nativePreflightRequired:false,approvalRequired:true,broadcastAllowed:false,quotedAt:new Date().toISOString(),commitment:'test'});
test('V2 reserve covers activation, receive, return, spent factory and safety margin',()=>{
 assert.deepEqual(validateV2Quote(quote()),{activation:10560000000000000000n,remaining:45767000000000000000n});
 for(const patch of [{accountId:'other'},{address:A.relayer},{factory:A.relayer},{chainId:1},{native:null},{balanceQuai:'50'},{maximumCostQuai:'0'},{broadcastAllowed:true},{quotedAt:'2000-01-01'}])assert.throws(()=>validateV2Quote({...quote(),...patch}));
 for(const patch of [{nonce:'10'},{value:'1'},{gas:'330001'},{gasPrice:'75000000000001'},{gasPrice:'46000000000000'},{from:A.wallet},{to:A.wallet}])assert.throws(()=>validateV2Quote({...quote(),transaction:{...quote().transaction,...patch}}));
});
for(const mode of ['success','over-budget','failed','ambiguous'])test('V2 one-shot '+mode+' cannot retry or leave grant enabled',async()=>{
 let grant=null,saved=null,quotes=0,sends=0;
 const db={transaction:fn=>fn(),prepare:sql=>({
  run:async(...args)=>{
   if(sql.startsWith('INSERT INTO passkey_relayer_grants')){assert.equal(grant,null,'Unique attempt');grant={enabled:false};}
   else if(sql.includes('SET enabled=TRUE'))grant.enabled=true;
   else if(sql.includes('SET enabled=FALSE'))grant.enabled=false;
   else if(sql.includes('SET approved=TRUE'))saved.approved=true;
   else assert.fail(sql);
  },get:async()=>saved
 })};
 const provisioner={quote:async()=>{quotes++;const q=quote();if(mode==='over-budget')q.balanceQuai='10';saved={phase:'quoted',approved:false,commitment:q.commitment,expires_at:Date.now()+120000,quote:JSON.stringify(q)};return q;},execute:async()=>{
  sends++;assert(grant.enabled&&saved.approved);if(mode==='ambiguous')throw Error('timeout');return {status:mode==='failed'?'failed':'confirmed'};
 }};
 if(['over-budget','ambiguous'].includes(mode))await assert.rejects(executeV2Once(db,provisioner));else await executeV2Once(db,provisioner);
 assert.equal(grant.enabled,false);assert.equal(sends,mode==='over-budget'?0:1);
 await assert.rejects(executeV2Once(db,provisioner));assert.equal(quotes,1);assert.equal(sends,mode==='over-budget'?0:1);
});
