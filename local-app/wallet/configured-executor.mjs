import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Wallet,getAddress} from 'quais';
import {createWalletRPC} from './chain.mjs';
import {createWalletExecutor} from './executor.mjs';
import {createNativePreflight} from './preflight.mjs';
import {createCloneProvisioner} from './provisioner.mjs';
import {assertCanonicalBlock,captureAccounts,assertSameAccounts,accountEntries} from './head-guard.mjs';

// Deployment never enables spending. Secrets, a reviewed verifier/network policy
// and a separately approved DB sponsorship grant are all required. No test keys.
export async function configuredExecutor(db,chain,env=process.env){
 if(env.NS_WALLET_SEND_ENABLED!=='true'&&env.NS_WALLET_PROVISION_ENABLED!=='true')return null;
 assert.equal(env.NS_WALLET_NETWORK_POLICY,'reviewed-independent-v1','Production network verification policy requires review');
 assert(env.NS_WALLET_SECONDARY_RPC&&env.NS_WALLET_SECONDARY_RPC!=='https://rpc.quai.network/cyprus1');
 assert(env.NS_WALLET_GRANT_ID&&env.NS_WALLET_RELAYER_KEY_FILE);
 const relayer=getAddress(env.NS_WALLET_RELAYER_ADDRESS);assert(/^0x00[0-7]/i.test(relayer));
 const signer=new Wallet((await readFile(env.NS_WALLET_RELAYER_KEY_FILE,'utf8')).trim());assert.equal(await signer.getAddress(),relayer);
 const secondary=createWalletRPC(fetch,env.NS_WALLET_SECONDARY_RPC);
 const preflight=createNativePreflight({binary:env.NS_WALLET_NATIVE_VERIFIER,binaryHash:env.NS_WALLET_NATIVE_VERIFIER_SHA256});
 async function verifyNetwork({rpc,block,relayer,wallet,accounts}){
  assert.equal(BigInt(await secondary('quai_chainId')),9n);await assertCanonicalBlock(secondary,block);
  const entries=[{address:relayer,storageKeys:[]},{address:wallet,storageKeys:[]}];
  assertSameAccounts(await captureAccounts(rpc,entries,block),await captureAccounts(secondary,entries,block));
  if(accounts)assertSameAccounts(accounts,await captureAccounts(secondary,accountEntries(accounts),block));
  return true;
 }
 async function sendRaw(raw){
  // Exactly one HTTP request. A timeout/error is ambiguous, never retried here.
  const r=await fetch('https://rpc.quai.network/cyprus1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'quai_sendRawTransaction',params:[raw]}),signal:AbortSignal.timeout(10000)});
  const data=await r.json();assert(r.ok&&data.id===1&&data.jsonrpc==='2.0'&&!data.error&&/^0x[0-9a-f]{64}$/i.test(data.result));return data.result;
 }
 const capabilities={chain,relayer,grantId:env.NS_WALLET_GRANT_ID,signer,sendRaw,preflight,verifyNetwork};
 const executor=createWalletExecutor(db,capabilities);
 if(env.NS_WALLET_SEND_ENABLED!=='true')executor.available=async()=>false;
 if(env.NS_WALLET_PROVISION_ENABLED==='true')executor.provisioner=createCloneProvisioner(db,capabilities);
 return executor;
}
