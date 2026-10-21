// Presentation only: percentages identify durable stages, not time or gas usage.
// Only the existing verified active-wallet path may supply ready=true.
export function setupProgress({job,approval,ready=false,verificationUnavailable=false}={}){
 if(ready)return {percent:100,message:'Wallet ready'};
 if(verificationUnavailable)return {percent:0,message:'Waiting for a safe network check. Please check again later.'};
 if(job==='stopped')return {percent:0,message:'Wallet setup is paused and needs review. No automatic retry will be made.'};
 if(job==='ambiguous')return {percent:75,message:'Wallet setup needs review. Waiting for the network result to be verified.'};
 if(job==='quote_retry_wait')return {percent:20,message:'Waiting for a fresh network check before preparing your wallet.'};
 if(approval==='confirmed')return {percent:90,message:'Finalizing wallet · checking that your wallet is ready'};
 if(approval==='submitting')return {percent:75,message:'Waiting for wallet activation to be verified'};
 if(approval==='preparing')return {percent:55,message:'Preparing wallet activation · checking the network'};
 if(approval==='quoted')return {percent:40,message:'Wallet fee prepared · waiting for activation checks'};
 if(job==='running')return {percent:20,message:'Checking network and preparing your wallet'};
 return {percent:0,message:'Preparing wallet · waiting for setup to begin'};
}
