import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMarket,createMarketReader} from '../token-market.mjs';
import {NS_TOKEN} from '../neuron-token.mjs';
const now=Date.parse('2026-09-30T14:00:00Z');
const pool=(overrides={})=>({attributes:{address:'0x004c34431811b2d34b2351e0bb88e86520e8564f',base_token_price_usd:'0.000008929374533',reserve_in_usd:'76',pool_created_at:'2026-09-30T11:34:00Z',price_change_percentage:{h24:'337.7'},...overrides},relationships:{base_token:{data:{id:'quai-network_'+NS_TOKEN.address.toLowerCase()}},dex:{data:{id:'quainance'}}}});
test('market selects NS base-token Quainance pool with highest liquidity',()=>{
 const other=pool({reserve_in_usd:'900'});other.relationships.base_token.data.id='another-token';
 const data=parseMarket({data:[other,pool(),pool({reserve_in_usd:'100',base_token_price_usd:'0.00001'})]},now);
 assert.equal(data.priceUsd,'0.00001');assert.equal(data.changePercent,337.7);assert.equal(data.period,'since launch');
});
test('market distinguishes losses, no change, missing change and mature 24h history',()=>{
 for(const [value,expected] of [['-2.5',-2.5],['0',0],[null,null],['',null]]){
 const data=parseMarket({data:[pool({pool_created_at:'2026-09-28T00:00:00Z',price_change_percentage:{h24:value}})]},now);
 assert.equal(data.changePercent,expected);assert.equal(data.period,'24h');
 }
 assert.throws(()=>parseMarket({data:[]},now));assert.throws(()=>parseMarket({data:[pool({base_token_price_usd:'NaN'})]},now));
});
test('market caches quotes and rate-limit failures without inventing zeros',async()=>{
 let count=0;const read=createMarketReader(async()=>{count++;return{ok:true,json:async()=>({data:[pool()]})};});
 await read();await read();assert.equal(count,1);
 let failed=0;const unavailable=createMarketReader(async()=>{failed++;return{ok:false};});
 await assert.rejects(unavailable(),e=>e.status===502);await assert.rejects(unavailable(),e=>e.status===502);assert.equal(failed,1);
});
