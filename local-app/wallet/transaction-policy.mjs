import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {NS_TOKEN} from '../neuron-token.mjs';
export const PRICE_CAP=75000000000000n,GAS_LIMIT=1000000n,SAFETY_MARGIN=10000000000000000000n;
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v)).digest('hex');
export function canonicalACL(list){
 assert(Array.isArray(list)&&list.length>0);const seen=new Set();
 return list.map(a=>{assert.deepEqual(Object.keys(a).sort(),['address','storageKeys']);const address=a.address.toLowerCase();assert(/^0x[0-9a-f]{40}$/.test(address)&&address!==NS_TOKEN.address.toLowerCase());assert(!seen.has(address));seen.add(address);assert(Array.isArray(a.storageKeys));const storageKeys=a.storageKeys.map(k=>k.toLowerCase());assert(storageKeys.every(k=>/^0x[0-9a-f]{64}$/.test(k)));assert.equal(new Set(storageKeys).size,storageKeys.length);return {address,storageKeys:storageKeys.sort()};}).sort((a,b)=>a.address.localeCompare(b.address));
}
export function bound(tx,gasLimit=GAS_LIMIT){
 assert([GAS_LIMIT,330000n].includes(BigInt(gasLimit)));
 assert(Object.keys(tx).every(k=>['chainId','type','from','to','nonce','value','gasPrice','gasLimit','data','accessList'].includes(k)));
 assert.equal(BigInt(tx.chainId),9n);assert.equal(BigInt(tx.type),0n);assert.equal(BigInt(tx.value),0n);
 assert(BigInt(tx.nonce)>=0n&&BigInt(tx.nonce)<=BigInt(Number.MAX_SAFE_INTEGER));
 assert(BigInt(tx.gasPrice)>0n&&BigInt(tx.gasPrice)<=PRICE_CAP);assert.equal(BigInt(tx.gasLimit),BigInt(gasLimit));
 assert(/^0x(?:[0-9a-f]{2})+$/i.test(tx.data));
 return {chainId:'9',type:'0',from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),nonce:String(BigInt(tx.nonce)),value:'0',gasPrice:String(BigInt(tx.gasPrice)),gasLimit:String(gasLimit),data:tx.data.toLowerCase(),accessList:canonicalACL(tx.accessList)};
}
