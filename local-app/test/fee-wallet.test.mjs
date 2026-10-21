import test from 'node:test';import assert from 'node:assert/strict';import {withFeeWallet} from '../wallet/fee-wallet.mjs';import {configuredFeeWallet} from '../wallet/configured-fee.mjs';
const oldAddress='0x0000000000000000000000000000000000000001',newAddress='0x0000000000000000000000000000000000000002',account={method:'passkey',id:'a'};
function fixture(){let deployed=true,unavailable=false,pending=false;const calls=[];const legacy={state:async()=>({status:'active',address:oldAddress,quaiBalance:'3.0',receiveAvailable:true,sendAvailable:false,tokens:[],transfers:[]}),receive:async()=>({address:oldAddress}),tokens:async()=>({tokens:[]}),tokenBalances:async()=>({nsBalance:'old'}),send:{prepare:async()=>{throw Error('Wrong sender');},confirm:async()=>({legacy:true}),status:async()=>({legacy:true})}};
 const fee={registry:{load:async(db,id)=>{assert.equal(id,'a');return {revoked_at:null,plan:{address:newAddress}};}},chain:{snapshot:async()=>{if(unavailable)throw Error('reorg');return {deployed,quaiBalance:'5.0'};}},send:{available:async()=>true,prepare:async(a,input)=>{calls.push(input);return input;},confirm:async()=>({fee:true}),status:async()=>({fee:true})}};
 const db={prepare:sql=>({all:async()=>{assert.match(sql,/SELECT id FROM passkey_native_operations/);assert.match(sql,/expires_at<=/);return [];},get:async()=>sql.includes('SELECT plan')?{plan:JSON.stringify({operation:{action:6}})}:pending?{id:'pending'}:null})};
 return {legacy,calls,service:withFeeWallet(db,legacy,fee,{readBalance:async(token,address)=>{assert.equal(address,newAddress);return '7.0';}}),set:key=>{if(key==='undeployed')deployed=false;if(key==='unavailable')unavailable=true;if(key==='pending')pending=true;}};
}
test('Fee configuration is disabled by default and requires a confirmed manifest',async()=>{assert.equal(await configuredFeeWallet({},{}),null);await assert.rejects(configuredFeeWallet({},{NS_FEE_WALLET_ENABLED:'true'}));});
test('Confirmed fee wallet is Receive while old address and funds remain visible',async()=>{const f=fixture(),state=await f.service.state(account);assert.equal(state.address,newAddress);assert.equal(state.legacyWallets[0].address,oldAddress);assert.equal(state.legacyWallets[0].quaiBalance,'3.0');assert(state.quotedFees);const receive=await f.service.receive(account);assert.equal(receive.address,newAddress);assert.match(receive.qr,/^data:image\/png;base64,/);assert.equal((await f.service.tokenBalances(account)).nsBalance,'7.0');});
test('Unconfirmed assignment never replaces existing Receive',async()=>{const f=fixture();f.set('undeployed');assert.equal((await f.service.state(account)).address,oldAddress);assert.equal((await f.service.receive(account)).address,oldAddress);});
test('Inconsistent chain disables Send; an unresolved transaction also disables Send',async()=>{for(const condition of ['unavailable','pending']){const f=fixture();f.set(condition);await assert.rejects(f.service.send.prepare(account,{amount:'1'}));assert.equal(f.calls.length,0);}});
test('Fee routing supplies QUAI default but retains selected token',async()=>{const f=fixture();assert.equal((await f.service.send.prepare(account,{amount:'1'})).token,'0x'+'0'.repeat(40));assert.equal((await f.service.send.prepare(account,{amount:'1',token:oldAddress})).token,oldAddress);assert.deepEqual(await f.service.send.confirm(account,{id:'x'}),{fee:true});await assert.rejects(f.service.state(null));});

test('New v3 signup hides Receive until both receipt and runtime confirmation, then exposes all assets',async()=>{
 let deployed=false,confirmed=false,phase=null;let balanceReads=0;
 const db={prepare:sql=>({all:async()=>{assert.match(sql,/SELECT id FROM passkey_native_operations/);assert.match(sql,/expires_at<=/);return [];},get:async()=>sql.includes('passkey_fee_signup_queue')?{account_id:'a'}:sql.includes('passkey_fee_auto_activations')?(phase?{phase}:null):sql.includes('passkey_fee_approvals')?(confirmed?{phase:'confirmed'}:null):null})};
 const token='0x0000000000000000000000000000000000000007';
 const legacy={state:async()=>({address:null,receiveAvailable:false,sendAvailable:false,tokens:[{contract:token,symbol:'NEW',decimals:18}]}),receive:async()=>{throw Error('Legacy Receive must not be used');}};
 const fee={registry:{load:async()=>({revoked_at:null,plan:{address:newAddress}})},chain:{snapshot:async()=>({deployed,quaiBalance:'0.0'})},send:{available:async()=>true}};
 const service=withFeeWallet(db,legacy,fee,{readBalance:async()=>{balanceReads++;return '0.0';}});
 let view=await service.state(account);assert.equal(view.status,'activating');assert.equal(view.address,null);await assert.rejects(service.receive(account));
 await service.tokenBalances(account);assert.equal(balanceReads,0);
 deployed=true;assert.equal((await service.state(account)).receiveAvailable,false);
 phase='ambiguous';view=await service.state(account);assert.equal(view.status,'activation_waiting');assert.match(view.reason,/No automatic retry/);assert.equal(view.address,null);
 confirmed=true;view=await service.state(account);assert.equal(view.address,newAddress);assert(view.sendAvailable&&view.receiveAvailable);assert(view.sendTokens.some(t=>t.contract===token));
 assert.equal((await service.receive(account)).address,newAddress);await service.tokenBalances(account);assert.equal(balanceReads,2);
});

test('V3 worker configuration requires fee Send, no test scope and no legacy worker; startup does not enroll',async()=>{
 const {configuredFeeAutoActivation}=await import('../wallet/fee-auto-activation.mjs');
 const env={NS_FEE_AUTO_ACTIVATE:'true',NS_FEE_SEND_ENABLED:'true',NS_WALLET_NETWORK_POLICY:'official-single-source-v1',NS_WALLET_RELAYER_ADDRESS:'0x001893151cDcc11372f6dd067e3424f47ad8534a'};
 const db={prepare:()=>{throw Error('Startup must not scan or backfill');}},fee={registry:{infrastructure:{generation:3}},chain:{}};
 assert(configuredFeeAutoActivation(db,fee,env).runNext);
 for(const patch of [{NS_FEE_SEND_ENABLED:'false'},{NS_FEE_ALLOWED_ACCOUNT_ID:'old-user'},{NS_WALLET_AUTO_ACTIVATE:'true'},{NS_WALLET_PROVISION_ENABLED:'true'}])assert.throws(()=>configuredFeeAutoActivation(db,fee,{...env,...patch}));
 assert.equal(configuredFeeAutoActivation(db,null,{}),null);
});
