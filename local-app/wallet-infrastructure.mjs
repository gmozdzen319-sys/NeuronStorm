// Public, pinned deployment information. No test credentials or signing capabilities.
import {createPublicKey} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {convertCOSEtoPKCS} from '@simplewebauthn/server/helpers';
import {planWalletClone} from './wallet-clone-plan.mjs';
const V1=Object.freeze({
 chainId:9,rpID:'neuronstorm.onrender.com',origin:'https://neuronstorm.onrender.com',
 implementation:'0x0053e2f57997c487F23de01726290eF6937f2bf0',
 implementationHash:'0xb626a58dac2b0e58d5c63bf322bcb23a5afefb09396b75362518c43d2fc05740',
 factory:'0x00313F663E19d718B3BCCfcD37f81D11dd475F6C',
 factoryTransaction:'0x0050005542c08e7298d2959c7932230224acc474b29f243e79cc11a5e35d6f1a',
 factoryHash:'0x0cebe7c9bbfb5af092b161e546432dbbfe956fe34f5ad9f6dae0ec5cdbc1f917'
});
export const WALLET_GENERATION=Number(process.env.NS_WALLET_GENERATION??'1');
assert([1,2].includes(WALLET_GENERATION),'Unsupported wallet generation');
export function receiveInfrastructure(manifest){
 assert.equal(manifest.generation,2);assert.equal(manifest.chainId,9);
 assert.equal(manifest.implementation,V1.implementation);assert.equal(manifest.implementationHash,V1.implementationHash);
 assert.equal(manifest.rpID,V1.rpID);assert.equal(manifest.origin,V1.origin);
 assert(/^0x00[0-7][a-f0-9]{37}$/i.test(manifest.factory));assert.notEqual(manifest.factory.toLowerCase(),V1.factory.toLowerCase());
 for(const field of ['factoryHash','factoryTransaction'])assert(/^0x[a-f0-9]{64}$/i.test(manifest[field]));
 assert.equal(manifest.confirmed,true,'Confirmed v2 deployment manifest required');
 return Object.freeze({chainId:9,rpID:V1.rpID,origin:V1.origin,implementation:V1.implementation,
  implementationHash:V1.implementationHash,factory:manifest.factory,factoryHash:manifest.factoryHash,
  factoryTransaction:manifest.factoryTransaction,generation:2});
}
// No placeholder address and no fallback to v1 when a v2 deployment is missing.
export const WALLET_INFRASTRUCTURE=WALLET_GENERATION===1?V1:receiveInfrastructure(
 JSON.parse(readFileSync(new URL('./wallet/receive-v2-deployment.json',import.meta.url),'utf8')));
export function publicPoint(publicKey){
 const bytes=Buffer.from(convertCOSEtoPKCS(Buffer.from(publicKey,'base64url')));
 if(bytes.length!==65||bytes[0]!==4)throw Error('Expected an uncompressed P-256 key');
 const x=bytes.subarray(1,33),y=bytes.subarray(33);
 // Node validates the point rather than accepting arbitrary 32-byte coordinates.
 createPublicKey({key:{kty:'EC',crv:'P-256',x:x.toString('base64url'),y:y.toString('base64url')},format:'jwk'});
 return {x:'0x'+x.toString('hex'),y:'0x'+y.toString('hex')};
}
export function planCredentialWallet(c){
 if(c.rp_id!==WALLET_INFRASTRUCTURE.rpID||c.origin!==WALLET_INFRASTRUCTURE.origin)return null;
 const point=publicPoint(c.public_key);
 return {...planWalletClone({...WALLET_INFRASTRUCTURE,...point}),...point};
}
export async function assignCloneWallet(db,accountId,now=Date.now){
 return db.transaction(async()=>{
  // Serialize first login/registration and concurrent requests for this identity.
  const owner=await db.prepare('SELECT * FROM passkey_accounts WHERE id=$1 FOR UPDATE').get(accountId);
  if(!owner)throw Error('Unknown Passkey identity');
  const existing=await db.prepare('SELECT * FROM passkey_clone_wallets WHERE account_id=$1').get(accountId);
  if(existing)return existing;
  const legacy=WALLET_GENERATION===2?await db.prepare('SELECT credential_id FROM passkey_v1_assignments WHERE account_id=$1').get(accountId):null;
  const c=legacy
    ?await db.prepare('SELECT * FROM passkey_credentials WHERE account_id=$1 AND id=$2 AND revoked_at IS NULL').get(accountId,legacy.credential_id)
    :await db.prepare('SELECT * FROM passkey_credentials WHERE account_id=$1 AND revoked_at IS NULL ORDER BY created_at,id LIMIT 1').get(accountId);
  if(!c)return null;
  const plan=planCredentialWallet({...c,rp_id:owner.rp_id,origin:owner.origin});if(!plan)return null;
  await db.prepare('INSERT INTO passkey_clone_wallets VALUES($1,$2,$3,$4,$5,$6)').run(accountId,c.id,plan.address.toLowerCase(),plan.keyId,JSON.stringify(plan),now());
  return db.prepare('SELECT * FROM passkey_clone_wallets WHERE account_id=$1').get(accountId);
 });
}
export async function loadCloneWallet(db,accountId){
 const row=await db.prepare(`SELECT w.*,c.public_key,c.counter,c.revoked_at,a.rp_id,a.origin,a.user_handle
 FROM passkey_clone_wallets w JOIN passkey_credentials c ON c.id=w.credential_id AND c.account_id=w.account_id
 JOIN passkey_accounts a ON a.id=w.account_id WHERE w.account_id=$1`).get(accountId);
 if(!row)return null;
 const plan=planCredentialWallet(row);
 if(!plan||JSON.stringify(plan)!==row.plan||plan.address.toLowerCase()!==row.address||plan.keyId!==row.key_id)throw Error('Wallet assignment mismatch');
 return {...row,plan};
}
