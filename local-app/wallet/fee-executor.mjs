import {releaseUnbroadcastSend} from './send-reservation.mjs';
import {sendStage,sendStopped} from './send-diagnostics.mjs';
import assert from 'node:assert/strict';
import {QuaiTransaction} from 'quais';
import {walletABI} from './chain.mjs';
import {feeDigest,quotedFee,ZERO_TOKEN,validateFeeExecution} from './fee-operation.mjs';
import {feeWalletABI,feeAccessList as canonicalACL,boundFeeTransaction as bound,reserveFee} from './fee-plan.mjs';
import {Interface} from 'quais';
import {SAFETY_MARGIN,fingerprint} from './transaction-policy.mjs';
import {validateBlock,assertCanonicalAdvance,assertCanonicalBlock,assertContextCompatible,assertSameAccounts,captureAccounts,accountEntries} from './head-guard.mjs';
import {waitCanonicalReceipt} from './receipt-confirmation.mjs';
import {observeStability} from './stabilization.mjs';

// All paid capabilities are injected server-side after a separate deployment
// review. No default/test key, automatic retry, replacement or recovery sender.
export function createFeeExecutor(db,{chain,relayer,grantId,signer,sendRaw,preflight,verifyNetwork,estimateQuote,stabilize=observeStability,now=Date.now}){
 const rpc=chain.rpc,lower=x=>x.toLowerCase();
 const call=async(row,name,args,tag)=>walletABI.decodeFunctionResult(name,await rpc('quai_call',[{to:row.plan.address,data:walletABI.encodeFunctionData(name,args)},tag]));
 async function grant(){const g=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 AND enabled=TRUE AND expires_at>$2').get(grantId,now());assert(g&&lower(g.relayer)===lower(relayer),'No approved relayer budget');return g;}
 async function available(){if(!signer||!sendRaw||!preflight||!verifyNetwork||!estimateQuote)return false;try{await grant();return !await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(lower(relayer));}catch{return false;}}
 async function unavailableReason(){
  try{
   const g=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1').get(grantId);
   if(g&&g.expires_at<=now())return 'The controlled sending window has expired. No transaction was sent. Contact support to arrange a new test window.';
   if(await db.prepare('SELECT reference FROM passkey_relayer_lanes WHERE relayer=$1').get(lower(relayer)))return 'An earlier transaction is being checked. Do not submit it again.';
  }catch{}
  return 'Sending is temporarily unavailable. Your funds remain in your wallet.';
 }
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
 const tokenABI=new Interface(['function balanceOf(address) view returns(uint256)']);
 const tokenBalance=async(token,owner,tag)=>String(tokenABI.decodeFunctionResult('balanceOf',await rpc('quai_call',[{to:token,data:tokenABI.encodeFunctionData('balanceOf',[owner])},tag]))[0]);
 async function budget(price,s,gasLimit){const g=await grant();return BigInt(reserveFee({gasPrice:price,gasLimit,relayerBalance:s.balance,remainingBudget:BigInt(g.budget_wei)-BigInt(g.reserved_wei),safetyMargin:SAFETY_MARGIN}));}
 const checkOperation=(op,s)=>{assert.equal(op.digest,feeDigest(op));assert.equal(op.walletNonce,s.walletNonce);assert.equal(op.epoch,s.epoch);assert.equal(lower(op.quote.relayer),lower(relayer));assert(BigInt(op.deadline)>BigInt(Math.floor(now()/1000))+30n);};
 async function quote(row,operation){
  assert(await available());assert.equal(row.generation,3);
  sendStage('quote.stabilization');
  const stable=await stabilize({sources:[{name:'official Cyprus-1',rpc}],entries:[{address:relayer,storageKeys:[]},{address:row.plan.address,storageKeys:[]}]});assert(stable.stable);
  const s=await state(row);assert.equal(operation.walletNonce,s.walletNonce);assert.equal(operation.epoch,s.epoch);
  const gasPrice=BigInt(await rpc('quai_gasPrice',[]));assert(gasPrice>0n);
  // The estimator is a server-only dependency. Its quote is not proof of final
  // signature execution: exact native execution on pinned RPC state is mandatory.
  sendStage('quote.estimation');
  const estimate=await estimateQuote({rpc,row,operation:structuredClone(operation),state:structuredClone(s),gasPrice:String(gasPrice),relayer});
  const gasLimit=BigInt(estimate.gasLimit),estimatedGas=BigInt(estimate.estimatedGas);
  assert(estimatedGas>0n&&gasLimit>=estimatedGas);assert(gasLimit<=BigInt(s.block.header.gasLimit));
  sendStage('quote.reserve');
  const maximumFeeWei=String(await budget(gasPrice,s,gasLimit));
  return {relayer,gasPrice:String(gasPrice),gasLimit:String(gasLimit),networkFee:String(estimatedGas*gasPrice),estimatedGas:String(estimatedGas),maximumFeeWei,state:s};
 }
 async function prepare(row,operation,view,pricing){
  assert(await available());assert.equal(row.generation,3);assert.equal(operation.quote.networkFee,pricing.networkFee);assert.equal(operation.quote.gasPrice,pricing.gasPrice);
  const s=await state(row);checkOperation(operation,s);assert.equal(s.nonce,pricing.state.nonce);assert.equal(s.balance,pricing.state.balance);assert.equal(s.walletBalance,pricing.state.walletBalance);
  await assertCanonicalAdvance(rpc,pricing.state.block,s.block);
  const token=operation.quote.token,tokenFunds=token===ZERO_TOKEN?null:await tokenBalance(token,row.plan.address,s.block.woHeader.number);
  validateFeeExecution(operation,{estimatedGas:pricing.estimatedGas,gasLimit:pricing.gasLimit,gasPrice:pricing.gasPrice,walletQuai:s.walletBalance,tokenBalance:tokenFunds});
  assert.equal(String(await budget(BigInt(pricing.gasPrice),s,pricing.gasLimit)),pricing.maximumFeeWei);
  return {operation:structuredClone(operation),gasPrice:pricing.gasPrice,gasLimit:pricing.gasLimit,relayer,relayerNonce:s.nonce,relayerBalance:s.balance,walletBalance:s.walletBalance,tokenBalance:tokenFunds,maximumFeeWei:pricing.maximumFeeWei};
 }
 async function execute({id,accountId,row,prepared,auth}){
  sendStage('execute.availability');
  assert(await available());assert.equal(accountId,row.account_id);assert.equal(lower(prepared.relayer),lower(relayer));assert.equal(row.generation,3);const gasLimit=BigInt(prepared.gasLimit);assert(gasLimit>0n);
  sendStage('execute.state_and_operation');
  const op=prepared.operation;assert.equal(op.wallet,row.plan.address);let s=await state(row);checkOperation(op,s);assert.equal(s.nonce,prepared.relayerNonce);
  assert.equal(s.balance,prepared.relayerBalance);assert.equal(s.walletBalance,prepared.walletBalance);
  sendStage('execute.reserve');
  const price=BigInt(prepared.gasPrice);assert.equal(String(await budget(price,s,gasLimit)),prepared.maximumFeeWei);
  sendStage('execute.recipient_and_token');
  const recipient=op.quote.recipient,token=op.quote.token;const recipientBalance=BigInt(await rpc('quai_getBalance',[recipient,s.block.woHeader.number]));
  const tokenBefore=token===ZERO_TOKEN?null:{wallet:await tokenBalance(token,op.wallet,s.block.woHeader.number),recipient:await tokenBalance(token,recipient,s.block.woHeader.number)};
  if(tokenBefore)assert.equal(tokenBefore.wallet,prepared.tokenBalance);
  sendStage('execute.passkey_contract');
  assert.equal((await call(row,'verifyProbe',[op.digest,auth,row.plan.x,row.plan.y],s.block.woHeader.number))[0],true);
  const tx={type:0,chainId:9,from:relayer,to:row.plan.address,nonce:s.nonce,value:'0',gasPrice:String(price),gasLimit:String(gasLimit),data:feeWalletABI.encodeFunctionData('sendQuoted',[op.quote,op.deadline,row.plan.keyId,auth])};
  const unlisted=JSON.stringify(tx);
  sendStage('execute.preflight');
  let simulation=await preflight(rpc,tx,row,s.block);
  assert.equal(JSON.stringify(tx),unlisted,'Preflight mutated transaction');
  tx.accessList=canonicalACL(simulation.accessList);const commitment=fingerprint(bound(tx));
  const validateSimulation=sim=>validateFeeExecution(op,{estimatedGas:sim.gasUsed,gasLimit,gasPrice:price,walletQuai:s.walletBalance,tokenBalance:tokenBefore?.wallet});
  sendStage('execute.quote_validation');
  validateSimulation(simulation);assert.equal(fingerprint(bound(tx)),commitment);
  async function gate(){
   sendStage('gate.fresh_state');
   const fresh=await state(row);checkOperation(op,fresh);assert.equal(fresh.nonce,s.nonce);assert.equal(fresh.balance,s.balance);
   sendStage('gate.reserve_and_ancestry');
   await budget(price,fresh,gasLimit);await assertCanonicalAdvance(rpc,s.block,fresh.block);assertContextCompatible(s.block,fresh.block,tx,op);
   sendStage('gate.accounts');
   assertSameAccounts(simulation.accounts,await captureAccounts(rpc,accountEntries(simulation.accounts),fresh.block));
   sendStage('gate.exact_preflight');
   const next=await preflight(rpc,tx,row,fresh.block);assert.deepEqual(canonicalACL(next.accessList),tx.accessList);validateSimulation(next);assertSameAccounts(simulation.accounts,next.accounts);assert.equal(fingerprint(bound(tx)),commitment);
   sendStage('gate.network');
   assert(await verifyNetwork({rpc,block:fresh.block,relayer,wallet:row.plan.address,accounts:next.accounts}));
   sendStage('gate.final_state');
   const tail=await state(row);checkOperation(op,tail);assert.equal(tail.nonce,fresh.nonce);assert.equal(tail.balance,fresh.balance);await budget(price,tail,gasLimit);
   sendStage('gate.final_ancestry');
   await assertCanonicalAdvance(rpc,fresh.block,tail.block);assertContextCompatible(fresh.block,tail.block,tx,op);assertSameAccounts(next.accounts,await captureAccounts(rpc,accountEntries(next.accounts),tail.block));simulation=next;s=tail;
  }
  await gate();sendStage('execute.sign');assert.equal(lower(await signer.getAddress()),lower(relayer));const raw=await signer.signTransaction(structuredClone(tx));
  const decode=()=>{const t=QuaiTransaction.from(raw);return {hash:t.hash,tx:{type:t.type,chainId:t.chainId,from:t.from,to:t.to,nonce:t.nonce,value:t.value,gasPrice:t.gasPrice,gasLimit:t.gasLimit,data:t.data,accessList:t.accessList}};};
  sendStage('execute.signed_plan');
  let signed=decode();assert.deepEqual(bound(signed.tx),bound(tx));assert(/^0x[0-9a-f]{64}$/i.test(signed.hash));await gate();signed=decode();assert.deepEqual(bound(signed.tx),bound(tx));
  // Hold only short DB transactions. The persistent unique relayer intent blocks
  // concurrent spend and restart/resubmission after any ambiguous result.
  sendStage('execute.journal');
  await db.transaction(async()=>{
   const g=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1 FOR UPDATE').get(grantId);const maximum=price*gasLimit;
   assert(g?.enabled&&g.expires_at>now()&&BigInt(g.budget_wei)-BigInt(g.reserved_wei)>=maximum);
   const saved=await db.prepare("SELECT * FROM passkey_native_operations WHERE id=$1 AND account_id=$2 AND phase='authorized' FOR UPDATE").get(id,accountId);
   assert(saved&&saved.plan===JSON.stringify(prepared)&&saved.assertion===JSON.stringify(auth)&&saved.expires_at>now());
   const credential=await db.prepare('SELECT revoked_at FROM passkey_credentials WHERE id=$1 AND account_id=$2 FOR UPDATE').get(row.credential_id,accountId);assert(credential&&credential.revoked_at===null);
   await db.prepare("INSERT INTO passkey_relayer_lanes VALUES($1,$2,'send')").run(lower(relayer),id);
   await db.prepare("INSERT INTO passkey_relayer_intents(operation_id,relayer,nonce,tx_hash,transaction_plan,grant_id,maximum_fee_wei,phase,broadcast_started) VALUES($1,$2,$3,$4,$5,$6,$7,'submitting',FALSE)").run(id,lower(relayer),s.nonce,signed.hash,JSON.stringify(bound(tx)),grantId,String(maximum));
   await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei+$1 WHERE id=$2').run(String(maximum),grantId);
   // Keep the operation authorized until the durable broadcast boundary.
  });
  // Only a proven pre-broadcast exception may release this reservation.
  // Close the gap between the pre-sign checks and acquiring the shared lane:
  // another completed sender may have consumed this nonce in that interval.
  // The reserve is already debited, so do not count it a second time here.
  try{
  sendStage('execute.locked_state');
  const locked=await state(row);checkOperation(op,locked);
  assert.equal(locked.nonce,s.nonce);assert.equal(locked.balance,s.balance);assert.equal(locked.walletBalance,s.walletBalance);
  await assertCanonicalAdvance(rpc,s.block,locked.block);assertContextCompatible(s.block,locked.block,tx,op);
  assertSameAccounts(simulation.accounts,await captureAccounts(rpc,accountEntries(simulation.accounts),locked.block));
  assert.equal(fingerprint(bound(tx)),commitment);s=locked;
  }catch(error){
   sendStopped(error);
   await releaseUnbroadcastSend(db,{id,grantId,relayer:lower(relayer),hash:signed.hash});
   throw error;
  }
  // Commit the uncertainty boundary BEFORE calling the network. A crash or
  // thrown sendRaw after this point retains the lane, hash and full reserve.
  sendStage('execute.broadcast_boundary');
  await db.transaction(async()=>{
   const intent=await db.prepare("UPDATE passkey_relayer_intents SET broadcast_started=TRUE WHERE operation_id=$1 AND phase='submitting' AND broadcast_started=FALSE RETURNING operation_id").get(id);
   assert(intent,'Broadcast boundary already consumed');
   const operation=await db.prepare("UPDATE passkey_native_operations SET phase='submitting',tx_hash=$1 WHERE id=$2 AND phase='authorized' RETURNING id").get(signed.hash,id);
   assert(operation,'Operation no longer authorized');
  });
  sendStage('execute.broadcast');
  assert.equal(lower(await sendRaw(raw)),lower(signed.hash));
  sendStage('execute.receipt');
  const confirmed=await waitCanonicalReceipt(rpc,signed.hash,{confirmations:3,timeoutMs:180000,pollMs:2000,maxPolls:90});const receipt=confirmed.receipt;
  sendStage('execute.mined_transaction');
  const mined=await rpc('quai_getTransactionByHash',[signed.hash]);assert(mined);
  assert.deepEqual(bound({type:mined.type,chainId:mined.chainId,from:mined.from,to:mined.to,nonce:mined.nonce,value:mined.value,gasPrice:mined.gasPrice,gasLimit:mined.gas??mined.gasLimit,data:mined.input??mined.data,accessList:mined.accessList}),bound(tx));
  assert.equal(BigInt(receipt.effectiveGasPrice??mined.gasPrice),price);assert(BigInt(receipt.gasUsed)<=gasLimit);
  const success=BigInt(receipt.status)===1n;
  // Nonce and wallet effects at the canonical receipt block, not at an unstable tip.
  sendStage('execute.receipt_effects');
  const tag=receipt.blockNumber;const receiptBlock=validateBlock(await rpc('quai_getBlockByNumber',[tag,false]));assert.equal(receiptBlock.hash,receipt.blockHash);
  assert.equal(BigInt(await rpc('quai_getTransactionCount',[relayer,tag])),BigInt(tx.nonce)+1n);
  assert.equal((await call(row,'nonce',[],tag))[0],BigInt(op.walletNonce)+(success?1n:0n));await assertCanonicalBlock(rpc,receiptBlock);
  const fee=BigInt(receipt.gasUsed)*price;
  const amount=success?BigInt(op.quote.amount):0n,refund=success?BigInt(quotedFee(1,op.quote.networkFee).totalFee):0n;
  const nativeAmount=token===ZERO_TOKEN?amount:0n;
  assert.equal(BigInt(await rpc('quai_getBalance',[row.plan.address,tag])),BigInt(s.walletBalance)-nativeAmount-refund,'Wallet balance effect mismatch');
  assert.equal(BigInt(await rpc('quai_getBalance',[relayer,tag])),BigInt(s.balance)-fee+refund+(lower(recipient)===lower(relayer)?nativeAmount:0n),'Relayer balance effect mismatch');
  if(lower(recipient)!==lower(relayer))assert.equal(BigInt(await rpc('quai_getBalance',[recipient,tag])),recipientBalance+nativeAmount,'Recipient balance effect mismatch');
  if(tokenBefore){assert.equal(BigInt(await tokenBalance(token,op.wallet,tag)),BigInt(tokenBefore.wallet)-amount);assert.equal(BigInt(await tokenBalance(token,recipient,tag)),BigInt(tokenBefore.recipient)+amount);}
  await assertCanonicalBlock(rpc,receiptBlock);
  assert(await verifyNetwork({rpc,block:receiptBlock,relayer,wallet:row.plan.address}),'Receipt network verification failed');
  sendStage('execute.journal');
  await db.transaction(async()=>{
   await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=reserved_wei-$1 WHERE id=$2').run(String(price*gasLimit-fee),grantId);
   await db.prepare('UPDATE passkey_relayer_intents SET phase=$1 WHERE operation_id=$2').run(success?'confirmed':'failed',id);
   await db.prepare('UPDATE passkey_native_operations SET phase=$1,receipt=$2 WHERE id=$3').run(success?'confirmed':'failed',JSON.stringify({transactionHash:signed.hash,blockHash:receipt.blockHash,blockNumber:receipt.blockNumber,status:receipt.status,gasUsed:String(BigInt(receipt.gasUsed)),gasPrice:String(price),feeWei:String(fee),confirmations:confirmed.confirmations,finalityProven:false}),id);
   await db.prepare('DELETE FROM passkey_relayer_lanes WHERE relayer=$1 AND reference=$2').run(lower(relayer),id);
  });
 }
 return {available,unavailableReason,quote,prepare,execute};
}
