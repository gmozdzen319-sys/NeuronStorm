import assert from 'node:assert/strict';
import {WALLET_INFRASTRUCTURE as legacy,publicPoint} from '../wallet-infrastructure.mjs';
import {planWalletClone} from '../wallet-clone-plan.mjs';
import {feeAddress} from './fee-operation.mjs';

// There is no default or predicted Mainnet deployment here. Wiring this service
// requires a reviewed confirmed deployment manifest, then chain runtime checks.
export function feeInfrastructure(manifest){
 assert.equal(manifest.generation,3);assert.equal(manifest.chainId,9);assert.equal(manifest.confirmed,true);
 assert.equal(manifest.rpID,legacy.rpID);assert.equal(manifest.origin,legacy.origin);
 feeAddress(manifest.factory);feeAddress(manifest.implementation);
 assert.notEqual(manifest.factory.toLowerCase(),legacy.factory.toLowerCase());
 assert.notEqual(manifest.implementation.toLowerCase(),legacy.implementation.toLowerCase());
 for(const field of ['factoryHash','implementationHash','factoryTransaction','implementationTransaction'])assert(/^0x[0-9a-f]{64}$/i.test(manifest[field])&&BigInt(manifest[field])!==0n);
 return Object.freeze({...manifest});
}
export function createFeeAssignments(manifest,{now=Date.now}={}){
 const infrastructure=feeInfrastructure(manifest);
 function plan(c){
  assert.equal(c.rp_id,infrastructure.rpID);assert.equal(c.origin,infrastructure.origin);
  const point=publicPoint(c.public_key);
  return {...planWalletClone({...infrastructure,...point}),...point};
 }
 async function load(db,accountId){
  const row=await db.prepare(`SELECT w.*,c.public_key,c.counter,c.revoked_at,a.rp_id,a.origin,a.user_handle
   FROM passkey_fee_wallets w JOIN passkey_credentials c ON c.id=w.credential_id AND c.account_id=w.account_id
   JOIN passkey_accounts a ON a.id=w.account_id WHERE w.account_id=$1`).get(accountId);
  if(!row)return null;
  const expected=plan(row);assert.equal(row.plan,JSON.stringify(expected),'Fee wallet assignment changed');
  assert.equal(row.address,expected.address.toLowerCase());assert.equal(row.key_id,expected.keyId);
  return {...row,generation:3,plan:expected};
 }
 async function assign(db,accountId){
  return db.transaction(async()=>{
   const owner=await db.prepare('SELECT * FROM passkey_accounts WHERE id=$1 FOR UPDATE').get(accountId);assert(owner);
   const existing=await load(db,accountId);if(existing)return existing;
   // Preserve the account's currently assigned credential. Do not copy secrets
   // or silently choose a different device when its on-chain key is revoked.
   const current=await db.prepare('SELECT credential_id FROM passkey_clone_wallets WHERE account_id=$1').get(accountId);assert(current);
   const c=await db.prepare('SELECT * FROM passkey_credentials WHERE id=$1 AND account_id=$2 AND revoked_at IS NULL').get(current.credential_id,accountId);assert(c);
   const proposed=plan({...c,rp_id:owner.rp_id,origin:owner.origin});
   await db.prepare('INSERT INTO passkey_fee_wallets(account_id,credential_id,address,key_id,plan,created_at) VALUES($1,$2,$3,$4,$5,$6)').run(accountId,c.id,proposed.address.toLowerCase(),proposed.keyId,JSON.stringify(proposed),now());
   return load(db,accountId);
  });
 }
 return {infrastructure,load,assign};
}
