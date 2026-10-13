import test from 'node:test';
import assert from 'node:assert/strict';
import {transferReviewText} from '../public/passkey-ui.js';
const review={amount:'7',symbol:'TOKEN',wallet:'wallet',recipient:'recipient',network:'Quai Mainnet · Cyprus-1',token:'token',networkFee:'1.0',serviceFee:'0.05',totalFee:'1.05',feeCurrency:'QUAI',feePaidBy:'Your wallet'};
test('Fee review distinguishes full token amount, quoted cost and 5% service fee',()=>{
 const text=transferReviewText(review);assert.match(text,/Send 7 TOKEN/);assert.match(text,/Service fee \(5%\): 0.05 QUAI/);assert.match(text,/Total fee from your wallet: 1.05 QUAI/);assert.match(text,/actual network usage may differ/);
});
test('Inconsistent fee review fails before Passkey confirmation',()=>{
 for(const change of [{serviceFee:'0.06'},{totalFee:'1.0'},{feeCurrency:'NS'},{feePaidBy:'Neuron Storm relayer'},{networkFee:'1e18'}])assert.throws(()=>transferReviewText({...review,...change}));
});
test('Legacy sponsored review remains unchanged',()=>{assert.match(transferReviewText({amount:'0.007',wallet:'a',recipient:'b',network:'Quai',maximumFee:'30',feePaidBy:'Neuron Storm relayer'}),/Maximum network fee: 30 QUAI · paid by Neuron Storm relayer/);});
