import test from 'node:test';
import assert from 'node:assert/strict';
import {assertUnusedExpiredGrant} from '../wallet/unused-test-grant.mjs';
const grant={relayer:'test-relayer',budget_wei:'100',reserved_wei:'0',expires_at:10};
const context={relayer:'test-relayer',budget:100n,now:11,intentCount:0};
test('Only a completely unused expired grant qualifies for replacement',()=>{
 assert.doesNotThrow(()=>assertUnusedExpiredGrant(grant,context));
 for(const patch of [{reserved_wei:'1'},{expires_at:12},{budget_wei:'101'},{relayer:'other'}])
  assert.throws(()=>assertUnusedExpiredGrant({...grant,...patch},context));
 assert.throws(()=>assertUnusedExpiredGrant(grant,{...context,intentCount:1}));
 assert.throws(()=>assertUnusedExpiredGrant(null,context));
});
