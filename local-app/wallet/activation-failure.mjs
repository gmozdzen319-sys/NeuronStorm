const stages=new Set(['CONFIGURATION','QUOTE','QUOTE_POLICY','APPROVAL','EXECUTION','STABILIZATION','SAVED_PLAN','EXPIRY_AND_WALLET_STATE','CANONICAL_CONTEXT','CHAIN_AND_NONCE','BALANCE_AND_GRANT','ACCOUNT_SNAPSHOT','ACCESS_LIST','NATIVE_PREFLIGHT','NETWORK_VERIFICATION','SIGNING','DURABLE_SEND_INTENT','BROADCAST','RECEIPT_VERIFICATION']);
const quoteStages=new Set(['ASSIGNMENT','WALLET_SNAPSHOT','QUOTE_HEAD','RELAYER_NONCE_AND_PRICE','RPC_ACCESS_LIST','RPC_GAS_ESTIMATE','FACTORY_STORAGE','NATIVE_EXECUTION','NATIVE_GAS_MATCH','NATIVE_ADDRESS_MATCH','FINAL_QUOTE_STATE']);
// Persist only allowlisted labels, numeric measurements and source coordinates.
// Never persist message, full stack, assertion values or RPC/signing payloads.
function quoteDetails(error){
 const diagnostic=error?.quoteDiagnostic;
 const site=String(error?.stack??'').match(/[/\\](provisioning-quote|provisioner|provisioning-gas|fee-assignment|wallet-infrastructure|wallet-clone-plan|fee-operation|transaction-policy|fee-plan|chain|head-guard|factory-context|factory-checkpoint|preflight)\.mjs:(\d{1,6}):(\d{1,6})(?=[\s)]|$)/);
 const details={quoteStage:quoteStages.has(diagnostic?.stage)?diagnostic.stage:'UNKNOWN',subcode:error?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'DEPENDENCY_FAILED',guard:site?`${site[1]}:${site[2]}:${site[3]}`:'unavailable'};
 const gas={};
 for(const name of ['accessListGas','estimatedGas','gasLimit','nativeGas']){
  const value=diagnostic?.gas?.[name];
  if(typeof value==='string'&&/^[0-9]{1,78}$/.test(value))gas[name]=value;
 }
 if(Object.keys(gas).length)details.gas=gas;
 return details;
}
export function activationFailure(error,stage){
 const selected=error?.provisioningStage??stage;
 let code='INVARIANT_FAILED';
 if(error?.walletRPC?.method==='quai_getLogs'&&error.walletRPC.code===-32000&&error.walletRPC.message==='too many concurrent log queries; retry later')code='RPC_LOG_CAPACITY';
 else if(error?.walletRPC)code='RPC_RESPONSE_REJECTED';
 else if(error?.message==='stabilization timeout')code='STABILIZATION_TIMEOUT';
 else if(error?.message?.startsWith('noncanonical snapshot/reorg'))code='CANONICALITY_MISMATCH';
 else if(error?.message?.startsWith('gas-relevant Quai state size changed'))code='STATE_SIZE_CHANGED';
 const result={stage:stages.has(selected)?selected:'UNKNOWN',code};
 if(selected==='QUOTE')result.details=quoteDetails(error);
 const evidence=error?.canonicalityEvidence;
 if(code==='CANONICALITY_MISMATCH'&&evidence){
  const canonicality={};
  const values={blockHeight:evidence.requestedHeight,originalHash:evidence.expected?.hash,observedHash:evidence.observed?.hash};
  for(const [key,value] of Object.entries(values))if(typeof value==='string'&&(key==='blockHeight'?/^0x[0-9a-f]{1,64}$/i:/^0x[0-9a-f]{64}$/i).test(value))canonicality[key]=value;
  result.details={...quoteDetails(error),canonicality};
 }
 const life=error?.activationLifecycle;
 if(life&&['NEVER_BROADCAST','UNKNOWN'].includes(life.outcome)&&['approvalExisted','signingOccurred','sendRawEntered'].every(k=>typeof life[k]==='boolean')){
  result.details={...result.details,lifecycle:{approvalExisted:life.approvalExisted,signingOccurred:life.signingOccurred,sendRawEntered:life.sendRawEntered,outcome:life.outcome}};
 }
 return result;
}
