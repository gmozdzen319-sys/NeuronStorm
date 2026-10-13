import assert from 'node:assert/strict';
import {Interface,getAddress} from 'quais';
import {feeAddress} from './fee-operation.mjs';
import {assertCanonicalBlock} from './head-guard.mjs';
const abi=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)']);
const label=value=>typeof value==='string'&&value.length>0&&value.length<=80&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
export function createFeeTokenReader(rpc){
 return async(plan,token,block)=>{
  const contract=feeAddress(token),owner=getAddress(plan.address);
  assert.equal(BigInt(await rpc('quai_chainId',[])),9n);await assertCanonicalBlock(rpc,block);
  const tag=block.woHeader.number,code=await rpc('quai_getCode',[contract,tag]);assert(/^0x(?:[0-9a-f]{2})+$/i.test(code)&&code!=='0x00','Token contract unavailable');
  const values=await Promise.all(['name','symbol','decimals','balanceOf'].map(async name=>abi.decodeFunctionResult(name,await rpc('quai_call',[{to:contract,data:abi.encodeFunctionData(name,name==='balanceOf'?[owner]:[])},tag]))[0]));
  const [name,symbol,precision,balance]=values,decimals=Number(precision);
  assert(label(name)&&label(symbol)&&Number.isInteger(decimals)&&decimals>=0&&decimals<=255&&balance>=0n,'Unsupported token metadata');
  await assertCanonicalBlock(rpc,block);
  return {contract,name,symbol,decimals,balanceWei:String(balance)};
 };
}
