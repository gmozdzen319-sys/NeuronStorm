import test from 'node:test';
import assert from 'node:assert/strict';
import {setupProgress} from '../wallet/setup-progress.mjs';
import {createPasskeyUI} from '../public/passkey-ui.js';

test('Setup percentages describe existing stages; only verified readiness is 100',()=>{
 for(const [input,percent] of [[{},0],[{job:'running'},20],[{approval:'quoted'},40],[{approval:'preparing'},55],[{approval:'submitting'},75],[{approval:'confirmed'},90],[{ready:true},100]])assert.equal(setupProgress(input).percent,percent);
 assert.match(setupProgress({job:'quote_retry_wait'}).message,/fresh network check/);
 assert.match(setupProgress({job:'stopped',approval:'confirmed'}).message,/paused/);
 assert.equal(setupProgress({job:'ambiguous'}).percent,75);
 assert.equal(setupProgress({approval:'confirmed',verificationUnavailable:true}).percent,0);
});

test('Wallet setup UI uses server stages, existing refresh, hides on logout and never invents completion',async()=>{
 const original={document:globalThis.document,setTimeout,clearTimeout};const nodes=new Map(),timers=new Map();let sequence=0;
 const node=()=>({hidden:false,value:'',textContent:'',children:[],options:[],addEventListener(){},removeAttribute(){},replaceChildren(){this.children=[];this.options=[];},append(x){this.children.push(x);this.options.push(x);}});
 globalThis.document={querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},createElement:node};
 globalThis.setTimeout=(fn,ms)=>{timers.set(++sequence,{fn,ms});return sequence;};globalThis.clearTimeout=id=>timers.delete(id);
 let state={status:'activating',setupProgress:setupProgress({job:'running'})},failed=false;
 const api=async(path,body)=>{assert.equal(body,undefined);if(path==='/api/passkey/wallet'){if(failed)throw Error('offline');return state;}return {tokens:[],nsBalance:'0'};};
 try{
  const ui=createPasskeyUI({api,onExternal(){},onAccount(){}}),account={id:'new',method:'passkey'};
  await ui.setAccount(account);assert.equal(nodes.get('#pk-progress-setup-bar').value,20);assert.equal(timers.size,1);assert.equal([...timers.values()][0].ms,15000);
  // Re-reading the same stage cannot advance the progress with elapsed time.
  await ui.setAccount(account,true);assert.equal(nodes.get('#pk-progress-setup-bar').value,20);
  state={status:'activation_waiting',setupProgress:setupProgress({job:'stopped'})};await ui.setAccount(account,true);assert.equal(timers.size,0);assert.match(nodes.get('#pk-progress-setup-message').textContent,/paused/);
  state={status:'activating',setupProgress:{percent:100,message:'Finalizing wallet'}};await ui.setAccount(account,true);assert.equal(nodes.get('#pk-progress-setup-bar').value,90);
  state={status:'active',address:'0x123',receiveAvailable:true,setupProgress:setupProgress({ready:true})};await ui.setAccount(account,true);assert.equal(nodes.get('#pk-progress-setup-bar').value,100);assert.equal(timers.size,0);
  failed=true;await ui.setAccount(account,true);assert.equal(nodes.get('#pk-progress-setup-bar').value,0);assert.match(nodes.get('#pk-progress-setup-message').textContent,/unavailable/);
  await ui.setAccount(null);assert.equal(nodes.get('#pk-progress-setup').hidden,true);
 }finally{Object.assign(globalThis,original);}
});
