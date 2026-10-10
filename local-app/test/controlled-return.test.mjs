import test from 'node:test';import assert from 'node:assert/strict';
import {RETURN as R,validateControlledReturn,scopeControlledReturn} from '../wallet/controlled-return.mjs';
const row=()=>({account_id:R.account,plan:{address:R.wallet}});
const op=()=>({wallet:R.wallet,recipient:R.recipient,amount:R.amount,chainId:9,action:5,walletNonce:'0',epoch:'0'});
test('Controlled return binds account, wallet, recipient, amount, chain, action and nonce',()=>{
 validateControlledReturn(row(),op());assert.throws(()=>validateControlledReturn({...row(),account_id:'another'},op()));
 for(const patch of [{wallet:R.recipient},{recipient:R.wallet},{amount:'1'},{chainId:1},{action:1},{walletNonce:'1'},{epoch:'1'}])assert.throws(()=>validateControlledReturn(row(),{...op(),...patch}));
});
for(const mode of ['success','preflight-stop','nonce-change','budget-change','ambiguous'])test('Controlled return '+mode+' disables sponsorship and cannot prepare twice',async()=>{
 let used=false,disabled=false,sends=0;
 const db={prepare:sql=>({run:async()=>{if(sql.startsWith('INSERT')){assert(!used);used=true;}else{assert(sql.includes('enabled=FALSE'));disabled=true;}}})};
 const base={available:async()=>!disabled,prepare:async()=>{
  if(mode==='preflight-stop')throw Error('preflight');return {operation:op(),relayer:R.recipient,relayerNonce:mode==='nonce-change'?'12':'11',maximumFeeWei:mode==='budget-change'?'80000000000000000000':'30000000000000000000'};
 },execute:async()=>{sends++;if(mode==='ambiguous')throw Error('timeout');return {confirmed:true};}};
 const e=scopeControlledReturn(db,base);
 if(['preflight-stop','nonce-change','budget-change'].includes(mode))await assert.rejects(e.prepare(row(),op()));
 else{const prepared=await e.prepare(row(),op());const input={accountId:R.account,row:row(),prepared};if(mode==='ambiguous')await assert.rejects(e.execute(input));else await e.execute(input);}
 assert(disabled);await assert.rejects(e.prepare(row(),op()));assert.equal(sends,['success','ambiguous'].includes(mode)?1:0);
});
