// The identity, credentials, grants and relayer lane are shared. Wallet-specific
// journals are separate: a v1 approval can never authorize a v2 transaction.
export const walletTables=Object.freeze([
 'passkey_clone_wallets','passkey_native_operations','passkey_relayer_intents',
 'passkey_clone_approvals','passkey_clone_approval_history',
 'passkey_auto_activations','passkey_activation_events'
]);
const tables=new Set(walletTables);
export function walletSQL(sql,generation=1){
 if(![1,2].includes(generation))throw Error('Unsupported wallet generation');
 if(generation===1)return sql;
 // Rewrite internal unquoted identifiers only, never values, strings/comments.
 return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\b[a-zA-Z_][a-zA-Z_0-9]*\b/g,
  token=>tables.has(token)?token+'_v2':token);
}

export async function assertV1Settled(rawQuery){
 const {rows}=await rawQuery(`SELECT
 EXISTS(SELECT 1 FROM passkey_clone_approvals WHERE phase IN ('preparing','submitting') OR (phase='quoted' AND approved)) OR
 EXISTS(SELECT 1 FROM passkey_native_operations WHERE phase IN ('awaiting_confirmation','verifying','authorized','submitting')) OR
 EXISTS(SELECT 1 FROM passkey_auto_activations WHERE phase IN ('running','ambiguous')) OR
 EXISTS(SELECT 1 FROM passkey_relayer_intents WHERE phase='submitting') AS blocked`);
 if(rows[0].blocked)throw Error('Unresolved v1 wallet work requires review before v2 cutover');
}
