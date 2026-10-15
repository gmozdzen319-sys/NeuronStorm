import test from 'node:test';import assert from 'node:assert/strict';import {Interface} from 'quais';import {createFeeTokenReader} from '../wallet/fee-token.mjs';
const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)']);
const hash=n=>'0x'+String(n).repeat(64),block={hash:hash(1),woHeader:{hash:hash(1),number:'0x10',parentHash:hash(0),location:'0x0000',timestamp:'0x1000'},header:{quaiStateSize:'0x1',gasLimit:'0x989680'}},plan={address:'0x0000000000000000000000000000000000000001'},token='0x0000000000000000000000000000000000000002';
function fixture(options={}){let reads=0;const rpc=async(method,args=[])=>{if(method==='quai_chainId')return options.wrongChain?'0x1':'0x9';if(method==='quai_getBlockByNumber'){reads++;return options.reorg&&reads>1?{...block,hash:hash(2),woHeader:{...block.woHeader,hash:hash(2)}}:block;}if(method==='quai_getCode'){assert.equal(args[1],'0x10');return options.noCode?'0x':'0x6000';}if(method==='quai_call'){assert.equal(args[1],'0x10');const p=abi.parseTransaction({data:args[0].data});if(p.name==='balanceOf')assert.equal(p.args[0],plan.address);return abi.encodeFunctionResult(p.name,[{name:'Test token',symbol:options.badLabel?'bad\nlabel':'TEST',decimals:6,balanceOf:7000000n}[p.name]]);}throw Error(method);};return createFeeTokenReader(rpc);}
test('Fee token reader uses owner balance and one pinned block for metadata',async()=>{const r=await fixture()(plan,token,block);assert.equal(r.balanceWei,'7000000');assert.equal(r.decimals,6);assert.equal(r.symbol,'TEST');});
test('New compatible token addresses are accepted without a manually configured whitelist',async()=>{
 for(const address of ['0x0000000000000000000000000000000000000017','0x0000000000000000000000000000000000000421']){
  const r=await fixture()(plan,address,block);assert.equal(r.contract,address);assert.equal(r.balanceWei,'7000000');
 }
});
for(const issue of ['wrongChain','noCode','reorg','badLabel'])test('Fee token reader rejects '+issue,async()=>{await assert.rejects(fixture({[issue]:true})(plan,token,block));});
