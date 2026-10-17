import {AsyncLocalStorage} from 'node:async_hooks';
import {activationFailure} from './activation-failure.mjs';
const context=new AsyncLocalStorage();
const stages=new Set(['QUEUE_READ','HEAD_READ','HEAD_VALIDATE','FACTORY_CONTEXT','FACTORY_RECEIPT','FACTORY_ANCHOR','FACTORY_RUNTIME','FACTORY_NONCE','CHECKPOINT_LOAD','CHECKPOINT_VALIDATE','CHECKPOINT_ANCESTRY','FACTORY_MAPPINGS','HISTORY_SCAN','HISTORY_LOGS','HISTORY_LOG_VALIDATE','CHECKPOINT_CANONICALITY','CHECKPOINT_SAVE','FACTORY_FINAL_VERIFY','CLAIM_TRANSACTION','CLAIM_LOCK','CLAIM_BLOCKERS','CLAIM_CANDIDATE','CLAIM_GRANT_INSERT','CLAIM_ATTEMPT_INSERT']);
export function activationPreStage(stage){const c=context.getStore();if(c&&stages.has(stage))c.stage=stage;}
export function diagnoseActivationPreAttempt(fn){
 return context.run({stage:'QUEUE_READ',claimed:false},async()=>{
  try{return await fn();}catch(error){
   try{const c=context.getStore();if(!c.claimed){
    const site=String(error?.stack??'').match(/[/\\](fee-auto-activation|auto-activation|factory-context|factory-checkpoint|head-guard|chain)\.mjs:(\d{1,6}):(\d{1,6})(?=[\s)]|$)/);
    const code=activationFailure(error,'QUOTE').code;
    console.warn('[wallet-activation-pre-attempt-stop]',JSON.stringify({stage:c.stage,code,subcode:error?.code==='ERR_ASSERTION'?'ASSERTION_FAILED':'DEPENDENCY_FAILED',guard:site?`${site[1]}:${site[2]}:${site[3]}`:'unavailable'}));
   }}catch{/* Logging must never replace the original failure. */}
   throw error;
  }
 });
}
export function activationAttemptClaimed(){const c=context.getStore();if(c)c.claimed=true;}
