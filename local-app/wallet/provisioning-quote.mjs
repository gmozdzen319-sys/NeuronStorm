// Operator-only READ-ONLY quote. This module has no signing/broadcast capability.
import assert from 'node:assert/strict';
import {getAddress,formatUnits} from 'quais';
import {assignCloneWallet,loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {factoryABI} from './chain.mjs';
import {validateBlock,assertCanonicalAdvance,assertCanonicalBlock} from './head-guard.mjs';
import {PRICE_CAP,SAFETY_MARGIN,canonicalACL,fingerprint} from './transaction-policy.mjs';
import {factoryStorageContext} from './factory-context.mjs';
const q=n=>'0x'+BigInt(n).toString(16);
export async function quoteProvisioning(db,{accountId,relayer,chain,preflight,now=Date.now,registry=null}){
 const infrastructure=registry?.infrastructure??infra;
 const fee=registry!==null;if(fee)assert.equal(infrastructure.generation,3);
 let LIMIT=330000n;
 let quoteStage='ASSIGNMENT',gasEvidence;
 try{
 relayer=getAddress(relayer);assert(/^0x00[0-7]/i.test(relayer)&&!/^0x0+$/i.test(relayer));
 if(registry)await registry.assign(db,accountId);else await assignCloneWallet(db,accountId,now);const row=await (registry?registry.load(db,accountId):loadCloneWallet(db,accountId));assert(row&&row.revoked_at===null,'No supported Passkey wallet assignment');
 quoteStage='WALLET_SNAPSHOT';
 const observed=await chain.snapshot(row.plan);if(observed.deployed)return {alreadyProvisioned:true,address:row.plan.address,expectedCostQuai:'0',broadcastAllowed:false};
 quoteStage='QUOTE_HEAD';
 const rpc=chain.rpc,block=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));await assertCanonicalAdvance(rpc,observed.block,block);const tag=block.woHeader.number;
 const [latest,pending,balance,recommended]=await Promise.all([rpc('quai_getTransactionCount',[relayer,tag]),rpc('quai_getTransactionCount',[relayer,'pending']),rpc('quai_getBalance',[relayer,tag]),rpc('quai_gasPrice',[])]);
 quoteStage='RELAYER_NONCE_AND_PRICE';
 assert.equal(BigInt(latest),BigInt(pending));const price=BigInt(recommended);assert(price>0n&&(fee||price<=PRICE_CAP));
 assert(BigInt(latest)>=0n&&BigInt(latest)<=BigInt(Number.MAX_SAFE_INTEGER));
 if(fee){const affordable=(BigInt(balance)-SAFETY_MARGIN)/price;LIMIT=BigInt(block.header.gasLimit)<affordable?BigInt(block.header.gasLimit):affordable;assert(LIMIT>21000n,'Insufficient provisioning reserve');}
 const transaction={from:relayer,to:infrastructure.factory,nonce:q(latest),value:'0x0',data:factoryABI.encodeFunctionData('createWallet',[row.plan.x,row.plan.y,row.plan.grind]),gas:q(LIMIT),gasPrice:q(price)};
 quoteStage='RPC_ACCESS_LIST';
 const list=await rpc('quai_createAccessList',[transaction,tag]);assert(!list.error);transaction.accessList=canonicalACL(list.accessList);
  quoteStage='RPC_GAS_ESTIMATE';
  const estimate=BigInt(await rpc('quai_estimateGas',[transaction,tag])),gas=BigInt(list.gasUsed);
  if(fee){assert(estimate>0n&&estimate<=LIMIT);LIMIT=estimate;transaction.gas=q(LIMIT);}
  gasEvidence={accessListGas:String(gas),estimatedGas:String(estimate),gasLimit:String(LIMIT)};
  assert(gas>0n&&gas<=LIMIT&&estimate>0n);
  // A padded estimate above LIMIT requires the exact native/RPC proof below.
  assert(estimate<=LIMIT||preflight,'Native proof required for padded estimate');
  let native=null;
  if(preflight){
   quoteStage='FACTORY_STORAGE';
   const factoryStorageKeys=await factoryStorageContext(rpc,block,infrastructure,registry?db:null);
   quoteStage='NATIVE_EXECUTION';
   native=await preflight(rpc,{...transaction,chainId:9,type:0,gasLimit:String(LIMIT)}, {...row,factoryStorageKeys},block);
   quoteStage='NATIVE_GAS_MATCH';gasEvidence.nativeGas=String(BigInt(native.gasUsed));
   assert.equal(BigInt(native.gasUsed),gas);quoteStage='NATIVE_ADDRESS_MATCH';assert.equal(factoryABI.decodeFunctionResult('createWallet',native.returnValue)[0].toLowerCase(),row.address);
  }
 quoteStage='FINAL_QUOTE_STATE';
 await assertCanonicalBlock(rpc,block);assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,'pending'])),BigInt(latest));
 const maximum=price*LIMIT,shortfall=maximum+SAFETY_MARGIN-BigInt(balance);
 return {accountId,address:row.plan.address,factory:infrastructure.factory,implementation:infrastructure.implementation,chainId:9,transaction,commitment:fingerprint({transaction,address:row.plan.address,blockHash:block.hash}),blockNumber:tag,blockHash:block.hash,quotedAt:new Date(now()).toISOString(),gasUsed:String(gas),gasEstimate:String(estimate),gasLimit:String(LIMIT),gasPriceWei:String(price),expectedCostQuai:formatUnits(gas*price,18),maximumCostQuai:formatUnits(maximum,18),balanceQuai:formatUnits(balance,18),requiredSafetyMarginQuai:'10',shortfallQuai:formatUnits(shortfall>0n?shortfall:0n,18),native, nativePreflightRequired:!native,approvalRequired:true,broadcastAllowed:false};
 }catch(error){error.quoteDiagnostic={stage:quoteStage,...(gasEvidence?{gas:gasEvidence}:{})};throw error;}
}
