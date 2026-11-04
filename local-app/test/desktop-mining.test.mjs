import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createDesktopMining} from '../desktop-mining.mjs';
const {privateKey,publicKey}=generateKeyPairSync('ed25519');
const keyPem=privateKey.export({format:'pem',type:'pkcs8'});
const account={method:'passkey',id:'1773b364-cfc7-48b0-9650-441f126e0305'};
const wallet='0x000450fd930f4c05d6e96d4e51935f4cd403286c';
function fixture(change={}){let snapshots=0;const row={account_id:account.id,generation:3,revoked_at:null,plan:{address:wallet},...change.row};const config={db:{prepare(){return {all:async()=>change.approvals??[{phase:'confirmed'}]}}},feeWallet:{registry:{load:async()=>row},chain:{snapshot:async()=>{snapshots++;if(change.error)throw Error('Canonicality mismatch');return {deployed:change.deployed??true}}}},origin:'https://neuronstorm.onrender.com',now:()=>1700000000000,keyPem,payoutVerified:true,...change.config};return {attest:createDesktopMining(config),snapshots:()=>snapshots};}
test('signs only verified public v3 identity, fresh challenge and bounded expiry',async()=>{const f=fixture();const r=await f.attest(account,'a'.repeat(64));assert(verify(null,Buffer.from(r.payload),publicKey,Buffer.from(r.signature,'base64url')));const p=JSON.parse(Buffer.from(r.payload,'base64url'));assert.equal(p.wallet,wallet);assert.equal(p.account,account.id);assert.equal(p.expires-p.issued,15);assert.equal(f.snapshots(),1);assert(!r.payload.includes('secret'));assert.deepEqual(Object.keys(r),['payload','signature']);});
for(const [name,change,who,challenge] of [
 ['missing attestation key',{config:{keyPem:null}},account,'a'.repeat(64)],
 ['external wallet',{}, {method:'pelagus'},'a'.repeat(64)],
 ['anonymous',{},null,'a'.repeat(64)],
 ['malformed challenge',{},account,'bad'],
 ['foreign assignment',{row:{account_id:'other'}},account,'a'.repeat(64)],
 ['revoked credential',{row:{revoked_at:1}},account,'a'.repeat(64)],
 ['v2',{row:{generation:2}},account,'a'.repeat(64)],
 ['reserved',{deployed:false},account,'a'.repeat(64)],
 ['unconfirmed',{approvals:[{phase:'submitting'}]},account,'a'.repeat(64)],
 ['duplicate approval',{approvals:[{phase:'confirmed'},{phase:'confirmed'}]},account,'a'.repeat(64)],
 ['reorg',{error:true},account,'a'.repeat(64)],
 ['Qi address',{row:{plan:{address:'0x008450fd930f4c05d6e96d4e51935f4cd403286c'}}},account,'a'.repeat(64)],
])test(`rejects ${name}`,async()=>{await assert.rejects(()=>fixture(change).attest(who,challenge));});

test('verified account binding is independent of an outgoing-spend test',async()=>{
 const r=await fixture({config:{payoutVerified:false}}).attest(account,'b'.repeat(64));
 assert(verify(null,Buffer.from(r.payload),publicKey,Buffer.from(r.signature,'base64url')));
 const p=JSON.parse(Buffer.from(r.payload,'base64url'));
 assert.equal(p.account,account.id);assert.equal(p.wallet,wallet);assert.equal(p.policy,'session-wallet-v2');
});
for(const method of ['pelagus','blippay']){
 test(method+' binds only the contemporaneous wallet matching the authenticated session',async()=>{
  const f=fixture();const session={address:wallet};const observed={method,address:wallet,chain:'9'};
  const result=await f.attest(session,'a'.repeat(64),observed);
  assert(verify(null,Buffer.from(result.payload),publicKey,Buffer.from(result.signature,'base64url')));
  const p=JSON.parse(Buffer.from(result.payload,'base64url'));assert.equal(p.account,wallet);assert.equal(p.wallet,wallet);assert.equal(p.method,method);assert.equal(p.generation,0);
  for(const mismatch of [null,{...observed,chain:'1'},{...observed,address:'0x0011111111111111111111111111111111111111'}])
   await assert.rejects(()=>f.attest(session,'b'.repeat(64),mismatch));
  await assert.rejects(()=>f.attest(null,'b'.repeat(64),observed));assert.equal(f.snapshots(),0);
 });
}
