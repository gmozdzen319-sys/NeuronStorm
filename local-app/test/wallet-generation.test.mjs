import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {walletSQL,assertV1Settled,walletTables} from '../db/wallet-generation.mjs';
import {receiveInfrastructure,WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
test('generation routing isolates approvals and journals, preserves identity and shared relayer locks',()=>{
 for(const table of walletTables){
  assert.equal(walletSQL(`SELECT * FROM ${table}`,2),`SELECT * FROM ${table}_v2`);
  assert.equal(walletSQL(`SELECT * FROM ${table}`,1),`SELECT * FROM ${table}`);
 }
 for(const table of ['passkey_credentials','passkey_accounts','passkey_relayer_grants','passkey_relayer_lanes','passkey_v1_assignments'])assert.equal(walletSQL(`SELECT * FROM ${table}`,2),`SELECT * FROM ${table}`);
 assert.equal(walletSQL("SELECT 'passkey_clone_wallets' -- passkey_native_operations",2),"SELECT 'passkey_clone_wallets' -- passkey_native_operations");
 assert.throws(()=>walletSQL('',3));
});
test('v2 startup refuses unresolved v1 work rather than resetting it',async()=>{
 await assert.rejects(assertV1Settled(async sql=>{assert.match(sql,/passkey_relayer_intents/);assert.match(sql,/ambiguous/);return {rows:[{blocked:true}]};}),/Unresolved/);
 await assertV1Settled(async()=>({rows:[{blocked:false}]}));
});
test('v2 manifest requires new confirmed factory and unchanged reviewed implementation/RP',()=>{
 const valid={...infra,generation:2,confirmed:true,factory:'0x0011111111111111111111111111111111111111'};
 assert.equal(receiveInfrastructure(valid).generation,2);
 for(const change of [{confirmed:false},{factory:'0x00313F663E19d718B3BCCfcD37f81D11dd475F6C'},{implementation:valid.factory},{origin:'https://evil.example'},{factoryHash:'0x12'},{chainId:1}])assert.throws(()=>receiveInfrastructure({...valid,...change}));
});
test('application defaults to the confirmed Receive v2 factory without an environment override',()=>{
 const env={...process.env};delete env.NS_WALLET_GENERATION;
 const source=`import {WALLET_GENERATION,WALLET_INFRASTRUCTURE} from ${JSON.stringify(new URL('../wallet-infrastructure.mjs',import.meta.url).href)};console.log(JSON.stringify({generation:WALLET_GENERATION,factory:WALLET_INFRASTRUCTURE.factory}));`;
 const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',source],{env,encoding:'utf8',windowsHide:true}));
 assert.deepEqual(result,{generation:2,factory:'0x000958476ef4631e9B97Df63d9919779E3cb79cd'});
});
