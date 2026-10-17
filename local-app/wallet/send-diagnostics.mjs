import {AsyncLocalStorage} from 'node:async_hooks';

const context=new AsyncLocalStorage();
export function sendExpired(count){
 try{if(Number.isSafeInteger(count)&&count>0)console.warn('[wallet-send-stop]',JSON.stringify({stage:'prepare.expired_confirmations',code:'CONFIRMATION_EXPIRED',count}));}catch{}
}
const reasons=new Map([
 ['Exact native execution failed','NATIVE_EXECUTION_REVERTED'],
 ['Frozen access list changed','ACCESS_LIST_CHANGED'],
 ['Native access-list discovery did not stabilize','ACCESS_LIST_UNSTABLE'],
 ['No approved relayer budget','RELAYER_BUDGET_UNAVAILABLE'],
 ['Expired operation','OPERATION_EXPIRED'],
 ['Token approval too close to expiry; prepare a new quote','TOKEN_APPROVAL_WINDOW_TOO_SHORT'],
 ['Token approval too close to block time; prepare a new quote','TOKEN_BLOCK_WINDOW_TOO_SHORT'],
 ['This confirmation expired or was already used. No retry was sent.','CONFIRMATION_EXPIRED_OR_USED'],
 ['Sending is temporarily unavailable. Your funds remain in your wallet.','SEND_UNAVAILABLE'],
 ['Production chain verification unavailable','NETWORK_VERIFICATION_FAILED'],
 ['Verifier changed','VERIFIER_CHANGED'],
 ['Sign in with your passkey.','PASSKEY_LOGIN_REQUIRED'],
 ['Enter a valid Cyprus-1 recipient and token address.','INVALID_ADDRESS'],
 ['This recipient is not supported.','UNSUPPORTED_RECIPIENT'],
 ['Enter a positive amount within the token’s decimal precision.','INVALID_AMOUNT'],
 ['Insufficient token balance.','INSUFFICIENT_TOKEN_BALANCE'],
 ['Insufficient QUAI for the amount and quoted fee.','INSUFFICIENT_QUAI_BALANCE'],
 ['An earlier transfer is still being checked. Do not send it again.','PENDING_TRANSFER'],
]);
// Only constant stage labels supplied by server code. Never pass user input.
export function sendStage(stage){const c=context.getStore();if(c)c.stage=stage;}
export function sendStopped(error){
 try{
  const c=context.getStore();if(!c||c.logged)return;c.logged=true;
  // Emit neither message/stack nor assertion actual/expected. Source locations
  // distinguish individual guards without publishing any compared values.
  const site=String(error?.stack??'').match(/[/\\](fee-[a-z-]+|head-guard|stabilization|receipt-confirmation|operation|chain)\.mjs:(\d+):(\d+)/);
  const code=error?.code==='FEE_REQUOTE_REQUIRED'?'FEE_REQUOTE_REQUIRED':reasons.get(error?.message)??(error?.code==='ERR_ASSERTION'?'GUARD_REJECTED':'DEPENDENCY_FAILED');
  console.warn('[wallet-send-stop]',JSON.stringify({stage:c.stage,code,guard:site?`${site[1]}:${site[2]}:${site[3]}`:'unavailable'}));
 }catch{/* Diagnostics must never change transaction or error handling. */}
}
export function diagnoseSend(stage,fn){
 return function(...args){return context.run({stage,logged:false},async()=>{
  try{return await fn.apply(this,args);}catch(error){sendStopped(error);throw error;}
 });};
}
