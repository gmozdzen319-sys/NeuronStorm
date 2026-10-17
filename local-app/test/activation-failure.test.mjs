import test from 'node:test';
import assert from 'node:assert/strict';
import {activationFailure} from '../wallet/activation-failure.mjs';

test('QUOTE retains precise stage, guard and safe gas evidence without exception payloads',()=>{
 const error={code:'ERR_ASSERTION',message:'secret signature',actual:'private key',expected:'credential',stack:'Error: secret\n    at quoteProvisioning (file:///app/local-app/wallet/provisioning-quote.mjs:35:11)\n    at secret (secret:1:2)',quoteDiagnostic:{stage:'NATIVE_GAS_MATCH',gas:{accessListGas:'123',nativeGas:'124',payload:'secret'},signature:'secret'}};
 assert.deepEqual(activationFailure(error,'QUOTE'),{stage:'QUOTE',code:'INVARIANT_FAILED',details:{quoteStage:'NATIVE_GAS_MATCH',subcode:'ASSERTION_FAILED',guard:'provisioning-quote:35:11',gas:{accessListGas:'123',nativeGas:'124'}}});
});
test('Unknown labels, arbitrary paths and nonnumeric gas are not persisted',()=>{
 const result=activationFailure({message:'secret',stack:'Error: secret\n at arbitrary (C:\\private\\secret.mjs:1:2)',quoteDiagnostic:{stage:'secret',gas:{nativeGas:'secret',gasLimit:'1'.repeat(79)}}},'QUOTE');
 assert.deepEqual(result.details,{quoteStage:'UNKNOWN',subcode:'DEPENDENCY_FAILED',guard:'unavailable'});
 assert(!JSON.stringify(result).includes('secret'));
});
test('Existing reason codes and execution stages remain unchanged',()=>{
 assert.deepEqual(activationFailure({provisioningStage:'ACCESS_LIST'},'EXECUTION'),{stage:'ACCESS_LIST',code:'INVARIANT_FAILED'});
 const error={walletRPC:{method:'quai_getLogs',code:-32000,message:'too many concurrent log queries; retry later'},quoteDiagnostic:{stage:'FACTORY_STORAGE'}};
 const result=activationFailure(error,'QUOTE');assert.equal(result.code,'RPC_LOG_CAPACITY');assert.equal(result.details.quoteStage,'FACTORY_STORAGE');
 assert.equal(activationFailure({message:'noncanonical snapshot/reorg'},'QUOTE').code,'CANONICALITY_MISMATCH');
});
test('Windows source coordinates distinguish unnamed guards without full paths',()=>{
 assert.equal(activationFailure({code:'ERR_ASSERTION',stack:'Error\n at check (C:\\Users\\private\\wallet\\preflight.mjs:43:108)'},'QUOTE').details.guard,'preflight:43:108');
});
