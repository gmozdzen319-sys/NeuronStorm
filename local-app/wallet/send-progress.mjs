import {observeSendStages} from './send-diagnostics.mjs';

// Ephemeral presentation only. Never used to authorize, reconcile or retry.
// Percentages indicate completed milestones, not elapsed time or gas usage.
const preparation={
 'prepare.wallet':[10,'Checking balance'],
 'quote.stabilization':[25,'Checking network'],
 'quote.estimation':[45,'Estimating fee'],
 'quote.reserve':[70,'Verifying transfer'],
 'prepare.validate':[85,'Preparing transaction'],
};
const sending={
 'confirm.passkey':[10,'Verifying signature'],
 'confirm.credential_and_authorization':[20,'Signature verified'],
 'execute.state_and_operation':[30,'Checking network'],
 'execute.preflight':[45,'Verifying transfer'],
 'execute.sign':[60,'Preparing transaction'],
 'execute.journal':[65,'Preparing transaction'],
 'execute.broadcast':[75,'Broadcasting transaction'],
 'execute.receipt':[85,'Waiting for network confirmation'],
 'execute.settlement':[90,'Verifying confirmation'],
};
export function createSendProgress({now=Date.now,limit=512,ttl=600000}={}){
 const entries=new Map();
 const valid=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
 function prune(){for(const [key,e] of entries)if(now()-e.updatedAt>ttl)entries.delete(key);}
 function read(account,id){prune();const e=entries.get(id);return e&&e.account===account?.id?{...e.view}:null;}
 async function run(account,id,kind,fn){
  // Missing/invalid telemetry never changes existing endpoint behaviour.
  if(!account?.id||!valid(id))return fn();
  prune();if(entries.has(id))return fn();
  if(entries.size>=limit)entries.delete(entries.keys().next().value);
  const e={account:account.id,updatedAt:now(),view:{kind,percent:0,message:kind==='prepare'?'Preparing your review':'Verifying signature',finished:false}};
  entries.set(id,e);
  try{
   const result=await observeSendStages(stage=>{
    const milestone=(kind==='prepare'?preparation:sending)[stage];
    if(milestone){e.view={...e.view,percent:Math.max(e.view.percent,milestone[0]),message:milestone[1]};e.updatedAt=now();}
   },fn);
   if(kind==='prepare')e.view={kind,percent:100,message:'Ready for your Passkey confirmation',finished:true};
   else if(result?.status==='confirmed')e.view={kind,percent:100,message:'Confirmed',finished:true};
   else e.view={...e.view,message:result?.status==='submitting'?'Waiting for verified network confirmation':'Check transfer status below',finished:true};
   return result;
  }catch(error){e.view={...e.view,message:'This step could not complete. Check transfer status below.',finished:true};throw error;}
 }
 return {read,run};
}
