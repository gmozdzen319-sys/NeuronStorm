import {formatBalance} from './holdings.mjs';
export const NS_TOKEN = Object.freeze({address:'0x003bc332Ef45fdd554F9e81786be6312A72540E6',name:'Neuron Storm',symbol:'NS',decimals:18,chainId:9});
const RPC='https://rpc.quai.network/cyprus1';
export function createNeuronReader(fetcher=fetch){
  const cache=new Map();
  async function rpc(method,params){
    const response=await fetcher(RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Network unavailable');
    const data=await response.json();if(data.error||typeof data.result!=='string'||!/^0x[0-9a-f]+$/i.test(data.result))throw new Error('Invalid network response');return data.result;
  }
  async function read(address){
    const key=address?.toLowerCase()||'stats',existing=cache.get(key);
    if(existing&&Date.now()-existing.time<30000)return existing.promise;
    const promise=(async()=>{try{
      if(BigInt(await rpc('quai_chainId',[]))!==9n)throw new Error('Wrong network');
      const block=await rpc('quai_blockNumber',[]);
      const call=async data=>{const value=await rpc('quai_call',[{to:NS_TOKEN.address,data},block]);if(!/^0x[0-9a-f]{64}$/i.test(value))throw new Error('Invalid contract result');return BigInt(value).toString();};
      const result={token:NS_TOKEN,network:'Quai Mainnet',block:BigInt(block).toString(),updatedAt:new Date().toISOString()};
      if(address){if(!/^0x[0-9a-f]{40}$/i.test(address))throw new Error('Invalid address');result.address=address;result.balance=formatBalance(await call('0x70a08231'+address.slice(2).toLowerCase().padStart(64,'0')),18);}
      else{result.totalSupply=formatBalance(await call('0x18160ddd'),18);}
      return result;
    }catch{cache.delete(key);throw Object.assign(new Error('Neuron Storm data is unavailable. Please try again shortly.'),{status:502});}})();
    if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(key,{time:Date.now(),promise});return promise;
  }
  return read;
}
