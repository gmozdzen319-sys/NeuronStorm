import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Interface,keccak256,formatUnits} from 'quais';
import {WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {validateBlock,assertCanonicalAdvance,assertCanonicalBlock} from './head-guard.mjs';
export const factoryABI=new Interface([
 'event WalletCreated(bytes32 indexed keyId,address indexed wallet,bytes32 salt)',
 'function implementation() view returns(address)','function implementationCodeHash() view returns(bytes32)',
 'function walletOf(bytes32) view returns(address)','function predict(bytes32,bytes32,uint256) view returns(address)',
 'function createWallet(bytes32,bytes32,uint256) returns(address)'
]);
export const walletABI=new Interface([
 'function rp() view returns(bytes32)','function originHash() view returns(bytes32)',
 'function nonce() view returns(uint256)','function epoch() view returns(uint256)',
 'function keyCount() view returns(uint256)','function keySlotCount() view returns(uint256)',
 'function keys(bytes32) view returns(bytes32,bytes32,bool)',
 'function digest(uint8,bytes32,uint256) view returns(bytes32)',
 'function verifyProbe(bytes32,(bytes32 r,bytes32 s,uint256 challengeIndex,uint256 typeIndex,bytes authenticatorData,string clientDataJSON),bytes32,bytes32) view returns(bool)',
 'function transferNative(address,uint256,uint256,bytes32,(bytes32 r,bytes32 s,uint256 challengeIndex,uint256 typeIndex,bytes authenticatorData,string clientDataJSON))'
]);
const METHODS=new Set(['quai_chainId','quai_getBlockByNumber','quai_getCode','quai_call','quai_getBalance','quai_getTransactionCount','quai_getStorageAt','quai_getTransactionReceipt','quai_getTransactionByHash','quai_getLogs','quai_gasPrice','quai_createAccessList','quai_estimateGas']);
export function createWalletRPC(fetcher=fetch,endpoint='https://rpc.quai.network/cyprus1',{sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const url=new URL(endpoint);assert(url.protocol==='https:'&&!url.username&&!url.password,'HTTPS RPC required');
 let id=0,logLane=Promise.resolve();
 async function request(method,params=[]){
  assert(METHODS.has(method),'Read-only wallet RPC method required');const requestId=++id;
  const r=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),signal:AbortSignal.timeout(10000)});
  const text=await r.text();assert(text.length<=2000000,'RPC result too large');const data=JSON.parse(text);
  if(!(r.ok&&data.jsonrpc==='2.0'&&data.id===requestId&&!data.error&&Object.hasOwn(data,'result'))){
   const error=new Error('Invalid wallet RPC response');
   // Read-only methods only. Never attach request parameters, response data,
   // signed bytes, arbitrary SDK error objects or endpoint credentials.
   error.walletRPC={method,httpStatus:r.status,code:Number.isSafeInteger(data.error?.code)?data.error.code:null,
    message:typeof data.error?.message==='string'?data.error.message.replace(/[\r\n]/g,' ').slice(0,240):'Invalid response envelope'};
   throw error;
  }
  return data.result;
 }
 return async(method,params=[])=>{
  if(method!=='quai_getLogs')return request(method,params);
  const pinnedParams=structuredClone(params);
  // Only this exact read-only overload response is retryable. Broadcasts are
  // not supported here; canonicality checks still validate the pinned range.
  const run=async()=>{for(let attempt=0;;attempt++){
   try{return await request(method,pinnedParams);}catch(error){
    if(attempt>=2||error.walletRPC?.code!==-32000||error.walletRPC?.message!=='too many concurrent log queries; retry later')throw error;
    await sleep((attempt+1)*2000);
   }
  }};
  const result=logLane.then(run,run);logLane=result.catch(()=>{});return result;
 };
}
const low=s=>s.toLowerCase(),zero='0x'+'0'.repeat(40);
export function createWalletChain({rpc=createWalletRPC(),now=Date.now}={}){
 const call=async(address,abi,name,args,tag)=>abi.decodeFunctionResult(name,await rpc('quai_call',[{to:address,data:abi.encodeFunctionData(name,args)},tag]));
 async function snapshot(plan){
  assert.equal(BigInt(await rpc('quai_chainId')),9n);
  const head=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));
  const age=now()-Number(BigInt(head.woHeader.timestamp))*1000;assert(age>=-15000&&age<=120000,'Stale wallet observation');
  assert(BigInt(head.woHeader.number)>=3n);
  // Three blocks is an observation policy, NOT a claim of PoEM finality.
  const tag='0x'+(BigInt(head.woHeader.number)-3n).toString(16);
  const block=validateBlock(await rpc('quai_getBlockByNumber',[tag,false]));assert.equal(block.woHeader.number,tag);
  await assertCanonicalAdvance(rpc,block,head);
  for(const [address,hash] of [[infra.implementation,infra.implementationHash],[infra.factory,infra.factoryHash]])assert.equal(keccak256(await rpc('quai_getCode',[address,tag])),hash,'Infrastructure runtime mismatch');
  assert.equal(low((await call(infra.factory,factoryABI,'implementation',[],tag))[0]),low(infra.implementation));
  assert.equal((await call(infra.factory,factoryABI,'implementationCodeHash',[],tag))[0],infra.implementationHash);
  assert.equal((await call(infra.implementation,walletABI,'rp',[],tag))[0],'0x'+createHash('sha256').update(infra.rpID).digest('hex'));
  assert.equal((await call(infra.implementation,walletABI,'originHash',[],tag))[0],keccak256(Buffer.from(infra.origin)));
  assert.equal(low((await call(infra.factory,factoryABI,'predict',[plan.x,plan.y,plan.grind],tag))[0]),low(plan.address));
  const assigned=low((await call(infra.factory,factoryABI,'walletOf',[plan.keyId],tag))[0]);
  const code=await rpc('quai_getCode',[plan.address,tag]);let result;
  if(assigned===zero){assert.equal(code,'0x','Unexpected code at unprovisioned address');result={deployed:false};}
  else{
   assert.equal(assigned,low(plan.address),'Factory assignment mismatch');assert.equal(keccak256(code),plan.runtimeHash,'Clone runtime mismatch');
   const key=await call(plan.address,walletABI,'keys',[plan.keyId],tag);
   assert.equal(low(key[0]),low(plan.x));assert.equal(low(key[1]),low(plan.y));assert.equal(key[2],true,'Wallet key revoked');
   const nonce=(await call(plan.address,walletABI,'nonce',[],tag))[0],epoch=(await call(plan.address,walletABI,'epoch',[],tag))[0];
   const balance=BigInt(await rpc('quai_getBalance',[plan.address,tag]));assert(balance>=0n);
   result={deployed:true,nonce:String(nonce),epoch:String(epoch),balanceWei:String(balance),quaiBalance:formatUnits(balance,18)};
  }
  await assertCanonicalBlock(rpc,block);await assertCanonicalAdvance(rpc,block,head);
  return {...result,block,observedAt:now(),finalityProven:false};
 }
 return {rpc,snapshot};
}
