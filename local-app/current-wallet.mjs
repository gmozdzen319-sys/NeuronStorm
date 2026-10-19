import {getAddress} from 'quais';

const unavailable=()=>Object.assign(new Error('This member does not have a verified active wallet yet. Please try again after activation.'),{status:423,code:'CURRENT_WALLET_UNAVAILABLE'});
export async function usesCurrentWallet(db,accountId){
 return Boolean(await db.prepare('SELECT account_id FROM passkey_current_wallet_accounts WHERE account_id=$1').get(accountId));
}
// One read-only source of current wallet identity. The verifier is wired only
// server-side to the existing pinned v3 registry and canonical chain snapshot.
// Neither the social identity nor a reserved/historical address is a fallback.
export async function currentAccountWallet(db,accountId,verified=null){
 if(!await usesCurrentWallet(db,accountId))return null;
 const rows=await db.prepare(`SELECT w.address,a.phase,a.receipt FROM passkey_fee_wallets w
 LEFT JOIN passkey_fee_approvals a ON a.account_id=w.account_id WHERE w.account_id=$1`).all(accountId);
 if(rows.length!==1||rows[0].phase!=='confirmed')throw unavailable();
 let receipt;try{receipt=JSON.parse(rows[0].receipt);}catch{throw unavailable();}
 if(receipt?.status!=='0x1'&&receipt?.status!==1)throw unavailable();
 const proof=verified??await db.verifyCurrentWallet?.(accountId);
 if(!proof?.view?.deployed||proof.row?.account_id!==accountId||proof.row.generation!==3||proof.row.revoked_at!==null||
    proof.row.plan?.address?.toLowerCase()!==rows[0].address)throw unavailable();
 return getAddress(rows[0].address);
}
export async function currentWalletForIdentity(db,identity,{required=false}={}){
 if(!identity)return null;
 const links=await db.prepare(`SELECT c.account_id FROM passkey_community_accounts c
 JOIN passkey_current_wallet_accounts n ON n.account_id=c.account_id WHERE c.address=$1`).all(identity.toLowerCase());
 if(!links.length)return identity; // Explicit legacy boundary: no reinterpretation.
 try{
  if(links.length!==1)throw unavailable();
  return await currentAccountWallet(db,links[0].account_id);
 }catch(error){if(required)throw error;return null;}
}
