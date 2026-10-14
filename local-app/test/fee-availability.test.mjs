import test from 'node:test';
import assert from 'node:assert/strict';
import {createFeeExecutor} from '../wallet/fee-executor.mjs';
test('Expired grant explains disabled Send without changing budget or signing',async()=>{
 const db={prepare:sql=>({get:async()=>sql.includes('grants')?{expires_at:10}:null})};
 const executor=createFeeExecutor(db,{chain:{rpc:()=>{throw Error('No RPC needed');}},relayer:'0x001',grantId:'expired',now:()=>11});
 assert.equal(await executor.available(),false);
 assert.match(await executor.unavailableReason(),/window has expired/);
});
test('Unresolved lane remains blocked and is not cleared by diagnosis',async()=>{
 const db={prepare:sql=>({get:async()=>sql.includes('grants')?{expires_at:100}:{reference:'unresolved'}})};
 const executor=createFeeExecutor(db,{chain:{},relayer:'0x001',grantId:'active',now:()=>11});
 assert.equal(await executor.available(),false);
 assert.match(await executor.unavailableReason(),/Do not submit it again/);
});
