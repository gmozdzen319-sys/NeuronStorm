import {isBlip,getWalletProvider} from './wallet-provider.js';
const q=new URLSearchParams(location.hash.slice(1)), id=q.get('id'),invite=q.get('invite'),method=q.get('method');
history.replaceState(null,'',location.pathname);
const el=id=>document.getElementById(id);
const getProvider=()=>method==='pelagus'?window.pelagus:getWalletProvider();
const provider=getProvider();
let heartbeat,address,busy=false,closed=false,timer;
const post=async(action,p)=>{
 const response=await fetch('/api/desktop/pair/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,...p}),cache:'no-store',signal:AbortSignal.timeout(2500)});
 const result=await response.json();if(!response.ok)throw Error(result.error||'Connection lost');return result;
};
function disconnect(reason){
 closed=true;clearInterval(timer);el('connect').disabled=true;el('stop').disabled=true;el('status').textContent=reason;
 if(heartbeat){const payload=JSON.stringify({id,heartbeat});heartbeat=null;navigator.sendBeacon('/api/desktop/pair/close',new Blob([payload],{type:'application/json'}));}
}
async function read(){
 if(!provider||getProvider()!==provider||!provider.on||isBlip(provider)!==(method==='blippay'))throw Error('Open this link in the selected wallet browser.');
 const [a,c]=await Promise.all(['quai_accounts','quai_chainId'].map(method=>provider.request({method,params:[]})));
 if(!/^0x00[0-7][0-9a-f]{37}$/i.test(a?.[0])||BigInt(c)!==9n)throw Error('Connect your signed-in Cyprus-1 wallet.');
 return a[0].toLowerCase();
}
async function renew(){
 if(closed||busy)return;busy=true;
 try{
  const {challenge}=await post('challenge',{heartbeat});
  if(await read()!==address||closed)throw Error('Wallet changed');
  await post('confirm',{heartbeat,challenge,address,method,chain:'9'});
  if(!closed)el('status').textContent='Wallet connected. Start mining on your computer.';
 }catch(e){disconnect(e.message);}finally{busy=false;}
}
try{
 if(!/^[a-f0-9]{64}$/.test(id)||!/^[a-f0-9]{64}$/.test(invite)||!['pelagus','blippay'].includes(method))throw Error('Open a new link from your desktop mining panel.');
 address=await read();el('address').textContent=address;el('code').textContent='Match this code on your computer: '+id.slice(0,8);
 for(const e of ['accountsChanged','chainChanged','disconnect'])provider.on(e,()=>disconnect('Wallet changed. Connect again from Desktop.'));
 window.addEventListener('pagehide',()=>disconnect('Page closed.'));
 document.addEventListener('visibilitychange',()=>{if(document.hidden)disconnect('Page hidden. Connect again from Desktop.');});
 el('connect').disabled=false;el('connect').onclick=async()=>{
  el('connect').disabled=true;
  try{if(closed||await read()!==address)throw Error('Wallet changed');
   ({heartbeat}=await post('claim',{invite,method,address}));if(closed)return disconnect('Connection cancelled.');
   el('stop').disabled=false;await renew();if(!closed)timer=setInterval(renew,900);
  }catch(e){disconnect(e.message);}
 };
 el('stop').onclick=()=>disconnect('Disconnected.');
}catch(e){disconnect(e.message);}
