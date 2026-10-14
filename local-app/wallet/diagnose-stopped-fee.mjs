// Operator-only READ-ONLY replay at historical state. No signer or send RPC.
// Saved assertion stays inside the server process and is never printed.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {AbiCoder,keccak256,toBeHex} from 'quais';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain,walletABI} from './chain.mjs';
import {feeWalletABI,feeAccessList} from './fee-plan.mjs';
import {createFeePreflight,rpcTransaction} from './preflight.mjs';
import {validateBlock,assertCanonicalBlock,captureAccounts} from './head-guard.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,statement_timeout:10000});
let stage='read-stopped-operation';
try{
 await client.connect();await client.query('BEGIN READ ONLY');
 const account='914c577f-226c-4f1e-a7bb-2a4235f4a1a3';
 const {rows:[job]}=await client.query("SELECT * FROM passkey_native_operations_v2 WHERE account_id=$1 AND phase='stopped' AND (plan::jsonb->'operation'->>'action')='6' ORDER BY created_at DESC LIMIT 1",[account]);
 assert(job);console.log(JSON.stringify({stoppedFee:{id:job.id,assertionSaved:!!job.assertion,txHash:job.tx_hash},broadcasts:0}));
 assert(!job.tx_hash,'Broadcast operation requires receipt investigation');
 assert(job.assertion,'No verified assertion was persisted; historical execution cannot be reconstructed');
 const registry=createFeeAssignments(JSON.parse(await readFile(process.env.NS_FEE_WALLET_MANIFEST,'utf8')));
 const row=await registry.load({prepare:sql=>({get:async(...args)=>(await client.query(sql,args)).rows[0]})},account);
 await client.query('COMMIT');
 const prepared=JSON.parse(job.plan),op=prepared.operation,auth=JSON.parse(job.assertion);
 const chain=createWalletChain({infrastructure:registry.infrastructure}),rpc=chain.rpc;
 stage='locate-historical-block';
 const target=BigInt(op.deadline)-60n;
 let lo=0n,hi=BigInt(validateBlock(await rpc('quai_getBlockByNumber',['latest',false])).woHeader.number),selected;
 for(let count=0;lo<=hi&&count<32;count++){
  const mid=(lo+hi)/2n,b=validateBlock(await rpc('quai_getBlockByNumber',['0x'+mid.toString(16),false]));
  if(BigInt(b.woHeader.timestamp)<=target){selected=b;lo=mid+1n;}else hi=mid-1n;
 }
 assert(selected&&target-BigInt(selected.woHeader.timestamp)<60n);
 const block=selected,tag=block.woHeader.number;
 await assertCanonicalBlock(rpc,block);
 stage='verify-saved-passkey-on-contract';
 const probe=await rpc('quai_call',[{to:op.wallet,data:walletABI.encodeFunctionData('verifyProbe',[op.digest,auth,row.plan.x,row.plan.y])},tag]);
 assert.equal(walletABI.decodeFunctionResult('verifyProbe',probe)[0],true);
 console.log(JSON.stringify({savedPasskeyVerified:true,block:tag,quotedGas:String(BigInt(op.quote.networkFee)/BigInt(prepared.gasPrice)),gasLimit:prepared.gasLimit,broadcasts:0}));
 const tx={type:0,chainId:9,from:prepared.relayer,to:op.wallet,nonce:prepared.relayerNonce,value:'0',gasPrice:prepared.gasPrice,gasLimit:prepared.gasLimit,data:feeWalletABI.encodeFunctionData('sendQuoted',[op.quote,op.deadline,row.plan.keyId,auth])};
 stage='historical-access-list';
 let acl=await rpc('quai_createAccessList',[rpcTransaction(tx),tag]);
 if(acl.error){
  const text=String(acl.error),reason=['out of gas','execution reverted','invalid access list'].find(x=>text.toLowerCase().includes(x))||'other execution error';
  console.log(JSON.stringify({exactPlanAccessListRejected:true,reason,errorText:text.replace(/[\r\n]/g,' ').slice(0,200),gasUsed:acl.gasUsed,broadcasts:0}));
  // Inspect the exact failure at the ORIGINAL limit, never increase it.
  stage='exact-revert-reason';
  console.log(JSON.stringify({relayerPriceInputs:{senderMatches:tx.from.toLowerCase()===op.quote.relayer.toLowerCase(),priceMatches:BigInt(tx.gasPrice)===BigInt(op.quote.gasPrice),positivePrice:BigInt(op.quote.gasPrice)>0n},broadcasts:0}));
  tx.accessList=feeAccessList(acl.accessList);
  try{await rpc('quai_call',[rpcTransaction(tx),tag]);console.log(JSON.stringify({exactRpcCallPassed:true,broadcasts:0}));}
  catch(error){console.log(JSON.stringify({exactRpcCallError:error.walletRPC||{code:error.code||error.name},broadcasts:0}));}
  const abi=AbiCoder.defaultAbiCoder(),base=BigInt(keccak256(abi.encode(['bytes32','uint256'],[row.plan.keyId,1])));
  const entries=new Map(tx.accessList.map(a=>[a.address,new Set(a.storageKeys)]));
  const add=(a,keys=[])=>{a=a.toLowerCase();const s=entries.get(a)||new Set();for(const k of keys)s.add(k);entries.set(a,s);};
  add(tx.from);add(op.quote.recipient);add(registry.infrastructure.implementation,[toBeHex(0,32)]);
  add(tx.to,[...Array.from({length:6},(_,i)=>toBeHex(i,32)),keccak256(toBeHex(5,32)),...Array.from({length:3},(_,i)=>toBeHex(base+BigInt(i),32))]);
  const accounts=await captureAccounts(rpc,[...entries].map(([address,keys])=>({address,storageKeys:[...keys].sort()})),block);
  const binary=process.env.NS_WALLET_NATIVE_VERIFIER;
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),process.env.NS_WALLET_NATIVE_VERIFIER_SHA256);
  const dir=await mkdtemp(join(tmpdir(),'ns-exact-revert-'));
  try{
   const input={Single:true,FinalizeSnapshot:true,Sender:tx.from,Block:tag,Time:block.woHeader.timestamp,StateSize:block.header.quaiStateSize,Price:toBeHex(BigInt(tx.gasPrice)),StartNonce:Number(tx.nonce),Accounts:accounts,AccessList:tx.accessList,Txs:[{Name:'exact-revert-only',To:tx.to,Data:tx.data,Value:'0x0',Nonce:Number(tx.nonce),Gas:Number(tx.gasLimit)}]};
   await writeFile(join(dir,'input.json'),JSON.stringify(input),{mode:0o600});
   await promisify(execFile)(binary,[join(dir,'input.json'),join(dir,'output.json')],{timeout:30000,windowsHide:true,maxBuffer:1048576});
   const result=JSON.parse(await readFile(join(dir,'output.json'),'utf8')),out=result.outcome||result.failedDiscovery;
   let reason=null;if(out?.return?.startsWith('0x08c379a0')){const decoded=abi.decode(['string'],'0x'+out.return.slice(10))[0];if(/^[a-z-]{1,40}$/.test(decoded))reason=decoded;}
   console.log(JSON.stringify({exactNativeDiagnostic:{error:out?.error,reason,gasUsed:out?.gas,originalGasLimit:tx.gasLimit,snapshotCommitted:result.snapshotCommitted},broadcasts:0}));
   // RPC stops before signature verification and returns only a partial ACL.
   // Discover the complete list with the unchanged price/calldata/gas limit.
   let discovered=feeAccessList(result.discoveredAccessList);
   for(let attempt=0;attempt<3;attempt++){
    for(const item of discovered)add(item.address,item.storageKeys);
    input.Accounts=await captureAccounts(rpc,[...entries].map(([address,keys])=>({address,storageKeys:[...keys].sort()})),block);
    input.AccessList=discovered;
    await writeFile(join(dir,'input.json'),JSON.stringify(input),{mode:0o600});
    await promisify(execFile)(binary,[join(dir,'input.json'),join(dir,'output.json')],{timeout:30000,windowsHide:true,maxBuffer:1048576});
    const complete=JSON.parse(await readFile(join(dir,'output.json'),'utf8')),next=feeAccessList(complete.discoveredAccessList);
    if(JSON.stringify(next)!==JSON.stringify(discovered)){discovered=next;continue;}
    console.log(JSON.stringify({completeNativeDiagnostic:{passed:!complete.outcome.error,error:complete.outcome.error,gasUsed:complete.outcome.gas,gasLimit:tx.gasLimit,minimumGas:complete.minimumGas,aclStable:true,snapshotCommitted:complete.snapshotCommitted},broadcasts:0}));
    break;
   }
  }finally{await rm(dir,{recursive:true,force:true});}
  await assertCanonicalBlock(rpc,block);
 }
 assert(!acl.error);tx.accessList=feeAccessList(acl.accessList);
 console.log(JSON.stringify({historicalRpcGasUsed:acl.gasUsed,broadcasts:0}));
 stage='exact-historical-native-rpc-preflight';
 const result=await createFeePreflight({binary:process.env.NS_WALLET_NATIVE_VERIFIER,binaryHash:process.env.NS_WALLET_NATIVE_VERIFIER_SHA256,infrastructure:registry.infrastructure})(rpc,tx,row,block);
 console.log(JSON.stringify({historicalPreflightPassed:true,gasUsed:result.gasUsed,estimatedGas:result.estimate,quotedGas:String(BigInt(op.quote.networkFee)/BigInt(prepared.gasPrice)),broadcasts:0}));
}catch(error){
 // Report code location, never assertion comparisons, signed data or credentials.
 const frames=String(error.stack).split('\n').filter(x=>/^\s+at /.test(x)).slice(0,4);
 console.log(JSON.stringify({stoppedFeeDiagnosis:{stage,code:error.code||error.name,frames},broadcasts:0}));
}finally{await client.end();}
