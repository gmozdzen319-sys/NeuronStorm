import {test} from 'node:test';
import assert from 'node:assert/strict';
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
 for(const change of [{confirmed:false},{factory:infra.factory},{implementation:valid.factory},{origin:'https://evil.example'},{factoryHash:'0x12'},{chainId:1}])assert.throws(()=>receiveInfrastructure({...valid,...change}));
});
