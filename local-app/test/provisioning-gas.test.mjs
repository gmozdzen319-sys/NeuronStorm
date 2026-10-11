import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProvisioningGas} from '../wallet/provisioning-gas.mjs';

for(const used of [247725,247737])test('Production padded estimate passes exact 330000 gas proof: '+used,()=>{
 const evidence={limit:330000,used,minimum:used,nativeEstimate:used+Math.floor(used/3),rpcEstimate:used+Math.floor(used/3)};
 assert(BigInt(evidence.rpcEstimate)>330000n);
 assert.equal(verifyProvisioningGas(evidence).minimumGas,String(used));
 for(const patch of [{limit:330001},{used:0},{minimum:330001},{rpcEstimate:evidence.rpcEstimate+1},{nativeEstimate:evidence.nativeEstimate+1}]){
  assert.throws(()=>verifyProvisioningGas({...evidence,...patch}));
 }
});
