import test from 'node:test';
import assert from 'node:assert/strict';
import {createNetworkVerification,OFFICIAL_RPC} from '../wallet/network-verification.mjs';
import {captureAccounts} from '../wallet/head-guard.mjs';
const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const address='0x0000000000000000000000000000000000000001';
const block={hash:hash(2),woHeader:{hash:hash(2),parentHash:hash(1),location:'0x0000',number:'0x2',timestamp:'0x100'},header:{quaiStateSize:'0x1',gasLimit:'0x989680'}};
const base=async m=>({quai_chainId:'0x9',quai_getBlockByNumber:block,quai_getBalance:'0x10',quai_getTransactionCount:'0x3',quai_getCode:'0x6000',quai_getStorageAt:hash(9)})[m];
function fixture(change=async(m,v)=>v,policy='official-single-source-v1'){
 const calls=[];
 const fetcher=async(url,options)=>{
  const request=JSON.parse(options.body);calls.push({url,...request});
  assert(!request.method.includes('send'),'No broadcast in verification');
  const result=await change(request.method,await base(request.method));
  return {ok:true,text:async()=>JSON.stringify({jsonrpc:'2.0',id:request.id,result})};
 };
 const verify=createNetworkVerification({NS_WALLET_NETWORK_POLICY:policy,NS_WALLET_SECONDARY_RPC:'https://independent.example/rpc'},{fetcher});
 return {calls,verify,args:{rpc:base,block,relayer:address,wallet:address}};
}
test('Explicit official-only policy uses only official HTTPS endpoint and retains exact state checks',async()=>{
 const f=fixture();f.args.accounts=await captureAccounts(base,[{address,storageKeys:[hash(0)]}],block);
 assert.equal(await f.verify(f.args),true);assert(f.calls.length>0);assert(f.calls.every(c=>c.url===OFFICIAL_RPC));
 assert(f.calls.some(c=>c.method==='quai_getStorageAt'));
});
for(const [method,bad] of [['quai_chainId','0x1'],['quai_getBlockByNumber',{...block,hash:hash(3),woHeader:{...block.woHeader,hash:hash(3)}}],['quai_getBalance','0x11'],['quai_getTransactionCount','0x4'],['quai_getCode','0x6001'],['quai_getStorageAt',hash(10)]]){
 test('Official-only policy rejects inconsistent '+method,async()=>{
  const f=fixture(async(m,v)=>m===method?bad:v);f.args.accounts=await captureAccounts(base,[{address,storageKeys:[hash(0)]}],block);
  await assert.rejects(f.verify(f.args));
 });
}
test('Network policy never silently falls back after RPC failure or without explicit mode',async()=>{
 for(const policy of ['official-single-source-v1','reviewed-independent-v1']){
  const f=fixture(async()=>{throw Error('RPC unavailable');},policy);await assert.rejects(f.verify(f.args),/RPC unavailable/);assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].url,policy==='official-single-source-v1'?OFFICIAL_RPC:'https://independent.example/rpc');
 }
 for(const env of [{},{NS_WALLET_NETWORK_POLICY:'anything'},{NS_WALLET_NETWORK_POLICY:'reviewed-independent-v1',NS_WALLET_SECONDARY_RPC:OFFICIAL_RPC}])assert.throws(()=>createNetworkVerification(env));
});
