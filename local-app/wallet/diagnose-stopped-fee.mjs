// Operator-only READ-ONLY replay at historical state. No signer or send RPC.
// Saved assertion stays inside the server process and is never printed.
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain,walletABI} from './chain.mjs';
import {feeWalletABI,feeAccessList} from './fee-plan.mjs';
import {createFeePreflight,rpcTransaction} from './preflight.mjs';
import {validateBlock,assertCanonicalBlock} from './head-guard.mjs';
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
 const acl=await rpc('quai_createAccessList',[rpcTransaction(tx),tag]);assert(!acl.error);tx.accessList=feeAccessList(acl.accessList);
 console.log(JSON.stringify({historicalRpcGasUsed:acl.gasUsed,broadcasts:0}));
 stage='exact-historical-native-rpc-preflight';
 const result=await createFeePreflight({binary:process.env.NS_WALLET_NATIVE_VERIFIER,binaryHash:process.env.NS_WALLET_NATIVE_VERIFIER_SHA256,infrastructure:registry.infrastructure})(rpc,tx,row,block);
 console.log(JSON.stringify({historicalPreflightPassed:true,gasUsed:result.gasUsed,estimatedGas:result.estimate,quotedGas:String(BigInt(op.quote.networkFee)/BigInt(prepared.gasPrice)),broadcasts:0}));
}catch(error){
 // Report code location, never assertion comparisons, signed data or credentials.
 const frames=String(error.stack).split('\n').filter(x=>/^\s+at /.test(x)).slice(0,4);
 console.log(JSON.stringify({stoppedFeeDiagnosis:{stage,code:error.code||error.name,frames},broadcasts:0}));
}finally{await client.end();}
