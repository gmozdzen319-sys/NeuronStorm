import test from 'node:test';
import assert from 'node:assert/strict';
import {getAddress} from 'quais';
import {captureAccounts} from '../wallet/head-guard.mjs';

const hash=n=>'0x'+BigInt(n).toString(16).padStart(64,'0');
const address='0x001893151cDcc11372f6dd067e3424f47ad8534a';
const block={hash:hash(2),woHeader:{hash:hash(2),parentHash:hash(1),location:'0x0000',number:'0x2',timestamp:'0x100'},header:{quaiStateSize:'0x1',gasLimit:'0x989680'}};
function fixture({reorg=false}={}){
 const calls=[];let blocks=0;
 const rpc=async(method,args)=>{
  if(method==='quai_getBlockByNumber'){blocks++;return reorg&&blocks===2?{...block,hash:hash(3),woHeader:{...block.woHeader,hash:hash(3)}}:block;}
  calls.push({method,args});assert.equal(args[0],getAddress(address),'RPC requires exact address checksum');assert.equal(args.at(-1),'0x2');
  if(method==='quai_getBalance')return '0x10';
  if(method==='quai_getTransactionCount')return '0x3';
  if(method==='quai_getCode')return '0x60AB';
  if(method==='quai_getStorageAt'){assert.equal(args[1],hash(0));return hash(9);}
  throw Error('Unexpected RPC method');
 };
 return {rpc,calls};
}
test('Snapshot checksums every account RPC address while preserving normalized snapshot identity',async()=>{
 const f=fixture();const result=await captureAccounts(f.rpc,[{address:address.toLowerCase(),storageKeys:[hash(0)]}],block);
 assert.deepEqual(result,[{Address:address.toLowerCase(),Balance:'0x10',Nonce:3,Code:'0x60ab',Storage:{[hash(0)]:hash(9)}}]);
 assert.deepEqual(f.calls.map(c=>c.method).sort(),['quai_getBalance','quai_getCode','quai_getStorageAt','quai_getTransactionCount']);
});
test('Snapshot rejects malformed and invalid mixed-case addresses before account reads',async()=>{
 for(const invalid of ['0x1234',address.replace('c','C')]){
  const f=fixture();await assert.rejects(captureAccounts(f.rpc,[{address:invalid,storageKeys:[]}],block));assert.equal(f.calls.length,0);
 }
});
test('Checksummed snapshot reads still fail closed on canonical block mismatch',async()=>{
 const f=fixture({reorg:true});await assert.rejects(captureAccounts(f.rpc,[{address,storageKeys:[hash(0)]}],block),/noncanonical snapshot/);
});
