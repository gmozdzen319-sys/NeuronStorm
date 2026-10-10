// Explicit operator entry point for ONE reviewed test account. Never a worker.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {parseUnits} from 'quais';
import {openDatabase} from '../db/database.mjs';
import {WALLET_GENERATION,WALLET_INFRASTRUCTURE as infra,loadCloneWallet} from '../wallet-infrastructure.mjs';
import {createWalletChain} from './chain.mjs';
import {configuredExecutor} from './configured-executor.mjs';
export const ATTEMPT=Object.freeze({
 account:'914c577f-226c-4f1e-a7bb-2a4235f4a1a3',
 wallet:'0x0065826010d6134DBf24a6028237a27EDD1169f6',
 factory:'0x000958476ef4631e9B97Df63d9919779E3cb79cd',
 relayer:'0x001893151cDcc11372f6dd067e3424f47ad8534a',
 id:'receive-v2-80quai-20261010-wallet-1',
 spent:13992409594180906350n,limit:80000000000000000000n,
 activationCap:15000000000000000000n,margin:10000000000000000000n,
 principal:7000000000000000n
});
export function validateV2Quote(q,now=Date.now()){
 const a=ATTEMPT;assert.equal(q.accountId,a.account);assert.equal(q.address.toLowerCase(),a.wallet.toLowerCase());
 assert.equal(q.factory.toLowerCase(),a.factory.toLowerCase());assert.equal(q.chainId,9);
 const t=q.transaction;assert.equal(t.from.toLowerCase(),a.relayer.toLowerCase());assert.equal(t.to.toLowerCase(),a.factory.toLowerCase());
 assert.equal(BigInt(t.nonce),9n);assert.equal(BigInt(t.value),0n);assert.equal(BigInt(t.gas),330000n);assert.equal(BigInt(q.gasLimit),330000n);
 const price=BigInt(t.gasPrice);assert(price>0n&&price<=75000000000000n);
 const activation=price*330000n,remaining=price*1430000n+a.principal;
 assert(activation<=a.activationCap,'Activation exceeds 15 QUAI');assert(a.spent+remaining<=a.limit,'Whole test exceeds 80 QUAI');
 assert(parseUnits(q.balanceQuai,18)>=remaining+a.margin,'Complete remaining reserve and margin unavailable');
 assert.equal(parseUnits(q.maximumCostQuai,18),activation);
 assert(q.native&&!q.nativePreflightRequired&&q.approvalRequired&&q.broadcastAllowed===false);
 const age=now-Date.parse(q.quotedAt);assert(Number.isFinite(age)&&age>=0&&age<60000);
 return {activation,remaining};
}
export async function executeV2Once(db,provisioner,now=Date.now){
 const a=ATTEMPT;
 // A permanent unique grant is the no-retry lock, including STOP before send.
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,FALSE)').run(a.id,a.relayer,String(a.activationCap),now()+300000);
 try{
  const q=await provisioner.quote(a.account);validateV2Quote(q,now());
  await db.transaction(async()=>{
   const saved=await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1 FOR UPDATE').get(a.account);
   assert(saved&&saved.phase==='quoted'&&!saved.approved&&saved.commitment===q.commitment&&saved.expires_at>now());assert.deepEqual(JSON.parse(saved.quote),q);
   await db.prepare('UPDATE passkey_relayer_grants SET enabled=TRUE WHERE id=$1').run(a.id);
   await db.prepare('UPDATE passkey_clone_approvals SET approved=TRUE WHERE account_id=$1').run(a.account);
  });
  return await provisioner.execute(a.account);
 }finally{await db.prepare('UPDATE passkey_relayer_grants SET enabled=FALSE WHERE id=$1').run(a.id);}
}
async function main(){
 assert(process.argv.length===3&&process.argv[2]==='--execute-approved-once');assert.equal(WALLET_GENERATION,2);assert.equal(infra.factory,ATTEMPT.factory);
 for(const flag of ['NS_WALLET_AUTO_ACTIVATE','NS_WALLET_SEND_ENABLED','NS_WALLET_PROVISION_ENABLED'])assert.notEqual(process.env[flag],'true');
 assert.equal(process.env.NS_WALLET_NETWORK_POLICY,'official-single-source-v1');assert.equal(process.env.NS_WALLET_RELAYER_ADDRESS,ATTEMPT.relayer);
 const db=await openDatabase(process.env.DATABASE_URL);
 try{
  assert.equal((await db.prepare('SELECT * FROM passkey_relayer_lanes').all()).length,0);
  const row=await loadCloneWallet(db,ATTEMPT.account);assert(row&&row.revoked_at===null&&row.address===ATTEMPT.wallet.toLowerCase());
  const executor=await configuredExecutor(db,createWalletChain(),{...process.env,NS_WALLET_PROVISION_ENABLED:'true',NS_WALLET_SEND_ENABLED:'false',NS_WALLET_GRANT_ID:ATTEMPT.id,NS_WALLET_RELAYER_KEY_FILE:'/etc/secrets/neuron-relayer.key'});
  const result=await executeV2Once(db,executor.provisioner);
  const saved=await db.prepare('SELECT phase,tx_hash,receipt FROM passkey_clone_approvals WHERE account_id=$1').get(ATTEMPT.account);
  const receipt=JSON.parse(saved.receipt);console.log(JSON.stringify({result,phase:saved.phase,hash:saved.tx_hash,gasUsed:receipt.gasUsed,gasPrice:receipt.effectiveGasPrice,feeQuai:receipt.feeQuai,status:receipt.status,blockHash:receipt.blockHash}));
  assert.equal(result.status,'confirmed');
 }finally{await db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch(error){console.error('V2 ACTIVATION STOPPED. No automatic retry. Stage: '+(/^[A-Z_]+$/.test(error.provisioningStage??'')?error.provisioningStage:'OPERATOR_CHECK'));process.exitCode=1;}
}
