import {NS_TOKEN} from './neuron-token.mjs';
const endpoint=`https://api.geckoterminal.com/api/v2/networks/quai-network/tokens/${NS_TOKEN.address.toLowerCase()}/pools`;
const numeric=value=>typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value));
export function parseMarket(data,now=Date.now()){
  const pools=(Array.isArray(data?.data)?data.data:[]).filter(p=>p.relationships?.base_token?.data?.id===`quai-network_${NS_TOKEN.address.toLowerCase()}`&&p.relationships?.dex?.data?.id==='quainance'&&numeric(p.attributes?.base_token_price_usd)&&Number(p.attributes.base_token_price_usd)>0&&numeric(p.attributes?.reserve_in_usd)&&Number(p.attributes.reserve_in_usd)>0).sort((a,b)=>Number(b.attributes.reserve_in_usd)-Number(a.attributes.reserve_in_usd));
  if(!pools.length)throw new Error('No supported NS market');
  const p=pools[0],a=p.attributes,created=Date.parse(a.pool_created_at),change=a.price_change_percentage?.h24;
  if(!Number.isFinite(created)||created>now||!/^0x[0-9a-f]{40}$/i.test(a.address))throw new Error('Invalid market');
  return {priceUsd:a.base_token_price_usd,changePercent:numeric(change)?Number(change):null,period:now-created<86400000?'since launch':'24h',source:'GeckoTerminal',dex:'Quainance',pool:a.address,checkedAt:new Date(now).toISOString()};
}
export function createMarketReader(fetcher=fetch){
  let cached=null;
  return async()=>{
    if(cached&&Date.now()-cached.time<60000)return cached.promise;
    const promise=(async()=>{try{const response=await fetcher(endpoint,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});if(!response.ok)throw new Error('Unavailable');return parseMarket(await response.json());}catch{throw Object.assign(new Error('Token price is unavailable. Please try again shortly.'),{status:502});}})();
    // Cache failures too, so unavailable upstream services are not flooded.
    cached={time:Date.now(),promise};return promise;
  };
}
