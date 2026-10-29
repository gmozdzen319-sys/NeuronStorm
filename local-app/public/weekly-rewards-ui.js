import {getWalletProvider} from './wallet-provider.js';
const wallet='0x001d5be0940145de0c2c1d851b99f33968ded764';
const node=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
export function renderWeeklyAdmin(api,result,host,refresh){
 const box=node('section','','reputation-card');box.append(node('h3','Weekly NS rewards'));
 if(!result.rewardSnapshot){box.append(node('p',result.round.status==='open'?'Projected rewards are shown in the live ranking. Payments open the day after the round closes.':'This round predates weekly reward snapshots. No automatic retrospective payments.','field-hint'));host.append(box);return;}
 const total=result.weeklyRewards.reduce((n,r)=>n+BigInt(r.units),0n);box.append(node('p','Frozen rewards: '+(total/10n**18n)+' NS · Full awards for tied places.'),node('p','Payable from '+new Date(result.rewardSnapshot.payable_at).toISOString(),'field-hint'));
 for(const r of result.weeklyRewards){
  const item=node('article','','reputation-event'),amount=String(BigInt(r.units)/10n**18n);item.append(node('strong',`${['🥇','🥈','🥉'][r.final_rank-1]||r.final_rank} ${r.nickname}`),node('p',(r.weekly_units/100)+' Weekly Score · '+amount+' NS'),node('code',r.recipient||'Recipient unavailable — review required','address'));
  const status=node('p','','field-hint');item.append(status);
  if(r.status==='paid'){item.append(node('strong','PAID ✓'));const link=node('a',r.tx_hash,'address');link.href='https://quaiscan.io/tx/'+r.tx_hash;link.target='_blank';link.rel='noopener noreferrer';item.append(link);}
  else if(r.status==='pending'){
   status.textContent='Awaiting verification. Do not send again. If no hash was returned, retrieve it from reward wallet activity.';
   const input=node('input');input.type='text';input.placeholder='Transaction hash';input.setAttribute('aria-label','Reward transaction hash');input.value=r.attempt_hash||'';try{input.value ||= localStorage.getItem('ns-weekly-reward:'+r.attempt_id)||'';}catch{}
   const check=node('button','Check payment','login');check.type='button';check.onclick=async()=>{check.disabled=true;try{const response=await api('/api/admin/weekly-rewards/confirm',{attemptId:r.attempt_id,txHash:input.value.trim()});if(response.status==='pending')status.textContent='Awaiting canonical confirmation. Do not send again.';else await refresh();}catch(e){status.textContent=e.message;}finally{check.disabled=false;}};item.append(input,check);
   // Read/verify only; never call wallet signing again while reconciling.
   const poll=async()=>{if(!item.isConnected)return;if(!document.hidden&&r.attempt_hash&&!check.disabled)await check.onclick();if(item.isConnected)setTimeout(poll,8000);};if(r.attempt_hash)setTimeout(poll,8000);
  }else{
   const send=node('button','SEND','login');send.type='button';send.disabled=!r.recipient||result.serverTime<result.rewardSnapshot.payable_at;
   send.onclick=async()=>{
    if(!confirm(`Send ${amount} NS to ${r.recipient}? Approve this single transfer in the reward wallet. The wallet also pays network gas.`))return;
    send.disabled=true;let intent=null;
    try{
     const provider=getWalletProvider();if(!provider?.request)throw Error('Open the reward wallet to authorize payment.');
     const accounts=await provider.request({method:'quai_accounts',params:[]});if(accounts?.[0]?.toLowerCase()!==wallet)throw Error('Select the reward wallet and sign in with it.');
     if(BigInt(await provider.request({method:'quai_chainId',params:[]}))!==9n)throw Error('Select Quai Mainnet.');
     intent=await api('/api/admin/weekly-rewards/prepare',{rewardId:r.id});status.textContent='Approve the exact NS transfer in your wallet.';
     const current=await provider.request({method:'quai_accounts',params:[]});if(current?.[0]?.toLowerCase()!==wallet)throw Error('Wallet account changed. No new request will be made.');
     if(BigInt(await provider.request({method:'quai_chainId',params:[]}))!==9n)throw Error('Network changed. Check the prepared payment before continuing.');
     const txHash=await provider.request({method:'quai_sendTransaction',params:[intent.transaction]});if(!/^0x[0-9a-f]{64}$/i.test(txHash||''))throw Error('No hash returned. Check wallet activity; do not send again.');
     try{localStorage.setItem('ns-weekly-reward:'+intent.id,txHash);}catch{}
     await api('/api/admin/weekly-rewards/confirm',{attemptId:intent.id,txHash});await refresh();
    }catch(e){status.textContent=e.message;if(intent){send.hidden=true;const check=node('button','Check existing payment','login');check.type='button';check.onclick=refresh;item.append(check);}else send.disabled=false;}
   };item.append(send);
  }
  box.append(item);
 }
 host.append(box);
}
