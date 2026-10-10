// Operator-only one-shot activation. Never imported by the web server.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {Wallet,parseUnits} from 'quais';
import {openDatabase} from '../db/database.mjs';
import {loadCloneWallet} from '../wallet-infrastructure.mjs';
import {createWalletChain} from './chain.mjs';
import {createNativePreflight} from './preflight.mjs';
import {quoteProvisioning} from './provisioning-quote.mjs';
import {configuredExecutor} from './configured-executor.mjs';
import {createNetworkVerification} from './network-verification.mjs';

export const ACTIVATION={accountId:'914c577f-226c-4f1e-a7bb-2a4235f4a1a3',wallet:'0x006A5B2cc0003770fAAEcF53e0Be63eCf115cA60',relayer:'0x001893151cDcc11372f6dd067e3424f47ad8534a',attemptId:'activation-914c577f-15quai-20261010-1',maximumWei:15000000000000000000n};
export function validateActivationQuote(q,now=Date.now()){
 assert.equal(q.accountId,ACTIVATION.accountId);assert.equal(q.address.toLowerCase(),ACTIVATION.wallet.toLowerCase());assert.equal(q.chainId,9);
 assert.equal(q.transaction.from.toLowerCase(),ACTIVATION.relayer.toLowerCase());assert.equal(BigInt(q.transaction.value),0n);
 assert.equal(BigInt(q.gasLimit),330000n);assert.equal(BigInt(q.transaction.gas),330000n);
 const reserve=BigInt(q.transaction.gasPrice)*330000n;
 assert(reserve>0n&&reserve<=ACTIVATION.maximumWei,'15 QUAI maximum exceeded');
 assert.equal(parseUnits(q.maximumCostQuai,18),reserve);assert(parseUnits(q.balanceQuai,18)>=reserve+10000000000000000000n);
 assert(q.native&&!q.nativePreflightRequired&&q.approvalRequired&&q.broadcastAllowed===false);
 const age=now-Date.parse(q.quotedAt);assert(Number.isFinite(age)&&age>=0&&age<60000,'Quote stale');
 return reserve;
}
export async function activateOnce(db,{provisioner,now=Date.now}){
 // This permanent unique grant ID is also the attempt lock. Never delete it,
 // even after a STOP, crash or an ambiguous send. Re-running cannot retry.
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,FALSE)').run(ACTIVATION.attemptId,ACTIVATION.relayer,String(ACTIVATION.maximumWei),now()+300000);
 try{
  const q=await provisioner.quote(ACTIVATION.accountId);validateActivationQuote(q,now());
  await db.transaction(async()=>{
   const saved=await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1 FOR UPDATE').get(ACTIVATION.accountId);
   assert(saved&&saved.phase==='quoted'&&!saved.approved&&saved.commitment===q.commitment&&saved.expires_at>now());
   assert.deepEqual(JSON.parse(saved.quote),q);
   await db.prepare('UPDATE passkey_relayer_grants SET enabled=TRUE WHERE id=$1').run(ACTIVATION.attemptId);
   await db.prepare('UPDATE passkey_clone_approvals SET approved=TRUE WHERE account_id=$1').run(ACTIVATION.accountId);
  });
  return await provisioner.execute(ACTIVATION.accountId);
 }finally{
  await db.prepare('UPDATE passkey_relayer_grants SET enabled=FALSE WHERE id=$1').run(ACTIVATION.attemptId);
 }
}
async function main(){
 assert(['--check','--execute-once'].includes(process.argv[2])&&process.argv.length===3);
 assert.equal(process.env.NS_WALLET_NETWORK_POLICY,'official-single-source-v1');
 assert.notEqual(process.env.NS_WALLET_SEND_ENABLED,'true');assert.notEqual(process.env.NS_WALLET_PROVISION_ENABLED,'true');
 assert.equal(process.env.NS_WALLET_RELAYER_ADDRESS,ACTIVATION.relayer);
 const keyFile='/etc/secrets/neuron-relayer.key';let key=(await readFile(keyFile,'utf8')).trim();assert(/^0x[0-9a-f]{64}$/i.test(key));
 const signer=new Wallet(key);key='';assert.equal(signer.address,ACTIVATION.relayer);
 const db=await openDatabase(process.env.DATABASE_URL);
 try{
  const row=await loadCloneWallet(db,ACTIVATION.accountId);assert(row&&row.address===ACTIVATION.wallet.toLowerCase()&&row.revoked_at===null);
  const chain=createWalletChain();
  if(process.argv[2]==='--check'){
   const preflight=createNativePreflight({binary:process.env.NS_WALLET_NATIVE_VERIFIER,binaryHash:process.env.NS_WALLET_NATIVE_VERIFIER_SHA256});
   const q=await quoteProvisioning(db,{accountId:ACTIVATION.accountId,relayer:ACTIVATION.relayer,chain,preflight});validateActivationQuote(q);
   assert(await createNetworkVerification(process.env)({rpc:chain.rpc,block:q.native.block,relayer:ACTIVATION.relayer,wallet:q.address,accounts:q.native.accounts}));
   console.log(JSON.stringify({status:'READY_FOR_MANUAL_ONE_SHOT',signerAddress:signer.address,wallet:q.address,gas:q.gasUsed,estimate:q.gasEstimate,gasLimit:q.gasLimit,gasPriceWei:q.gasPriceWei,expectedCostQuai:q.expectedCostQuai,maximumCostQuai:q.maximumCostQuai,authorizedMaximumQuai:'15',balanceQuai:q.balanceQuai,broadcasts:0}));return;
  }
  // Flags apply only to this explicit operator process. The web server and its
  // automatic workers stay disabled. Existing preflight/journal/sender is reused.
  const executor=await configuredExecutor(db,chain,{...process.env,NS_WALLET_SEND_ENABLED:'false',NS_WALLET_PROVISION_ENABLED:'true',NS_WALLET_RELAYER_KEY_FILE:keyFile,NS_WALLET_GRANT_ID:ACTIVATION.attemptId});
  const result=await activateOnce(db,{provisioner:executor.provisioner});
  const saved=await db.prepare('SELECT phase,tx_hash,receipt FROM passkey_clone_approvals WHERE account_id=$1').get(ACTIVATION.accountId);
  console.log(JSON.stringify({result,...saved,authorizedMaximumQuai:'15'}));
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{
  // Never serialize SDK errors: invalid secret input may be embedded in them.
  console.error('ACTIVATION STOPPED. Inspect the durable approval/receipt before any further action. No automatic retry.');process.exitCode=1;
 }
}
