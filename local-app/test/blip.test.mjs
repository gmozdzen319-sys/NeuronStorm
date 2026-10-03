import {randomBytes} from 'node:crypto';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getWalletProvider,isBlip,blipLink} from '../public/wallet-provider.js';
import {connectWallet,signIn,addNeuronToken} from '../public/wallet.js';
import {Wallet} from 'quais';
test('Blip detection uses documented aliases, preserves Pelagus and excludes unrelated wallets',()=>{
 const blip={isBlip:true,request(){}},pelagus={request(){}};
 assert.equal(getWalletProvider({quai:blip,pelagus}),blip);assert.equal(getWalletProvider({ethereum:blip}),blip);
 assert.equal(getWalletProvider({pelagus}),pelagus);assert.equal(getWalletProvider({ethereum:pelagus}),null);
 assert.equal(isBlip({_isSwiftBlip:true}),true);
 assert.equal(blipLink('https://neuronstorm.onrender.com/private?secret=1#key'),'https://blippay.me/browser?url=https%3A%2F%2Fneuronstorm.onrender.com%2F');
 assert.equal(blipLink('http://localhost:3000'),null);assert.equal(blipLink('https://user:pass@example.com'),null);
});
test('Blip connects then signs the exact server challenge without any funding requests',async()=>{
 const wallet=new Wallet(randomBytes(32).toString('hex')),calls=[],message='Neuron Storm one-time challenge';
 const provider={isBlip:true,async request({method,params}){calls.push(method);if(method==='personal_sign')return wallet.signMessage(Buffer.from(params[0].slice(2),'hex'));return [wallet.address];}};
 const address=await connectWallet(provider);assert.deepEqual(calls,['quai_requestAccounts']);
 const result=await signIn(provider,address,async(path,data)=>{if(path==='/api/challenge')return {id:'nonce',message};assert.equal(data.signature,await wallet.signMessage(message));return {account:{address}};});
 assert.equal(result.account.address,address);assert.deepEqual(calls,['quai_requestAccounts','quai_accounts','personal_sign','quai_accounts']);
});
test('unsupported Blip import requires explicit manual confirmation and never fakes success',async()=>{
 const address='0x'+'1'.repeat(40),token={address,symbol:'NS',decimals:18};
 const provider={isBlip:true,async request({method}){if(method==='quai_accounts')return [address];if(method==='quai_chainId')return '0x9';throw Object.assign(Error('Unsupported'),{code:4200});}};
 await assert.rejects(addNeuronToken(provider,address,token),e=>e.manualImport===true);
 provider.request=async({method})=>{if(method==='quai_accounts')return [address];if(method==='quai_chainId')return '0x9';throw Object.assign(Error('Declined'),{code:4001});};
 await assert.rejects(addNeuronToken(provider,address,token),e=>!e.manualImport&&e.code===4001);
});
