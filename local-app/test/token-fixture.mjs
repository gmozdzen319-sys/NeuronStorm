// Deterministic network fixture, never used by the production server.
export async function mockTokenFetch(url,options){
  const {method,params}=JSON.parse(options.body);
  const result=method==='quai_chainId'?'0x9':method==='quai_blockNumber'?'0x12345':'0x'+(params[0].data==='0x18160ddd'?10000000n*10n**18n:1234567890000000000000n).toString(16).padStart(64,'0');
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};
}
