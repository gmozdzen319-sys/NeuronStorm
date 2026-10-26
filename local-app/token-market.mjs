import {NS_TOKEN} from './neuron-token.mjs';
const ROOT='https://www.quainance.com';
const TOKEN=NS_TOKEN.address.toLowerCase();
const QUOTE='0x006c3e2aaae5db1bcd11a1a097ce572312eaddbb';
const uint=value=>typeof value==='string'&&/^\d+$/.test(value)&&value.length<=80;
export function parseLaunch(response){
  if(response?.data?._meta?.hasIndexingErrors!==false)throw new Error('Index unavailable');
  const launch=response.data.tradeLaunches?.find(l=>l.token===TOKEN&&l.source==='QUAINANCE_LAUNCHER'&&l.quoteToken===QUOTE&&l.phase==='POOLED');
  if(!launch||!/^0x[0-9a-f]{40}$/.test(launch.pair?.address)||!uint(launch.latestPriceQuoteE12)||!uint(launch.createdAtTimestamp))throw new Error('NS market unavailable');
  return launch;
}
export function parseMarket(launch,quote,history,now=Date.now()){
  const q=quote?.quai,quoteTime=Date.parse(q?.takenAt),created=Number(launch.createdAtTimestamp)*1000;
  if(q?.source!=='mexc'||typeof q.usd!=='number'||!Number.isFinite(q.usd)||q.usd<=0||!Number.isFinite(quoteTime)||quoteTime>now+60000||now-quoteTime>1800000||created>now)throw new Error('USD quote unavailable');
  let price=BigInt(launch.latestPriceQuoteE12),changePercent=null,hourChart=null;
  const data=history?.payload?.data,anchor=history?.anchor;
  const validHistory=data?._meta?.hasIndexingErrors===false&&Number.isSafeInteger(anchor?.timestamp)&&Math.abs(now/1000-anchor.timestamp)<300&&history?.input?.token===TOKEN&&history?.input?.marketAddress===launch.pair.address;
  if(validHistory){
    const valid=row=>row?.token===TOKEN&&row?.quoteToken===QUOTE&&row?.marketAddress===launch.pair.address;
    const state=data.tradeMarketStates?.find(valid);
    if(state&&uint(state.latestPriceQuoteE12))price=BigInt(state.latestPriceQuoteE12);
    const candles=(data.candles||[]).filter(c=>valid(c)&&uint(c.timestamp)&&uint(c.openPriceQuoteE12)&&uint(c.closePriceQuoteE12)&&c.interval===300).sort((a,b)=>Number(a.timestamp)-Number(b.timestamp));
    const end=Math.floor(now/1000),start=end-3600;
    const bars=candles.filter(c=>uint(c.highPriceQuoteE12)&&uint(c.lowPriceQuoteE12)).map(c=>({time:Number(c.timestamp),open:Number(c.openPriceQuoteE12)/1e12,high:Number(c.highPriceQuoteE12)/1e12,low:Number(c.lowPriceQuoteE12)/1e12,close:Number(c.closePriceQuoteE12)/1e12})).filter(c=>Number.isSafeInteger(c.time)&&c.time<=end&&[c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0)&&c.low<=Math.min(c.open,c.close)&&c.high>=Math.max(c.open,c.close));
    const recent=bars.filter(c=>c.time>=start);
    // Empty trading intervals retain the last observed close, never a random price.
    const previous=bars.filter(c=>c.time<start).at(-1);
    if(recent.length||previous){
      const filled=[];let last=previous?.close;
      for(let time=Math.ceil(start/300)*300;time<=end;time+=300){
        const bar=recent.find(c=>c.time===time);
        if(bar){filled.push(bar);last=bar.close;}
        else if(last)filled.push({time,open:last,high:last,low:last,close:last,noTrades:true});
      }
      if(filled.length)hourChart={start,end,unit:'QUAI',candles:filled};
    }
    const cutoff=Math.floor(now/1000)-86400;
    const earlier=candles.filter(c=>Number(c.timestamp)+300<=cutoff).at(-1);
    const baseline=earlier?earlier.closePriceQuoteE12:now-created<86400000?candles[0]?.openPriceQuoteE12:null;
    if(baseline&&BigInt(baseline)>0n){const change=Number((price-BigInt(baseline))*1000000n/BigInt(baseline))/10000;if(Number.isFinite(change))changePercent=change;}
  }
  const priceUsd=Number(price)/1e12*q.usd;if(!Number.isFinite(priceUsd)||priceUsd<=0)throw new Error('Invalid price');
  return {hourChart,priceUsd:String(priceUsd),changePercent,period:now-created<86400000?'since launch · QUAI':'24h · QUAI',source:'Quainance',dex:'Quainance',pool:launch.pair.address,quoteAt:q.takenAt,checkedAt:new Date(now).toISOString()};
}
export function createMarketReader(fetcher=fetch){
  let cached=null;
  async function request(path){const response=await fetcher(ROOT+path,{signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Quainance unavailable');return response.json();}
  return async()=>{
    if(cached&&Date.now()-cached.time<60000)return cached.promise;
    const promise=(async()=>{try{
      const [market,quote]=await Promise.all([request('/api/trade-zone/market?address='+TOKEN),request('/api/quai-explorer/price/current')]);
      const launch=parseLaunch(market),params=new URLSearchParams({marketAddress:launch.pair.address,token:TOKEN,quoteToken:QUOTE,kind:'AMM',interval:'300',before:String(Math.floor(Date.now()/1000)),count:'500'});
      let history;try{history=await request('/api/trade-zone/history?'+params);}catch{}
      return parseMarket(launch,quote,history);
    }catch{throw Object.assign(new Error('Quainance price is unavailable. Please try again shortly.'),{status:502});}})();
    cached={time:Date.now(),promise};return promise;
  };
}
