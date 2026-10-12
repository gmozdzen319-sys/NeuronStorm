import assert from 'node:assert/strict';
import {assignCloneWallet} from './wallet-infrastructure.mjs';

export async function communityAddress(db,accountId,now=Date.now){
 return db.transaction(async()=>{
  await db.prepare('SELECT id FROM passkey_accounts WHERE id=$1 FOR UPDATE').get(accountId);
  const saved=await db.prepare('SELECT address FROM passkey_community_accounts WHERE account_id=$1').get(accountId);
  if(saved)return saved.address;
  const wallet=await assignCloneWallet(db,accountId,now);
  if(!wallet)return null; // Unsupported RP is never assigned a production identity.
  await db.lock('community-identity:'+wallet.address);
  assert(!await db.prepare('SELECT address FROM accounts WHERE address=$1').get(wallet.address),'Community identity already belongs to another account');
  await db.prepare('INSERT INTO accounts(address,created_at) VALUES($1,$2)').run(wallet.address,now());
  await db.prepare('INSERT INTO passkey_community_accounts(account_id,address) VALUES($1,$2)').run(accountId,wallet.address);
  return wallet.address;
 });
}
