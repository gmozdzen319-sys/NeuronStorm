import assert from 'node:assert/strict';
import {AbiCoder,getAddress,isQuaiAddress,keccak256,parseUnits,toBeHex} from 'quais';
import {verifyAuthenticationResponse} from '@simplewebauthn/server';
import {strictClientData} from '../passkey-accounts.mjs';
import {WALLET_INFRASTRUCTURE as infra} from '../wallet-infrastructure.mjs';
import {NS_TOKEN} from '../neuron-token.mjs';
// Use the same reviewed DER conversion from the installed verification library.
const {unwrapEC2Signature}=await import(new URL('./helpers/iso/isoCrypto/unwrapEC2Signature.js',import.meta.resolve('@simplewebauthn/server')));
const abi=AbiCoder.defaultAbiCoder();
export function nativeAmount(value){
 assert(typeof value==='string'&&/^(?:0|[1-9]\d{0,20})(?:\.\d{1,18})?$/.test(value),'Enter a positive QUAI amount with up to 18 decimals.');
 const amount=parseUnits(value,18);assert(amount>0n,'Enter a positive QUAI amount.');return amount.toString();
}
export function nativeRecipient(value,wallet){
 const address=getAddress(value);assert(isQuaiAddress(address)&&/^0x00[0-7]/i.test(address)&&!/^0x0+$/i.test(address),'Use a Cyprus-1 Quai address.');
 assert(![wallet,NS_TOKEN.address,infra.implementation,infra.factory].some(a=>a.toLowerCase()===address.toLowerCase()),'This recipient is not supported.');return address;
}
export function operationDigest(op){
 assert.equal(op.chainId,9);assert.equal(op.action,5);
 const payload=keccak256(abi.encode(['address','uint256'],[op.recipient,op.amount]));
 return keccak256(abi.encode(['string','uint256','address','uint256','uint256','uint8','bytes32','uint256'],['NS-WALLET-v1',9,op.wallet,op.epoch,op.walletNonce,5,payload,op.deadline]));
}
export async function verifyTransferAssertion(op,response,credential){
 assert.equal(response.id,credential.credential_id);assert.equal(response.rawId,response.id);
 assert.equal(response.response.userHandle,credential.user_handle,'Wrong Passkey identity');
 assert.equal(credential.rp_id,infra.rpID);assert.equal(credential.origin,infra.origin);assert.equal(credential.revoked_at,null);
 strictClientData(response.response.clientDataJSON);
 const digest=operationDigest(op);assert.equal(op.digest,digest);
 const checked=await verifyAuthenticationResponse({response,expectedChallenge:Buffer.from(digest.slice(2),'hex').toString('base64url'),expectedOrigin:infra.origin,expectedRPID:infra.rpID,requireUserVerification:true,credential:{id:credential.credential_id,publicKey:Buffer.from(credential.public_key,'base64url'),counter:credential.counter}});
 assert(checked.verified);
 const ad=Buffer.from(response.response.authenticatorData,'base64url');assert.equal(ad.length,37);const flags=ad[32];assert((flags&5)===5&&(flags&0xe2)===0&&(!(flags&16)||(flags&8)));
 const rs=unwrapEC2Signature(Buffer.from(response.response.signature,'base64url'),1);
 const N=0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
 let s=BigInt('0x'+Buffer.from(rs.subarray(32)).toString('hex'));if(s>N/2n)s=N-s;
 const client=Buffer.from(response.response.clientDataJSON,'base64url'),text=client.toString('utf8');assert(Buffer.from(text).equals(client));
 return {counter:checked.authenticationInfo.newCounter,auth:['0x'+Buffer.from(rs.subarray(0,32)).toString('hex'),toBeHex(s,32),0,0,'0x'+ad.toString('hex'),text]};
}
