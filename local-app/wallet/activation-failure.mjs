const stages=new Set(['CONFIGURATION','QUOTE','QUOTE_POLICY','APPROVAL','EXECUTION','STABILIZATION','SAVED_PLAN','EXPIRY_AND_WALLET_STATE','CANONICAL_CONTEXT','CHAIN_AND_NONCE','BALANCE_AND_GRANT','ACCOUNT_SNAPSHOT','ACCESS_LIST','NATIVE_PREFLIGHT','NETWORK_VERIFICATION','SIGNING','DURABLE_SEND_INTENT','BROADCAST','RECEIPT_VERIFICATION']);
export function activationFailure(error,stage){
 const selected=error?.provisioningStage??stage;
 let code='INVARIANT_FAILED';
 if(error?.walletRPC?.method==='quai_getLogs'&&error.walletRPC.code===-32000&&error.walletRPC.message==='too many concurrent log queries; retry later')code='RPC_LOG_CAPACITY';
 else if(error?.walletRPC)code='RPC_RESPONSE_REJECTED';
 else if(error?.message==='stabilization timeout')code='STABILIZATION_TIMEOUT';
 else if(error?.message?.startsWith('noncanonical snapshot/reorg'))code='CANONICALITY_MISMATCH';
 else if(error?.message?.startsWith('gas-relevant Quai state size changed'))code='STATE_SIZE_CHANGED';
 return {stage:stages.has(selected)?selected:'UNKNOWN',code};
}
