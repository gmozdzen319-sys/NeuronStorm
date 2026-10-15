import assert from 'node:assert/strict';

// Measured fee allowance, NOT execution gas or a guarantee for every authenticator.
// Offline native tests: legal extra clientDataJSON fields reached +11.90%;
// explicitly approved 15% covers the tested variability. Oversized exact
// assertions still STOP. Do not silently increase a signed quote.
export const FEE_BUFFER_BPS=1500n;
export function feeGasEstimate(measuredGas){
 const gas=BigInt(measuredGas);assert(gas>0n);
 return gas+(gas*FEE_BUFFER_BPS+9999n)/10000n;
}
