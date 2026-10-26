import test from 'node:test';
import assert from 'node:assert/strict';
import {hourChartCandles} from '../public/token-ui.js';
test('candles preserve real high/low and direction, handle flat markets and reject invalid bars',()=>{
 const chart={unit:'QUAI',start:100,end:3700,candles:[{time:100,open:2,high:4,low:1,close:3},{time:3700,open:3,high:3,low:1,close:2}]};
 const result=hourChartCandles(chart);assert.equal(result.length,2);assert.equal(result[0].up,true);assert.equal(result[1].up,false);assert.equal(result[0].x,12);assert.equal(result[1].x,288);assert(result[0].top<result[0].body);
 assert.equal(hourChartCandles({...chart,candles:[{time:100,open:2,high:2,low:2,close:2}]}).length,1);
 assert.deepEqual(hourChartCandles(null),[]);
 assert.deepEqual(hourChartCandles({...chart,candles:[{...chart.candles[0],high:1}]}),[]);
 assert.deepEqual(hourChartCandles({...chart,candles:[{...chart.candles[0],time:99}]}),[]);
});
