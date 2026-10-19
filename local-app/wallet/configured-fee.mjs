import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Wallet,getAddress} from 'quais';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain} from './chain.mjs';
import {createFeeTokenReader} from './fee-token.mjs';
import {createFeeSend} from './fee-send.mjs';
import {createFeeExecutor} from './fee-executor.mjs';
import {createFeeSendPreflight} from './fee-native-preflight.mjs';
import {createNativeFeeQuote} from './fee-quote.mjs';
import {createNetworkVerification} from './network-verification.mjs';
import {createFeeReconciler} from './fee-settlement.mjs';

export function scopedFeeLoader(registry,allowedAccountId){
 return async(database,accountId)=>{
  if(allowedAccountId&&accountId!==allowedAccountId)return null;
  return registry.load(database,accountId);
 };
}

// Off until a confirmed reviewed manifest and separate fee grant are installed.
// Does not assign, provision, migrate funds or create a grant at startup.
export async function configuredFeeWallet(db,env=process.env){
 if(env.NS_FEE_WALLET_ENABLED!=='true')return null;
 assert(env.NS_FEE_WALLET_MANIFEST,'Confirmed fee-wallet manifest required');
 const registry=createFeeAssignments(JSON.parse(await readFile(env.NS_FEE_WALLET_MANIFEST,'utf8')));
 const infrastructure=registry.infrastructure,chain=createWalletChain({infrastructure});chain.token=createFeeTokenReader(chain.rpc);
 let executor=null,reconciler=null;
 if(env.NS_FEE_SEND_ENABLED==='true'){
  assert(env.NS_FEE_GRANT_ID&&env.NS_WALLET_RELAYER_KEY_FILE);
  const relayer=getAddress(env.NS_WALLET_RELAYER_ADDRESS),signer=new Wallet((await readFile(env.NS_WALLET_RELAYER_KEY_FILE,'utf8')).trim());
  assert.equal(await signer.getAddress(),relayer);
  const verifier={binary:env.NS_WALLET_NATIVE_VERIFIER,binaryHash:env.NS_WALLET_NATIVE_VERIFIER_SHA256,infrastructure};
  const sendRaw=async raw=>{
   const response=await fetch('https://rpc.quai.network/cyprus1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'quai_sendRawTransaction',params:[raw]}),signal:AbortSignal.timeout(10000)});
   const data=await response.json();assert(response.ok&&data.jsonrpc==='2.0'&&data.id===1&&!data.error&&/^0x[0-9a-f]{64}$/i.test(data.result));return data.result;
  };
  const verifyNetwork=createNetworkVerification(env);
  reconciler=createFeeReconciler(db,{rpc:chain.rpc,relayer,infrastructure,loadWallet:registry.load,verifyNetwork});
  executor=createFeeExecutor(db,{chain,relayer,grantId:env.NS_FEE_GRANT_ID,signer,sendRaw,preflight:createFeeSendPreflight(verifier),estimateQuote:createNativeFeeQuote(verifier),verifyNetwork,settle:reconciler.reconcile});
 }
 // Optional controlled rollout scope. It cannot be selected by request data.
 const loadWallet=scopedFeeLoader(registry,env.NS_FEE_ALLOWED_ACCOUNT_ID);
 const send=createFeeSend(db,{chain,executor,loadWallet});
 return {registry,chain,send,reconciler};
}
