import assert from 'node:assert/strict';
import {createAutoActivation} from './auto-activation.mjs';
import {configuredExecutor} from './configured-executor.mjs';

// Called only inside successful NEW registration's transaction. Never scan or
// backfill existing accounts: an empty queue at deployment protects all old users.
export function feeSignupEnrollment(registry,now=Date.now){
 return async(db,accountId)=>{
  const row=await registry.assign(db,accountId);
  await db.prepare('INSERT INTO passkey_fee_signup_queue(account_id,created_at) VALUES($1,$2)').run(row.account_id,now());
 };
}
export function configuredFeeAutoActivation(db,fee,env=process.env){
 if(env.NS_FEE_AUTO_ACTIVATE!=='true')return null;
 assert(fee?.registry&&fee?.chain,'Fee wallet infrastructure required');
 assert.equal(env.NS_FEE_SEND_ENABLED,'true','New wallets require configured fee Send');
 assert(!env.NS_FEE_ALLOWED_ACCOUNT_ID,'New wallets cannot use a test-account scope');
 assert.notEqual(env.NS_WALLET_AUTO_ACTIVATE,'true','Legacy worker must remain off');
 assert.notEqual(env.NS_WALLET_PROVISION_ENABLED,'true');
 assert.equal(env.NS_WALLET_NETWORK_POLICY,'official-single-source-v1');
 assert.equal(env.NS_WALLET_RELAYER_ADDRESS.toLowerCase(),'0x001893151cdcc11372f6dd067e3424f47ad8534a');
 return createAutoActivation(db,{registry:fee.registry,relayer:env.NS_WALLET_RELAYER_ADDRESS,makeProvisioner:async grantId=>{
  const executor=await configuredExecutor(db,fee.chain,{...env,NS_WALLET_SEND_ENABLED:'false',NS_WALLET_PROVISION_ENABLED:'true',NS_WALLET_GRANT_ID:grantId},{registry:fee.registry});
  return executor.provisioner;
 }});
}
