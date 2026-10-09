// Operator-only READ-ONLY quote. This module has no signing/broadcast capability.
import assert from 'node:assert/strict';
import {getAddress,formatUnits} from 'quais';
import {assignCloneWallet,loadCloneWallet,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {factoryABI} from './chain.mjs';
import {validateBlock,assertCanonicalAdvance,assertCanonicalBlock} from './head-guard.mjs';
import {PRICE_CAP,SAFETY_MARGIN,canonicalACL,fingerprint} from './transaction-policy.mjs';
import {factoryStorageContext} from './factory-context.mjs';
const q=n=>'0x'+BigInt(n).toString(16),LIMIT=330000n;
export async function quoteProvisioning(db,{accountId,relayer,chain,preflight,now=Date.now}){
 relayer=getAddress(relayer);assert(/^0x00[0-7]/i.test(relayer)&&!/^0x0+$/i.test(relayer));
 await assignCloneWallet(db,accountId,now);const row=await loadCloneWallet(db,accountId);assert(row&&row.revoked_at===null,'No supported Passkey wallet assignment');
 const observed=await chain.snapshot(row.plan);if(observed.deployed)return {alreadyProvisioned:true,address:row.plan.address,expectedCostQuai:'0',broadcastAllowed:false};
 const rpc=chain.rpc,block=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));await assertCanonicalAdvance(rpc,observed.block,block);const tag=block.woHeader.number;
 const [latest,pending,balance,recommended]=await Promise.all([rpc('quai_getTransactionCount',[relayer,tag]),rpc('quai_getTransactionCount',[relayer,'pending']),rpc('quai_getBalance',[relayer,tag]),rpc('quai_gasPrice',[])]);
 assert.equal(BigInt(latest),BigInt(pending));const price=BigInt(recommended);assert(price>0n&&price<=PRICE_CAP);
 assert(BigInt(latest)>=0n&&BigInt(latest)<=BigInt(Number.MAX_SAFE_INTEGER));
 const transaction={from:relayer,to:infra.factory,nonce:q(latest),value:'0x0',data:factoryABI.encodeFunctionData('createWallet',[row.plan.x,row.plan.y,row.plan.grind]),gas:q(LIMIT),gasPrice:q(price)};
 const list=await rpc('quai_createAccessList',[transaction,tag]);assert(!list.error);transaction.accessList=canonicalACL(list.accessList);
  const estimate=BigInt(await rpc('quai_estimateGas',[transaction,tag])),gas=BigInt(list.gasUsed);assert(gas>0n&&gas<=LIMIT&&estimate>0n&&estimate<=LIMIT);
  let native=null;
  if(preflight){
   const factoryStorageKeys=await factoryStorageContext(rpc,block);
   native=await preflight(rpc,{...transaction,chainId:9,type:0,gasLimit:String(LIMIT)}, {...row,factoryStorageKeys},block);
   assert.equal(BigInt(native.gasUsed),gas);assert.equal(factoryABI.decodeFunctionResult('createWallet',native.returnValue)[0].toLowerCase(),row.address);
  }
 await assertCanonicalBlock(rpc,block);assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,'pending'])),BigInt(latest));
 const maximum=price*LIMIT,shortfall=maximum+SAFETY_MARGIN-BigInt(balance);
 return {accountId,address:row.plan.address,factory:infra.factory,implementation:infra.implementation,chainId:9,transaction,commitment:fingerprint({transaction,address:row.plan.address,blockHash:block.hash}),blockNumber:tag,blockHash:block.hash,quotedAt:new Date(now()).toISOString(),gasUsed:String(gas),gasEstimate:String(estimate),gasLimit:String(LIMIT),gasPriceWei:String(price),expectedCostQuai:formatUnits(gas*price,18),maximumCostQuai:formatUnits(maximum,18),balanceQuai:formatUnits(balance,18),requiredSafetyMarginQuai:'10',shortfallQuai:formatUnits(shortfall>0n?shortfall:0n,18),native, nativePreflightRequired:!native,approvalRequired:true,broadcastAllowed:false};
}
