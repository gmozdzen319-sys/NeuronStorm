export function hourChartCandles(chart){
 if(!chart||chart.unit!=='QUAI'||chart.end-chart.start!==3600||!Array.isArray(chart.candles)||!chart.candles.length||chart.candles.length>13)return [];
 const bars=chart.candles;
 if(bars.some((c,i)=>!Number.isFinite(c.time)||c.time<chart.start||c.time>chart.end||(i&&c.time<=bars[i-1].time)||![c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0)||c.low>Math.min(c.open,c.close)||c.high<Math.max(c.open,c.close)))return [];
 const low=Math.min(...bars.map(c=>c.low)),high=Math.max(...bars.map(c=>c.high)),span=high-low,y=v=>span?78-(v-low)/span*62:47;
 return bars.map(c=>({x:12+(c.time-chart.start)/3600*276,top:y(c.high),bottom:y(c.low),body:Math.min(y(c.open),y(c.close)),height:Math.max(1.5,Math.abs(y(c.open)-y(c.close))),up:c.close>=c.open}));
}
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
  const chart=document.createElement('div');chart.className='token-hour-chart';chart.hidden=true;
  chart.innerHTML='<svg viewBox="0 0 300 100" role="img" aria-label="NS price over the last hour"></svg>';
  $('.brand-group').append(chart);
  function drawChart(data){
    const bars=hourChartCandles(data?.hourChart);chart.hidden=!bars.length;
    const svg=chart.querySelector('svg');svg.replaceChildren();
    for(const bar of bars){
      const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.setAttribute('class',bar.up?'candle-up':'candle-down');
      const wick=document.createElementNS(svg.namespaceURI,'line');for(const [k,v] of Object.entries({x1:bar.x,x2:bar.x,y1:bar.top,y2:bar.bottom}))wick.setAttribute(k,String(v));
      const body=document.createElementNS(svg.namespaceURI,'rect');for(const [k,v] of Object.entries({x:bar.x-5,y:bar.body,width:10,height:bar.height,rx:.6}))body.setAttribute(k,String(v));
      group.append(wick,body);svg.append(group);
    }
    chart.title='NS/QUAI · Last hour · Quainance · Empty intervals keep the last traded price';
  }
  async function refreshMarket(){
    try{const data=await api('/api/token/market'),price=Number(data.priceUsd),change=data.changePercent;
      drawChart(data);
      $('#ns-price').textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumSignificantDigits:2,maximumSignificantDigits:5}).format(price)+' USD';
      const sign=change>0?'▲ +':change<0?'▼ −':'↔ ';
      $('#ns-change').textContent=change===null?'Change unavailable':sign+Math.abs(change).toFixed(2)+'%';
      $('#ns-change').className=change===null?'':change>0?'price-up':change<0?'price-down':'price-flat';
      $('#ns-price').className=$('#ns-change').className;
      $('.token-price-line').title='Change period: '+data.period+' · Source: Quainance · Pool '+data.pool+' · Checked '+new Date(data.checkedAt).toLocaleString();
    }catch{drawChart(null);$('#ns-price').textContent='Price unavailable';$('#ns-change').textContent='';$('#ns-change').className='';$('#ns-price').className='';$('.token-price-line').title='Quainance market data could not be refreshed.';}
  }
  refreshMarket();setInterval(()=>{if(!document.hidden)refreshMarket();},60000);
  $('#ns-balance').addEventListener('click',()=>$('#wallet-button').click());
  refreshPublic();setInterval(()=>{if(!document.hidden){refreshBalance();refreshPublic();}},30000);
  return {setAccount,refreshBalance};
}
