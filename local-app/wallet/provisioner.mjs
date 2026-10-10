import assert from 'node:assert/strict';
import {QuaiTransaction,formatUnits} from 'quais';
import {WALLET_INFRASTRUCTURE as infra,loadCloneWallet} from '../wallet-infrastructure.mjs';
import {factoryABI} from './chain.mjs';
import {factoryStorageContext} from './factory-context.mjs';
import {quoteProvisioning} from './provisioning-quote.mjs';
import {bound,canonicalACL,PRICE_CAP,SAFETY_MARGIN,fingerprint} from './transaction-policy.mjs';
import {rpcTransaction} from './preflight.mjs';
import {validateBlock,assertCanonicalBlock,assertCanonicalAdvance,assertContextCompatible,captureAccounts,accountEntries,assertSameAccounts} from './head-guard.mjs';
import {waitCanonicalReceipt} from './receipt-confirmation.mjs';
import {observeStability} from './stabilization.mjs';
const LIMIT=330000n,low=s=>s.toLowerCase();
export function createCloneProvisioner(db,{chain,relayer,grantId,signer,sendRaw,preflight,verifyNetwork,stabilize=observeStability,now=Date.now}){
 const rpc=chain.rpc;
 async function quote(accountId){
  const result=await quoteProvisioning(db,{accountId,relayer,chain,preflight,now});
  assert(!result.alreadyProvisioned&&result.native&&!result.nativePreflightRequired);
  // Preparing a quote never approves it; there is no public approval endpoint.
  await db.transaction(async()=>{
   await db.prepare('SELECT account_id FROM passkey_clone_wallets WHERE account_id=$1 FOR UPDATE').get(accountId);
   const prior=await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1').get(accountId);
   assert(!prior||['stopped','failed'].includes(prior.phase)||(prior.phase==='quoted'&&prior.expires_at<=now()),'An earlier approval requires review');
   // This explicit operator quote can replace an expired/stopped quote only.
   // Trigger-backed history retains every prior approval, hash and receipt.
   await db.prepare("INSERT INTO passkey_clone_approvals(account_id,quote,commitment,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(account_id) DO UPDATE SET quote=excluded.quote,commitment=excluded.commitment,expires_at=excluded.expires_at,approved=FALSE,phase='quoted',tx_hash=NULL,receipt=NULL").run(accountId,JSON.stringify(result),result.commitment,now()+120000);
  });
  return result;
 }
 async function execute(accountId){
  // Durable single attempt. Expiry/STOP never re-enters the queue automatically.
  const approval=await db.prepare("UPDATE passkey_clone_approvals SET phase='preparing' WHERE account_id=$1 AND approved=TRUE AND phase='quoted' AND expires_at>$2 RETURNING *").get(accountId,now());
  if(!approval)throw Error('A fresh separately approved wallet quote is required');
  let stage='STABILIZATION';
  try{
   const stable=await stabilize({sources:[{name:'official Cyprus-1',rpc}],entries:[{address:relayer,storageKeys:[]},{address:infra.factory,storageKeys:[]}]});assert(stable.stable);
   stage='SAVED_PLAN';
   const quote=JSON.parse(approval.quote),row=await loadCloneWallet(db,accountId);assert(row&&row.revoked_at===null&&quote.accountId===accountId&&low(quote.address)===row.address);
   assert.equal(quote.commitment,approval.commitment);assert.equal(quote.commitment,fingerprint({transaction:quote.transaction,address:row.plan.address,blockHash:quote.blockHash}));assert(quote.native&&!quote.nativePreflightRequired&&quote.approvalRequired&&quote.broadcastAllowed===false);
   const src=quote.transaction,tx={type:0,chainId:9,from:relayer,to:infra.factory,nonce:String(BigInt(src.nonce)),value:'0',data:factoryABI.encodeFunctionData('createWallet',[row.plan.x,row.plan.y,row.plan.grind]),gasPrice:String(BigInt(src.gasPrice)),gasLimit:String(LIMIT),accessList:canonicalACL(src.accessList)};
   assert.equal(low(src.from),low(relayer));assert.equal(low(src.to),low(infra.factory));assert.equal(src.data,tx.data);assert.equal(BigInt(src.value),0n);assert.equal(BigInt(src.gas),LIMIT);bound(tx,LIMIT);
   const price=BigInt(tx.gasPrice),reserve=price*LIMIT;assert(price>0n&&price<=PRICE_CAP);assert.equal(quote.chainId,9);assert.equal(quote.factory,infra.factory);assert.equal(quote.implementation,infra.implementation);assert.equal(quote.maximumCostQuai,formatUnits(reserve,18));const commitment=fingerprint(bound(tx,LIMIT));let snapshot=quote.native;
   async function gate(){
    stage='EXPIRY_AND_WALLET_STATE';
    assert(approval.expires_at>now());const observed=await chain.snapshot(row.plan);assert(!observed.deployed,'Already provisioned; do not redeploy');
    stage='CANONICAL_CONTEXT';
    const block=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));await assertCanonicalAdvance(rpc,observed.block,block);await assertCanonicalAdvance(rpc,snapshot.block,block);assertContextCompatible(snapshot.block,block,tx,{});
    stage='CHAIN_AND_NONCE';
    const tag=block.woHeader.number;assert.equal(BigInt(await rpc('quai_chainId')),9n);
    assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,tag])),BigInt(tx.nonce));assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,'pending'])),BigInt(tx.nonce));
    stage='BALANCE_AND_GRANT';
    assert(BigInt(await rpc('quai_getBalance',[relayer,tag]))>=reserve+SAFETY_MARGIN);
    const grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 AND enabled=TRUE AND expires_at>$2').get(grantId,now());assert(grant&&low(grant.relayer)===low(relayer)&&BigInt(grant.budget_wei)-BigInt(grant.reserved_wei)>=reserve);
    stage='ACCOUNT_SNAPSHOT';
    assertSameAccounts(snapshot.accounts,await captureAccounts(rpc,accountEntries(snapshot.accounts),block));
    stage='ACCESS_LIST';
    const acl=await rpc('quai_createAccessList',[rpcTransaction(tx),tag]);assert(!acl.error);assert.deepEqual(canonicalACL(acl.accessList),tx.accessList);
    stage='NATIVE_PREFLIGHT';
    const factoryStorageKeys=await factoryStorageContext(rpc,block);const fresh=await preflight(rpc,tx,{...row,factoryStorageKeys},block);
    assertSameAccounts(snapshot.accounts,fresh.accounts);assert.equal(low(factoryABI.decodeFunctionResult('createWallet',fresh.returnValue)[0]),row.address);
    stage='NETWORK_VERIFICATION';
    assert(await verifyNetwork({rpc,block,relayer,wallet:row.plan.address,accounts:fresh.accounts}));await assertCanonicalBlock(rpc,block);assert.equal(fingerprint(bound(tx,LIMIT)),commitment);snapshot=fresh;
   }
   await gate();stage='SIGNING';assert.equal(low(await signer.getAddress()),low(relayer));const raw=await signer.signTransaction(structuredClone(tx));
   const signed=QuaiTransaction.from(raw),decoded={type:signed.type,chainId:signed.chainId,from:signed.from,to:signed.to,nonce:signed.nonce,value:signed.value,data:signed.data,gasPrice:signed.gasPrice,gasLimit:signed.gasLimit,accessList:signed.accessList};assert.deepEqual(bound(decoded,LIMIT),bound(tx,LIMIT));await gate();
   stage='DURABLE_SEND_INTENT';
   await db.transaction(async()=>{
    const current=await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1 FOR UPDATE').get(accountId);assert(current.approved&&current.phase==='preparing'&&current.quote===approval.quote&&current.expires_at>now());
    const grant=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(grantId);assert(grant.enabled&&grant.expires_at>now()&&low(grant.relayer)===low(relayer)&&BigInt(grant.budget_wei)-BigInt(grant.reserved_wei)>=reserve);
    await db.prepare("INSERT INTO passkey_relayer_lanes VALUES($1,$2,'provision')").run(low(relayer),accountId);
    await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei+$1 WHERE id=$2').run(String(reserve),grantId);
    await db.prepare("UPDATE passkey_clone_approvals SET phase='submitting',tx_hash=$1 WHERE account_id=$2").run(signed.hash,accountId);
   });
   stage='BROADCAST';
   assert.equal(low(await sendRaw(raw)),low(signed.hash));
   // Receive reads an anchor three blocks behind the tip. Four observations put
   // the deployment at/before that anchor; this is not a PoEM finality claim.
   stage='RECEIPT_VERIFICATION';
   const result=await waitCanonicalReceipt(rpc,signed.hash,{confirmations:4,timeoutMs:180000,pollMs:2000,maxPolls:90}),receipt=result.receipt;
   const mined=await rpc('quai_getTransactionByHash',[signed.hash]);assert(mined);assert.deepEqual(bound({type:mined.type,chainId:mined.chainId,from:mined.from,to:mined.to,nonce:mined.nonce,value:mined.value,data:mined.input??mined.data,gasPrice:mined.gasPrice,gasLimit:mined.gas??mined.gasLimit,accessList:mined.accessList},LIMIT),bound(tx,LIMIT));
   assert(BigInt(receipt.gasUsed)>0n&&BigInt(receipt.gasUsed)<=LIMIT);assert.equal(BigInt(receipt.effectiveGasPrice??mined.gasPrice),price);const success=BigInt(receipt.status)===1n;
   const block=validateBlock(await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]));assert.equal(block.hash,receipt.blockHash);assert(await verifyNetwork({rpc,block,relayer,wallet:row.plan.address}));
   assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,receipt.blockNumber])),BigInt(tx.nonce)+1n);
   if(success){const confirmed=await chain.snapshot(row.plan);assert(confirmed.deployed&&confirmed.nonce==='0'&&confirmed.epoch==='0');}
   const fee=BigInt(receipt.gasUsed)*price;
   await db.transaction(async()=>{
    await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei-$1 WHERE id=$2').run(String(reserve-fee),grantId);
    await db.prepare('UPDATE passkey_clone_approvals SET phase=$1,receipt=$2 WHERE account_id=$3').run(success?'confirmed':'failed',JSON.stringify({...receipt,feeWei:String(fee),feeQuai:formatUnits(fee,18),finalityProven:false}),accountId);
    await db.prepare('DELETE FROM passkey_relayer_lanes WHERE relayer=$1 AND reference=$2').run(low(relayer),accountId);
   });
   return {address:row.plan.address,transactionHash:signed.hash,status:success?'confirmed':'failed'};
  }catch(error){await db.prepare("UPDATE passkey_clone_approvals SET phase='stopped' WHERE account_id=$1 AND phase='preparing'").run(accountId);error.provisioningStage=stage;throw error;}
 }
 return {quote,execute};
}
