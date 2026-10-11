import assert from 'node:assert/strict';

// Quai DoEstimateGas returns minimumSuccessfulGas + minimumSuccessfulGas/3.
// That recommendation is not the gas consumed or the transaction's hard cap.
// Accept its padding only with matching native evidence and exact RPC execution.
export function verifyProvisioningGas({limit,used,minimum,nativeEstimate,rpcEstimate}){
 const [cap,gas,min,native,rpc]=[limit,used,minimum,nativeEstimate,rpcEstimate].map(BigInt);
 assert(cap===330000n,'Unexpected provisioning gas limit');
 assert(gas>0n&&gas<=min&&min<=cap,'Provisioning cannot execute within hard gas limit');
 assert.equal(native,min+min/3n,'Unexpected native gas estimate');
 assert.equal(rpc,native,'RPC/native provisioning gas estimate mismatch');
 return {minimumGas:String(min),estimate:String(rpc)};
}
