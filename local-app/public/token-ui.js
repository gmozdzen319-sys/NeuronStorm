export function createTokenUI({api,onExpired}){
  const $=s=>document.querySelector(s);let account=null,epoch=0,busy=false;
  function setAccount(next){if(account?.address!==next?.address){epoch++;$('#ns-balance').textContent='NS balance: loading…';$('#ns-balance').removeAttribute('title');}account=next;$('#ns-balance').hidden=!next;if(next)refreshBalance();}
  async function refreshBalance(){
    if(!account||busy)return;busy=true;const current=epoch,owner=account.address;
    try{const data=await api('/api/token/balance');if(current!==epoch||account?.address!==owner)return;
      const [whole,fraction='']=data.balance.split('.');let display=BigInt(whole).toLocaleString('en-US');if(fraction)display+='.'+fraction.slice(0,6).replace(/0+$/,'');display=display.replace(/\.$/,'');if(whole==='0'&&fraction&&!/[1-9]/.test(fraction.slice(0,6)))display='<0.000001';
      $('#ns-balance').textContent=display+' NS';$('#ns-balance').title=data.balance+' NS · Quai Mainnet · Block '+data.block+' · Checked '+new Date(data.updatedAt).toLocaleTimeString();
    }catch(error){if(current!==epoch)return;$('#ns-balance').textContent='NS balance unavailable';$('#ns-balance').title='Unable to refresh the balance. It is not zero.';if(error.httpStatus===401)await onExpired();}finally{busy=false;}
  }
  async function refreshPublic(){try{const data=await api('/api/token');$('#ns-public-stats').textContent='Supply '+BigInt(data.totalSupply.split('.')[0]).toLocaleString('en-US')+' NS · Quai Mainnet';$('#ns-public-stats').title='From Quai Network · Block '+data.block+' · '+data.updatedAt;}catch{$('#ns-public-stats').textContent='Quai Mainnet · Stats unavailable';}}
  async function refreshMarket(){
    try{const data=await api('/api/token/market'),price=Number(data.priceUsd),change=data.changePercent;
      $('#ns-price').textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumSignificantDigits:2,maximumSignificantDigits:5}).format(price)+' USD';
      const sign=change>0?'▲ +':change<0?'▼ −':'↔ ';
      $('#ns-change').textContent=change===null?'Change unavailable':sign+Math.abs(change).toFixed(2)+'% ('+data.period+')';
      $('#ns-change').className=change===null?'':change>0?'price-up':change<0?'price-down':'price-flat';
      $('.token-price-line').title='Source: GeckoTerminal · Quainance pool '+data.pool+' · Checked '+new Date(data.checkedAt).toLocaleString();
    }catch{$('#ns-price').textContent='Price unavailable';$('#ns-change').textContent='';$('#ns-change').className='';$('.token-price-line').title='GeckoTerminal market data could not be refreshed.';}
  }
  refreshMarket();setInterval(()=>{if(!document.hidden)refreshMarket();},60000);
  $('#ns-balance').addEventListener('click',()=>$('#wallet-button').click());
  refreshPublic();setInterval(()=>{if(!document.hidden){refreshBalance();refreshPublic();}},30000);
  return {setAccount,refreshBalance};
}
