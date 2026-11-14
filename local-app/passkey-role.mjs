const administratorWallet='0x000450fd930f4c05d6e96d4e51935f4cd403286c';

// Called only after the existing Passkey session has been authenticated.
// Use the immutable wallet assignment, not a profile or client-supplied address.
export async function passkeyRole(db,accountId){
 const wallet=await db.prepare('SELECT address FROM passkey_fee_wallets WHERE account_id=$1').get(accountId);
 return wallet?.address===administratorWallet?'admin':'member';
}
