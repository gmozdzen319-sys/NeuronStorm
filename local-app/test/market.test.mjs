import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMarket,parseLaunch,createMarketReader} from '../token-market.mjs';
import {NS_TOKEN} from '../neuron-token.mjs';
const now=Date.now(),token=NS_TOKEN.address.toLowerCase(),quoteToken='0x006c3e2aaae5db1bcd11a1a097ce572312eaddbb',marketAddress='0x004c34431811b2d34b2351e0bb88e86520e8564f';
const launch={token,source:'QUAINANCE_LAUNCHER',quoteToken,phase:'POOLED',latestPriceQuoteE12:'2000000',createdAtTimestamp:String(Math.floor(now/1000)-3600),pair:{address:marketAddress}};
const quote={quai:{usd:.01,source:'mexc',takenAt:new Date(now).toISOString()}};
function history(price='2000000',baseline='1000000',timestamp=Math.floor(now/1000)-3300){return {input:{token,marketAddress},anchor:{timestamp:Math.floor(now/1000)},payload:{data:{_meta:{hasIndexingErrors:false},tradeMarketStates:[{token,quoteToken,marketAddress,latestPriceQuoteE12:price}],candles:[{token,quoteToken,marketAddress,interval:300,timestamp:String(timestamp),openPriceQuoteE12:baseline,closePriceQuoteE12:baseline}]}}};}
test('Quainance price combines its exact NS quote with its USD feed',()=>{
 const r=parseMarket(launch,quote,history(),now);assert.equal(Number(r.priceUsd),.00000002);assert.equal(r.changePercent,100);assert.equal(r.source,'Quainance');assert.equal(r.period,'since launch · QUAI');
 assert.equal(parseLaunch({data:{_meta:{hasIndexingErrors:false},tradeLaunches:[launch]}}),launch);
 assert.throws(()=>parseLaunch({data:{_meta:{hasIndexingErrors:false},tradeLaunches:[{...launch,token:'wrong'}]}}));
});
test('Quainance changes preserve loss, flat and 24h candle baseline',()=>{
 assert.equal(parseMarket(launch,quote,history('500000'),now).changePercent,-50);
 assert.equal(parseMarket(launch,quote,history('1000000'),now).changePercent,0);
 const old={...launch,createdAtTimestamp:String(Math.floor(now/1000)-172800)};
 const result=parseMarket(old,quote,history('2000000','1000000',Math.floor(now/1000)-87000),now);assert.equal(result.period,'24h · QUAI');assert.equal(result.changePercent,100);
 assert.equal(parseMarket(old,quote,history(),now).changePercent,null);
});
test('missing or stale Quainance history does not invent a change; stale USD fails',()=>{
 assert.equal(parseMarket(launch,quote,undefined,now).changePercent,null);
 const stale=history();stale.anchor.timestamp-=400;assert.equal(parseMarket(launch,quote,stale,now).changePercent,null);
 const wrong=history();wrong.input.token='wrong';assert.equal(parseMarket(launch,quote,wrong,now).changePercent,null);
 assert.throws(()=>parseMarket(launch,{quai:{...quote.quai,takenAt:new Date(now-1900000).toISOString()}},history(),now));
});
test('reader uses only Quainance endpoints and caches successes and failures',async()=>{
 const urls=[];const reader=createMarketReader(async url=>{urls.push(url);return {ok:true,json:async()=>url.includes('/market?')?{data:{_meta:{hasIndexingErrors:false},tradeLaunches:[launch]}}:url.includes('/history?')?history():quote};});
 await reader();await reader();assert.equal(urls.length,3);assert.ok(urls.every(url=>url.startsWith('https://www.quainance.com/api/')));
 let count=0;const failed=createMarketReader(async()=>{count++;return{ok:false};});await assert.rejects(failed(),e=>e.status===502);await assert.rejects(failed(),e=>e.status===502);assert.equal(count,2);
});
