import test from 'node:test';
import assert from 'node:assert/strict';
test('Tip selects logged-in provider; Passkey opens existing Wallet Send without external signing',async()=>{
 const original={document:globalThis.document,localStorage:globalThis.localStorage,setInterval:globalThis.setInterval};
 try{for(const method of ['passkey','pelagus','blippay']){
  const nodes=new Map(),storage=new Map(),calls=[],walletCalls=[];
  function node(){return {hidden:false,value:'',textContent:'',dataset:{},children:[],handlers:{},classList:{toggle(){},remove(){},add(){}},addEventListener(name,fn){this.handlers[name]=fn;},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},querySelector(selector){return this.children.find(x=>x.className===selector.slice(1))??this.children.map(x=>x.querySelector(selector)).find(Boolean)??null;},close(){this.open=false;},showModal(){this.open=true;},focus(){},setAttribute(){}};}
  globalThis.document={hidden:false,activeElement:null,querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},createElement:node,addEventListener(){}};
  globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};globalThis.setInterval=()=>0;
  const {createRewardsUI}=await import('../public/rewards-ui.js');
  const account={address:'0x0011111111111111111111111111111111111111',...(method==='passkey'?{method,id:'pk'}:{})};
  const intent={id:'intent',recipient:'0x0022222222222222222222222222222222222222',units:'1000000000000000000',transaction:{from:account.address,to:'token'}};
  const provider={isBlip:method==='blippay',request:async({method:m})=>{walletCalls.push(m);return m==='quai_accounts'?[account.address]:m==='quai_chainId'?'0x9':'0x'+'aa'.repeat(32);}};
  const api=async(path)=>{calls.push(path);if(path==='/api/payments/prepare')return intent;return {online:0,weeklyVisitors:0,balance:'0',changePercent:0,baselineAt:0,address:'treasury'};};
  let opened;const ui=createRewardsUI(api,()=>account,async()=>{},{getProvider:()=>provider,onPasskeyPayment:async i=>{opened=i;}});
  ui.setAccount(account);const article=node();ui.decorate(article,{id:1,canVote:true,author:'Author',body:'Answer'});
  article.children[0].children[0].handlers.click();
  assert.equal(nodes.get('#payment-send').textContent,'Continue with '+(method==='passkey'?'Passkey':method==='blippay'?'BlipPay':'Pelagus'));
  await nodes.get('#payment-form').handlers.submit({preventDefault(){}});
  assert.equal(calls.filter(x=>x==='/api/payments/prepare').length,1);
  if(method==='passkey'){assert.equal(opened,intent);assert.deepEqual(walletCalls,[]);}else{assert.equal(opened,undefined);assert.equal(walletCalls.filter(x=>x==='quai_sendTransaction').length,1);}
 }}finally{Object.assign(globalThis,original);}
});


test('Passkey Tip prepares through existing Send progress and never requests a signature automatically',async()=>{
 const {createPasskeyUI}=await import('../public/passkey-ui.js');
 const previous={document:globalThis.document,setTimeout,clearTimeout};const nodes=new Map(),calls=[];let submitted;
 const node=()=>({value:'',children:[],options:[],handlers:{},addEventListener(k,f){this.handlers[k]=f;},removeAttribute(){},focus(){},replaceChildren(){this.children=[];this.options=[];},append(x){this.children.push(x);this.options.push(x);},requestSubmit(){submitted=this.handlers.submit({preventDefault(){}});}});
 const token='0x003bc332ef45fdd554f9e81786be6312a72540e6';
 globalThis.document={querySelector(s){if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},createElement:node};globalThis.setTimeout=()=>1;globalThis.clearTimeout=()=>{};
 try{
  const api=async(path,body)=>{calls.push({path,body});if(path==='/api/passkey/wallet')return {status:'active',sendAvailable:true,quotedFees:true,sendTokens:[{contract:token,symbol:'NS'}],transfers:[]};if(path.includes('token'))return {tokens:[]};if(path.endsWith('/prepare'))return {id:'op',review:{amount:'1',symbol:'NS',wallet:'sender',recipient:'recipient',network:'Quai',maximumFee:'1'}};throw Error(path);};
  const ui=createPasskeyUI({api,onExternal(){},onAccount(){}});await ui.setAccount({id:'account',method:'passkey'});
  await ui.openPayment({id:'tip',recipient:'recipient',units:'1000000000000000000',transaction:{to:token.toUpperCase()}});await submitted;
  const writes=calls.filter(c=>c.body);assert.equal(writes.length,1);assert.equal(writes[0].path,'/api/passkey/wallet/send/prepare');assert.equal(writes[0].body.paymentIntent,'tip');assert.equal(writes[0].body.token,token);
  assert.equal(nodes.get('#pk-progress-prepare-percent').textContent,'100%');assert.equal(nodes.get('#pk-send-review').hidden,false);assert.equal(nodes.get('#pk-recipient').readOnly,true);assert.equal(nodes.get('#pk-amount').readOnly,true);assert.equal(nodes.get('#pk-send-token').disabled,true);
  assert(!calls.some(c=>/confirm|broadcast/.test(c.path))); nodes.get('#pk-send').handlers.click();assert.equal(nodes.get('#pk-recipient').readOnly,false);assert.equal(nodes.get('#pk-send-token').disabled,false);assert.equal(nodes.get('#pk-send-review').hidden,true);
 }finally{Object.assign(globalThis,previous);}
});
