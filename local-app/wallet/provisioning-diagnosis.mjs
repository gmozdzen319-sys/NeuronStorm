// Read-only rehearsal of the REAL first execution gate. No signing key is loaded.
// Only the approval claim/STOP SQL is virtualized, in memory; every other write
// is forbidden. This cannot enable/requeue a production grant or send a transaction.
import assert from 'node:assert/strict';
import {createCloneProvisioner} from './provisioner.mjs';
import {quoteProvisioning} from './provisioning-quote.mjs';
import {validateAutoQuote,AUTO_MAXIMUM} from './auto-activation.mjs';
import {loadCloneWallet} from '../wallet-infrastructure.mjs';

export async function diagnoseProvisioning(db,{accountId,relayer,chain,preflight,verifyNetwork}){
 let stage='QUOTE',approval,signingBoundary=false,cost;
 const readOnly={
  transaction:work=>work(),
  prepare(sql){
   if(sql.startsWith("UPDATE passkey_clone_approvals SET phase='preparing'"))return {get:async()=>approval};
   if(sql.startsWith("UPDATE passkey_clone_approvals SET phase='stopped'"))return {run:async()=>({changes:0})};
   assert(/^SELECT\b/i.test(sql),'Diagnostic writes forbidden');
   if(sql.startsWith('SELECT * FROM passkey_relayer_grants WHERE id='))return {get:async()=>({relayer,budget_wei:String(AUTO_MAXIMUM),reserved_wei:'0',enabled:true,expires_at:Date.now()+300000})};
   return db.prepare(sql);
  }
 };
 try{
  const row=await loadCloneWallet(readOnly,accountId);assert(row);
  const quote=await quoteProvisioning(readOnly,{accountId,relayer,chain,preflight});
  if(quote.alreadyProvisioned)return {stage:'ALREADY_PROVISIONED',broadcasts:0};
  validateAutoQuote(quote,{accountId,address:row.address,relayer});
  cost={maximumCostQuai:quote.maximumCostQuai,expectedCostQuai:quote.expectedCostQuai,balanceQuai:quote.balanceQuai};
  approval={quote:JSON.stringify(quote),commitment:quote.commitment,expires_at:Date.now()+120000};stage='EXECUTION';
  const provisioner=createCloneProvisioner(readOnly,{chain,relayer,grantId:'read-only-diagnosis',preflight,verifyNetwork,
   signer:{getAddress:async()=>{signingBoundary=true;throw Error('Diagnostic signing boundary');}},
   sendRaw:async()=>{throw Error('Diagnostic broadcast forbidden');}});
  await provisioner.execute(accountId);throw Error('Diagnostic boundary was not enforced');
 }catch(error){
  // Never serialize errors/stack/actual/expected: SDK exceptions may contain secrets.
  const knownMessages=new Map([
   ['gas-relevant Quai state size changed','STATE_SIZE_CHANGED'],
   ['stabilization timeout','STABILIZATION_TIMEOUT'],
   ['noncanonical snapshot/reorg','CANONICALITY_MISMATCH'],
   ['Invalid wallet RPC response','INVALID_RPC_RESPONSE'],
   ['relevant account code/storage/nonce/balance changed','ACCOUNT_STATE_CHANGED'],
   ['Native execution failed','NATIVE_EXECUTION_FAILED']
  ]);
  return {stage:signingBoundary?'PRE_SIGN_CHECKS_PASSED':error.provisioningStage??stage,
   reason:signingBoundary?'READ_ONLY_BOUNDARY':knownMessages.get(error.message.split('\n')[0])??'INVARIANT_FAILED',
   ...(error.walletRPC?{rpc:error.walletRPC}:{}),...(cost?{cost}:{}),broadcasts:0};
 }
}
