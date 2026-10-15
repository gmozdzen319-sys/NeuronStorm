// READ-ONLY estimate, never an authorization or an executable preflight proof.
// In a private in-memory snapshot only, substitute an ephemeral public key and
// exercise the real bytecode. The actual user assertion is verified separately
// against unchanged chain state before any relayer signature/broadcast.
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AbiCoder,keccak256,toBeHex} from 'quais';
import {feeDigest,ZERO_TOKEN} from './fee-operation.mjs';
import {feeGasEstimate,FEE_BUFFER_BPS} from './fee-estimate-policy.mjs';
import {feeWalletABI,feeAccessList} from './fee-plan.mjs';
import {captureAccounts,assertCanonicalBlock} from './head-guard.mjs';
const exec=promisify(execFile),abi=AbiCoder.defaultAbiCoder(),sha=b=>createHash('sha256').update(b).digest();
const hex=b=>'0x'+Buffer.from(b).toString('hex'),q=n=>'0x'+BigInt(n).toString(16);
const N=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export function createNativeFeeQuote({binary,binaryHash,infrastructure}){
 assert(binary&&/^[0-9a-f]{64}$/i.test(binaryHash));
 assert.equal(infrastructure.generation,3);const infra=Object.freeze({...infrastructure});
 return async({rpc,row,operation,state,gasPrice,relayer})=>{
  assert.equal(row.generation,3);assert.equal(operation.wallet,row.plan.address);
  assert.equal(row.plan.implementation,infra.implementation);assert.equal(row.plan.factory,infra.factory);
  assert.equal(operation.walletNonce,state.walletNonce);assert.equal(operation.epoch,state.epoch);
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),binaryHash,'Verifier changed');
  const block=state.block,blockLimit=BigInt(block.header.gasLimit);assert(blockLimit>0n&&blockLimit<=BigInt(Number.MAX_SAFE_INTEGER));
  const keyBase=BigInt(keccak256(abi.encode(['bytes32','uint256'],[row.plan.keyId,1])));
  const keyX=toBeHex(keyBase,32),keyY=toBeHex(keyBase+1n,32);
  const context=new Map();
  function add(address,keys=[]){const a=address.toLowerCase(),prior=context.get(a)||new Set();for(const key of keys)prior.add(key.toLowerCase());context.set(a,prior);assert(context.size<=128&&[...context.values()].reduce((n,s)=>n+s.size,0)<=2048,'Quote snapshot too complex');}
  add(relayer);add(row.plan.address,[...Array.from({length:6},(_,i)=>toBeHex(i,32)),keccak256(toBeHex(5,32)),keyX,keyY,toBeHex(keyBase+2n,32)]);
  add(infra.implementation,[toBeHex(0,32)]);add(operation.quote.recipient);
  if(operation.quote.token!==ZERO_TOKEN)add(operation.quote.token);
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'});
  const simulationX=hex(Buffer.from(jwk.x,'base64url')),simulationY=hex(Buffer.from(jwk.y,'base64url'));
  function assertion(digest){
   const json=JSON.stringify({type:'webauthn.get',challenge:Buffer.from(digest.slice(2),'hex').toString('base64url'),origin:infra.origin,crossOrigin:false});
   const ad=Buffer.concat([sha(infra.rpID),Buffer.from([5,0,0,0,0])]);
   const signature=sign('sha256',Buffer.concat([ad,sha(json)]),{key:pair.privateKey,dsaEncoding:'ieee-p1363'});
   let s=BigInt(hex(signature.subarray(32)));if(s>N/2n)s=N-s;
   return [hex(signature.subarray(0,32)),toBeHex(s,32),0,0,hex(ad),json];
  }
  const dir=await mkdtemp(join(tmpdir(),'ns-fee-quote-'));
  try{
   let quotedGas=0n,measuredGas=0n,accessList=[];
   // First measure the operation, then measure it including its quoted debit.
   // Bounded read-only estimation only. No private user key, signer or send RPC.
   for(let pricing=0;pricing<2;pricing++){
    const op={...operation,quote:{...operation.quote,relayer,gasPrice:String(gasPrice),networkFee:String(measuredGas?feeGasEstimate(measuredGas)*BigInt(gasPrice):1n)}};
    op.digest=feeDigest(op);const auth=assertion(op.digest);
    const data=feeWalletABI.encodeFunctionData('sendQuoted',[op.quote,op.deadline,row.plan.keyId,auth]);
    let measured=false;
    for(let discovery=0;discovery<6;discovery++){
     const entries=[...context].map(([address,keys])=>({address,storageKeys:[...keys].sort()}));
     const original=await captureAccounts(rpc,entries,block);
     const wallet=original.find(a=>a.Address===row.plan.address.toLowerCase());
     assert.equal(wallet.Storage[keyX],row.plan.x.toLowerCase());assert.equal(wallet.Storage[keyY],row.plan.y.toLowerCase());
     assert.equal(keccak256(wallet.Code),row.plan.runtimeHash);
     assert.equal(keccak256(original.find(a=>a.Address===infra.implementation.toLowerCase()).Code),infra.implementationHash);
     const accounts=structuredClone(original),substitute=accounts.find(a=>a.Address===wallet.Address);
     substitute.Storage[keyX]=simulationX;substitute.Storage[keyY]=simulationY;
     const affordable=BigInt(accounts.find(a=>a.Address===relayer.toLowerCase()).Balance)/BigInt(gasPrice);
     const simulationLimit=affordable<blockLimit?affordable:blockLimit;assert(simulationLimit>21000n,'Insufficient relayer balance for estimation');
     const input={Single:true,FinalizeSnapshot:true,Sender:relayer,Block:block.woHeader.number,Time:block.woHeader.timestamp,StateSize:block.header.quaiStateSize,Price:q(gasPrice),StartNonce:Number(state.nonce),Accounts:accounts,AccessList:accessList,Txs:[{Name:'synthetic-quote-only',To:row.plan.address,Data:data,Value:'0x0',Nonce:Number(state.nonce),Gas:Number(simulationLimit)}]};
     const source=join(dir,'input.json'),output=join(dir,'output.json');await writeFile(source,JSON.stringify(input),{mode:0o600});
     await exec(binary,[source,output],{windowsHide:true,timeout:30000,maxBuffer:1048576});
     const result=JSON.parse(await readFile(output,'utf8'));assert.equal(result.snapshotCommitted,true);
     const discovered=feeAccessList(result.discoveredAccessList);
     const before=JSON.stringify([...context].map(([a,s])=>[a,[...s].sort()]));for(const item of discovered)add(item.address,item.storageKeys);
     const expanded=before!==JSON.stringify([...context].map(([a,s])=>[a,[...s].sort()]));
     const changed=JSON.stringify(discovered)!==JSON.stringify(accessList);accessList=discovered;
     if(expanded||changed)continue;
     assert(!result.outcome.error,'Quote simulation failed');
     const estimate=BigInt(result.estimate);assert(estimate>=BigInt(result.minimumGas)&&estimate>=BigInt(result.outcome.gas)&&estimate>0n&&estimate<=blockLimit);
     if(BigInt(result.outcome.gas)>measuredGas)measuredGas=BigInt(result.outcome.gas);
     if(estimate>quotedGas)quotedGas=estimate;
     measured=true;break;
    }
    assert(measured,'Quote discovery did not stabilize');
   }
   await assertCanonicalBlock(rpc,block);
   // Keep the established safe execution limit. Only the fee basis changes:
   // measured receipt-style gas plus the explicit, separately tested allowance.
   const feeGas=feeGasEstimate(measuredGas);assert(feeGas<=quotedGas,'Fee estimate exceeds safe execution limit');
   return {estimatedGas:String(feeGas),measuredGas:String(measuredGas),feeBufferBps:String(FEE_BUFFER_BPS),gasLimit:String(quotedGas),quoteOnly:true,actualAssertionPreflightRequired:true,blockHash:block.hash};
  }finally{
   const path=relative(resolve(tmpdir()),resolve(dir));assert(!isAbsolute(path)&&path.startsWith('ns-fee-quote-')&&!path.startsWith('..'));
   await rm(dir,{recursive:true,force:true});
  }
 };
}
