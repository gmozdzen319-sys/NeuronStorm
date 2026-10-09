import assert from 'node:assert/strict';
import {QuaiTransaction} from 'quais';
import {walletABI} from './chain.mjs';
import {operationDigest} from './operation.mjs';
import {PRICE_CAP,GAS_LIMIT,SAFETY_MARGIN,canonicalACL,bound,fingerprint} from './transaction-policy.mjs';
import {rpcTransaction} from './preflight.mjs';
import {validateBlock,assertCanonicalAdvance,assertCanonicalBlock,assertContextCompatible,assertSameAccounts,captureAccounts,accountEntries} from './head-guard.mjs';
import {waitCanonicalReceipt} from './receipt-confirmation.mjs';
import {observeStability} from './stabilization.mjs';

// All paid capabilities are injected server-side after a separate deployment
// review. No default/test key, automatic retry, replacement or recovery sender.
export function createWalletExecutor(db,{chain,relayer,grantId,signer,sendRaw,preflight,verifyNetwork,stabilize=observeStability,now=Date.now}){
 const rpc=chain.rpc,lower=x=>x.toLowerCase();
 const call=async(row,name,args,tag)=>walletABI.decodeFunctionResult(name,await rpc('quai_call',[{to:row.plan.address,data:walletABI.encodeFunctionData(name,args)},tag]));
 async function grant(){const g=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 AND enabled=TRUE AND expires_at>$2').get(grantId,now());assert(g&&lower(g.relayer)===lower(relayer),'No approved relayer budget');return g;}
 async function available(){if(!signer||!sendRaw||!preflight||!verifyNetwork)return false;try{await grant();return !await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(lower(relayer));}catch{return false;}}
 async function state(row){
  const view=await chain.snapshot(row.plan);assert(view.deployed);const block=validateBlock(await rpc('quai_getBlockByNumber',['latest',false]));await assertCanonicalAdvance(rpc,view.block,block);
  const tag=block.woHeader.number;
  const [nonce,pending,balance,walletBalance,wn,epoch,key,count,slots]=await Promise.all([
   rpc('quai_getTransactionCount',[relayer,tag]),rpc('quai_getTransactionCount',[relayer,'pending']),rpc('quai_getBalance',[relayer,tag]),rpc('quai_getBalance',[row.plan.address,tag]),
   call(row,'nonce',[],tag),call(row,'epoch',[],tag),call(row,'keys',[row.plan.keyId],tag),call(row,'keyCount',[],tag),call(row,'keySlotCount',[],tag)
  ]);
  assert.equal(BigInt(nonce),BigInt(pending));assert(BigInt(nonce)<=BigInt(Number.MAX_SAFE_INTEGER));assert.equal(wn[0].toString(),view.nonce);assert.equal(epoch[0].toString(),view.epoch);assert.equal(BigInt(walletBalance),BigInt(view.balanceWei));
  assert.equal(lower(key[0]),lower(row.plan.x));assert.equal(lower(key[1]),lower(row.plan.y));assert.equal(key[2],true);assert.equal(count[0],1n);assert.equal(slots[0],1n);
  await assertCanonicalBlock(rpc,block);
  // Separate production trust policy; a one-test RPC waiver is not reused.
  assert(await verifyNetwork({rpc,block,relayer,wallet:row.plan.address}), 'Production chain verification unavailable');
  return {block,nonce:String(BigInt(nonce)),balance:String(BigInt(balance)),walletBalance:String(BigInt(walletBalance)),walletNonce:String(wn[0]),epoch:String(epoch[0])};
 }
 async function budget(price,s){assert(price>0n&&price<=PRICE_CAP);const fee=price*GAS_LIMIT;const g=await grant();assert(BigInt(g.budget_wei)-BigInt(g.reserved_wei)>=fee);assert(BigInt(s.balance)>=fee+SAFETY_MARGIN);return fee;}
 const checkOperation=(op,s)=>{assert.equal(op.digest,operationDigest(op));assert.equal(op.walletNonce,s.walletNonce);assert.equal(op.epoch,s.epoch);assert(BigInt(op.amount)>0n&&BigInt(op.amount)<=BigInt(s.walletBalance));assert(BigInt(op.deadline)>BigInt(Math.floor(now()/1000))+30n);};
 async function prepare(row,operation){
  assert(await available());const stable=await stabilize({sources:[{name:'official Cyprus-1',rpc}],entries:[{address:relayer,storageKeys:[]},{address:row.plan.address,storageKeys:[]}]});assert(stable.stable);
  const s=await state(row);checkOperation(operation,s);
  const gasPrice=BigInt(await rpc('quai_gasPrice',[]));const maximumFeeWei=String(await budget(gasPrice,s));
  return {operation:structuredClone(operation),gasPrice:String(gasPrice),gasLimit:String(GAS_LIMIT),relayer,relayerNonce:s.nonce,relayerBalance:s.balance,walletBalance:s.walletBalance,maximumFeeWei};
 }
 async function execute({id,accountId,row,prepared,auth}){
  assert(await available());assert.equal(accountId,row.account_id);assert.equal(lower(prepared.relayer),lower(relayer));assert.equal(BigInt(prepared.gasLimit),GAS_LIMIT);
  const op=prepared.operation;assert.equal(op.wallet,row.plan.address);let s=await state(row);checkOperation(op,s);assert.equal(s.nonce,prepared.relayerNonce);
  assert.equal(s.balance,prepared.relayerBalance);assert.equal(s.walletBalance,prepared.walletBalance);
  const price=BigInt(prepared.gasPrice);assert.equal(String(await budget(price,s)),prepared.maximumFeeWei);
  const recipientBalance=BigInt(await rpc('quai_getBalance',[op.recipient,s.block.woHeader.number]));
  assert.equal((await call(row,'verifyProbe',[op.digest,auth,row.plan.x,row.plan.y],s.block.woHeader.number))[0],true);
  const tx={type:0,chainId:9,from:relayer,to:row.plan.address,nonce:s.nonce,value:'0',gasPrice:String(price),gasLimit:String(GAS_LIMIT),data:walletABI.encodeFunctionData('transferNative',[op.recipient,op.amount,op.deadline,row.plan.keyId,auth])};
  const acl=await rpc('quai_createAccessList',[rpcTransaction(tx),s.block.woHeader.number]);assert(!acl.error);tx.accessList=canonicalACL(acl.accessList);const commitment=fingerprint(bound(tx));
  let simulation=await preflight(rpc,tx,row,s.block);assert.equal(fingerprint(bound(tx)),commitment);
  async function gate(){
   const fresh=await state(row);checkOperation(op,fresh);assert.equal(fresh.nonce,s.nonce);assert.equal(fresh.balance,s.balance);
   await budget(price,fresh);await assertCanonicalAdvance(rpc,s.block,fresh.block);assertContextCompatible(s.block,fresh.block,tx,op);
   assertSameAccounts(simulation.accounts,await captureAccounts(rpc,accountEntries(simulation.accounts),fresh.block));
   const access=await rpc('quai_createAccessList',[rpcTransaction(tx),fresh.block.woHeader.number]);assert(!access.error);assert.deepEqual(canonicalACL(access.accessList),tx.accessList);
   const next=await preflight(rpc,tx,row,fresh.block);assertSameAccounts(simulation.accounts,next.accounts);assert.equal(fingerprint(bound(tx)),commitment);
   assert(await verifyNetwork({rpc,block:fresh.block,relayer,wallet:row.plan.address,accounts:next.accounts}));
   const tail=await state(row);checkOperation(op,tail);assert.equal(tail.nonce,fresh.nonce);assert.equal(tail.balance,fresh.balance);await budget(price,tail);
   await assertCanonicalAdvance(rpc,fresh.block,tail.block);assertContextCompatible(fresh.block,tail.block,tx,op);assertSameAccounts(next.accounts,await captureAccounts(rpc,accountEntries(next.accounts),tail.block));simulation=next;s=tail;
  }
  await gate();assert.equal(lower(await signer.getAddress()),lower(relayer));const raw=await signer.signTransaction(structuredClone(tx));
  const decode=()=>{const t=QuaiTransaction.from(raw);return {hash:t.hash,tx:{type:t.type,chainId:t.chainId,from:t.from,to:t.to,nonce:t.nonce,value:t.value,gasPrice:t.gasPrice,gasLimit:t.gasLimit,data:t.data,accessList:t.accessList}};};
  let signed=decode();assert.deepEqual(bound(signed.tx),bound(tx));assert(/^0x[0-9a-f]{64}$/i.test(signed.hash));await gate();signed=decode();assert.deepEqual(bound(signed.tx),bound(tx));
  // Hold only short DB transactions. The persistent unique relayer intent blocks
  // concurrent spend and restart/resubmission after any ambiguous result.
  await db.transaction(async()=>{
   const g=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(grantId);const maximum=price*GAS_LIMIT;
   assert(g?.enabled&&g.expires_at>now()&&BigInt(g.budget_wei)-BigInt(g.reserved_wei)>=maximum);
   const saved=await db.prepare("SELECT * FROM passkey_native_operations WHERE id=$1 AND account_id=$2 AND phase='authorized' FOR UPDATE").get(id,accountId);
   assert(saved&&saved.plan===JSON.stringify(prepared)&&saved.assertion===JSON.stringify(auth)&&saved.expires_at>now());
   const credential=await db.prepare('SELECT revoked_at FROM passkey_credentials WHERE id=$1 AND account_id=$2 FOR UPDATE').get(row.credential_id,accountId);assert(credential&&credential.revoked_at===null);
   await db.prepare("INSERT INTO passkey_relayer_lanes VALUES($1,$2,'send')").run(lower(relayer),id);
   await db.prepare("INSERT INTO passkey_relayer_intents VALUES($1,$2,$3,$4,$5,$6,$7,'submitting')").run(id,lower(relayer),s.nonce,signed.hash,JSON.stringify(bound(tx)),grantId,String(maximum));
   await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei+$1 WHERE id=$2').run(String(maximum),grantId);
   await db.prepare("UPDATE passkey_native_operations SET phase='submitting',tx_hash=$1 WHERE id=$2").run(signed.hash,id);
  });
  // Any failure after the durable intent needs read-only investigation. No retry.
  assert.equal(lower(await sendRaw(raw)),lower(signed.hash));
  const confirmed=await waitCanonicalReceipt(rpc,signed.hash,{confirmations:3,timeoutMs:180000,pollMs:2000,maxPolls:90});const receipt=confirmed.receipt;
  const mined=await rpc('quai_getTransactionByHash',[signed.hash]);assert(mined);
  assert.deepEqual(bound({type:mined.type,chainId:mined.chainId,from:mined.from,to:mined.to,nonce:mined.nonce,value:mined.value,gasPrice:mined.gasPrice,gasLimit:mined.gas??mined.gasLimit,data:mined.input??mined.data,accessList:mined.accessList}),bound(tx));
  assert.equal(BigInt(receipt.effectiveGasPrice??mined.gasPrice),price);assert(BigInt(receipt.gasUsed)<=GAS_LIMIT);
  const success=BigInt(receipt.status)===1n;
  // Nonce and wallet effects at the canonical receipt block, not at an unstable tip.
  const tag=receipt.blockNumber;const receiptBlock=validateBlock(await rpc('quai_getBlockByNumber',[tag,false]));assert.equal(receiptBlock.hash,receipt.blockHash);
  assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,tag])),BigInt(tx.nonce)+1n);
  assert.equal((await call(row,'nonce',[],tag))[0],BigInt(op.walletNonce)+(success?1n:0n));await assertCanonicalBlock(rpc,receiptBlock);
  const fee=BigInt(receipt.gasUsed)*price;
  const amount=success?BigInt(op.amount):0n;
  assert.equal(BigInt(await rpc('quai_getBalance',[row.plan.address,tag])),BigInt(s.walletBalance)-amount,'Wallet balance effect mismatch');
  assert.equal(BigInt(await rpc('quai_getBalance',[relayer,tag])),BigInt(s.balance)-fee+(lower(op.recipient)===lower(relayer)?amount:0n),'Relayer balance effect mismatch');
  if(lower(op.recipient)!==lower(relayer))assert.equal(BigInt(await rpc('quai_getBalance',[op.recipient,tag])),recipientBalance+amount,'Recipient balance effect mismatch');
  await assertCanonicalBlock(rpc,receiptBlock);
  assert(await verifyNetwork({rpc,block:receiptBlock,relayer,wallet:row.plan.address}),'Receipt network verification failed');
  await db.transaction(async()=>{
   await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei-$1 WHERE id=$2').run(String(price*GAS_LIMIT-fee),grantId);
   await db.prepare('UPDATE passkey_relayer_intents SET phase=$1 WHERE operation_id=$2').run(success?'confirmed':'failed',id);
   await db.prepare('UPDATE passkey_native_operations SET phase=$1,receipt=$2 WHERE id=$3').run(success?'confirmed':'failed',JSON.stringify({transactionHash:signed.hash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,status:receipt.status,gasUsed:String(BigInt(receipt.gasUsed)),gasPrice:String(price),feeWei:String(fee),confirmations:confirmed.confirmations,finalityProven:false}),id);
   await db.prepare('DELETE FROM passkey_relayer_lanes WHERE relayer=$1 AND reference=$2').run(lower(relayer),id);
  });
 }
 return {available,prepare,execute};
}
