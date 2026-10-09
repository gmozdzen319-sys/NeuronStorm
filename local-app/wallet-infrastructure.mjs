// Public, pinned deployment information. No test credentials or signing capabilities.
import {createPublicKey} from 'node:crypto';
import {convertCOSEtoPKCS} from '@simplewebauthn/server/helpers';
import {planWalletClone} from './wallet-clone-plan.mjs';
export const WALLET_INFRASTRUCTURE=Object.freeze({
 chainId:9,rpID:'neuronstorm.onrender.com',origin:'https://neuronstorm.onrender.com',
 implementation:'0x0053e2f57997c487F23de01726290eF6937f2bf0',
 implementationHash:'0xb626a58dac2b0e58d5c63bf322bcb23a5afefb09396b75362518c43d2fc05740',
 factory:'0x00313F663E19d718B3BCCfcD37f81D11dd475F6C',
 factoryTransaction:'0x0050005542c08e7298d2959c7932230224acc474b29f243e79cc11a5e35d6f1a',
 factoryHash:'0x0cebe7c9bbfb5af092b161e546432dbbfe956fe34f5ad9f6dae0ec5cdbc1f917'
});
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
  const c=await db.prepare('SELECT * FROM passkey_credentials WHERE account_id=$1 AND revoked_at IS NULL ORDER BY created_at,id LIMIT 1').get(accountId);
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
