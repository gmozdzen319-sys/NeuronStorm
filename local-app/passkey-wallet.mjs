import {getAddress,isQuaiAddress,Interface} from 'quais';
import {NS_TOKEN} from './neuron-token.mjs';

const erc20=new Interface(['function name() view returns(string)','function symbol() view returns(string)','function decimals() view returns(uint8)']);
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const WALLET_BLOCKED='Your wallet is not activated yet. Receiving, sending and device changes will be available after secure wallet setup is released.';
const label=value=>typeof value==='string'&&value.length>0&&value.length<=80&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
export function tokenAddress(value){
  try{const a=getAddress(value);if(!isQuaiAddress(a)||!a.toLowerCase().startsWith('0x00')||/^0x0+$/i.test(a))throw Error();return a;}catch{throw fail(400,'Enter a supported Cyprus-1 Quai token contract address.');}
}
export function createTokenMetadataReader(fetcher=fetch){
  let sequence=0;
  async function rpc(method,params){
    // Deliberately read-only; no relayer, key, transaction signer or broadcast method.
    const id=++sequence;
    const response=await fetcher('https://rpc.quai.network/cyprus1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),signal:AbortSignal.timeout(10000)});
    const text=await response.text();if(text.length>65536)throw Error();const data=JSON.parse(text);
    if(!response.ok||data.error||data.id!==id||data.jsonrpc!=='2.0')throw Error();return data.result;
  }
  return async contract=>{
    const address=tokenAddress(contract);
    try{
      if(BigInt(await rpc('quai_chainId',[]))!==9n)throw Error();
      const code=await rpc('quai_getCode',[address,'latest']);if(!/^0x[0-9a-f]+$/i.test(code)||code==='0x00')throw Error();
      const values=[];
      for(const fn of ['name','symbol','decimals']){
        const data=await rpc('quai_call',[{to:address,data:erc20.encodeFunctionData(fn)},'latest']);
        values.push(erc20.decodeFunctionResult(fn,data)[0]);
      }
      const [name,symbol,d]=values,decimals=Number(d);
      if(!label(name)||!label(symbol)||!Number.isInteger(decimals)||decimals<0||decimals>36)throw Error();
      return {contract:address,name,symbol,decimals};
    }catch{throw fail(422,'This contract could not be verified as a supported token. Try again later or check its address.');}
  };
}
export function createPasskeyWallet(db,{readMetadata=createTokenMetadataReader()}={}){
  const requireAccount=a=>{if(!a||a.method!=='passkey')throw fail(401,'Sign in with your passkey.');};
  return {
    async state(account){requireAccount(account);return {accountId:account.id,status:'awaiting_review',address:null,chainId:9,quaiBalance:null,nsBalance:null,
      tokens:await db.prepare('SELECT contract,name,symbol,decimals FROM passkey_tokens WHERE account_id=$1 ORDER BY symbol,contract').all(account.id),
      receiveAvailable:false,sendAvailable:false,deviceChangesAvailable:false,reason:WALLET_BLOCKED};},
    async preview(account,input){requireAccount(account);return readMetadata(input.contract);},
    async add(account,input){requireAccount(account);const metadata=await readMetadata(input.contract);
      if(metadata.contract.toLowerCase()===NS_TOKEN.address.toLowerCase())throw fail(409,'NS is already included in your wallet.');
      // Re-read metadata and require the user's reviewed result, not arbitrary labels.
      for(const key of ['name','symbol','decimals'])if(input[key]!==metadata[key])throw fail(409,'Token details changed. Review them again.');
      const result=await db.prepare('INSERT INTO passkey_tokens VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING').run(account.id,metadata.contract.toLowerCase(),metadata.name,metadata.symbol,metadata.decimals);
      if(!result.changes)throw fail(409,'This token is already in your wallet.');return {added:true};},
    blocked(account){requireAccount(account);throw fail(423,WALLET_BLOCKED);}
  };
}
