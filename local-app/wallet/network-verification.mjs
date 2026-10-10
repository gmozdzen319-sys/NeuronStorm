import assert from 'node:assert/strict';
import {createWalletRPC} from './chain.mjs';
import {assertCanonicalBlock,captureAccounts,assertSameAccounts,accountEntries} from './head-guard.mjs';

export const OFFICIAL_RPC='https://rpc.quai.network/cyprus1';
export function createNetworkVerification(env,{fetcher=fetch}={}){
 const policy=env.NS_WALLET_NETWORK_POLICY;
 assert(['reviewed-independent-v1','official-single-source-v1'].includes(policy),'Explicit network verification policy required');
 let endpoint=OFFICIAL_RPC;
 if(policy==='reviewed-independent-v1'){
  assert(env.NS_WALLET_SECONDARY_RPC&&new URL(env.NS_WALLET_SECONDARY_RPC).href!==OFFICIAL_RPC,'Independent RPC required');
  endpoint=env.NS_WALLET_SECONDARY_RPC;
 }
 // In official-only mode these are repeated consistency observations, NOT
 // independent consensus validation. Never downgrade on a failed secondary.
 const observer=createWalletRPC(fetcher,endpoint);
 return async function verifyNetwork({rpc,block,relayer,wallet,accounts}){
  assert.equal(BigInt(await rpc('quai_chainId')),9n);
  assert.equal(BigInt(await observer('quai_chainId')),9n);
  await assertCanonicalBlock(rpc,block);await assertCanonicalBlock(observer,block);
  const entries=[{address:relayer,storageKeys:[]},{address:wallet,storageKeys:[]}];
  assertSameAccounts(await captureAccounts(rpc,entries,block),await captureAccounts(observer,entries,block));
  if(accounts)assertSameAccounts(accounts,await captureAccounts(observer,accountEntries(accounts),block));
  await assertCanonicalBlock(rpc,block);await assertCanonicalBlock(observer,block);
  return true;
 };
}
