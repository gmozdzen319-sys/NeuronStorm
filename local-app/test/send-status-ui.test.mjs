import test from 'node:test';
import assert from 'node:assert/strict';
import {createPasskeyUI} from '../public/passkey-ui.js';

test('Restored Send polls only GET, survives RPC/HTTP failure, and stops on terminal state or logout',async()=>{
 const original={document:globalThis.document,setTimeout,clearTimeout};
 let sequence=0;const timers=new Map(),nodes=new Map(),calls=[];
 const node=()=>({value:'',textContent:'',children:[],options:[],addEventListener(){},removeAttribute(){},focus(){},replaceChildren(){this.children=[];this.options=[];},append(x){this.children.push(x);this.options.push(x);}});
 globalThis.document={querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},createElement:node};
 globalThis.setTimeout=(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;};
 globalThis.clearTimeout=id=>timers.delete(id);
 let failure=true,phase='submitting';
 const api=async(path,body)=>{
  calls.push({path,body});assert.equal(body,undefined,'Status restoration must never POST');
  if(path==='/api/passkey/wallet')return {status:'active',reason:'Ready',receiveAvailable:true,sendAvailable:false,transfers:[{id:'saved-operation',phase:'submitting',created_at:Date.now()-600000,tx_hash:'0x123'}]};
  if(path==='/api/passkey/wallet/tokens')return {tokens:[]};
  if(path==='/api/passkey/wallet/token-balances')return {tokens:[],nsBalance:'0'};
  assert.equal(path,'/api/passkey/wallet/send/saved-operation');if(failure==='timeout')return new Promise(()=>{});if(failure)throw Error('temporary network failure');
  return {status:phase,transactionHash:'0x123'};
 };
 const tick=async()=>{const item=[...timers].find(([,v])=>v.ms!==15000);assert(item,'poll must be scheduled');timers.delete(item[0]);await item[1].fn();};
 try{
  const ui=createPasskeyUI({api,onExternal(){},onAccount(){}});
  await ui.setAccount({id:'account',method:'passkey'});
  assert.match(nodes.get('#pk-transfers').children[0].textContent,/Background checks continue/);
  await tick();assert.match(nodes.get('#pk-transfers').children[0].textContent,/temporarily unavailable/);
  assert([...timers.values()].some(t=>t.ms===60000));
  failure='timeout';const pending=tick();
  const timeout=[...timers].find(([,v])=>v.ms===15000);assert(timeout,'Each status request is bounded');timers.delete(timeout[0]);timeout[1].fn();await pending;
  assert.match(nodes.get('#pk-transfers').children[0].textContent,/temporarily unavailable/);
  failure=false;phase='confirmed';await tick();
  assert.match(nodes.get('#pk-transfers').children[0].textContent,/Confirmed/);assert.equal(timers.size,0);
  phase='submitting';await ui.setAccount({id:'account',method:'passkey'},true);assert(timers.size>0);
  await ui.setAccount(null);assert.equal(timers.size,0);
  assert.equal(calls.filter(c=>c.path.includes('/send/')).length,3);
 }finally{globalThis.document=original.document;globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;}
});
