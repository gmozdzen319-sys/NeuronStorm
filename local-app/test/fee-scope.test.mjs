import test from 'node:test';import assert from 'node:assert/strict';
import {scopedFeeLoader} from '../wallet/configured-fee.mjs';
test('Controlled fee rollout never loads another account wallet, even with valid sessions',async()=>{
 const calls=[],registry={load:async(db,id)=>{calls.push(id);return {account_id:id};}};
 const load=scopedFeeLoader(registry,'approved-test-account');
 assert.equal(await load({},'another-valid-account'),null);assert.deepEqual(calls,[]);
 assert.deepEqual(await load({},'approved-test-account'),{account_id:'approved-test-account'});
 assert.deepEqual(calls,['approved-test-account']);
});
test('Unscoped production loader preserves each account identity without test-account whitelist',async()=>{
 const registry={load:async(db,id)=>({account_id:id})},load=scopedFeeLoader(registry,'');
 for(const id of ['first-account','new-account'])assert.deepEqual(await load({},id),{account_id:id});
});
