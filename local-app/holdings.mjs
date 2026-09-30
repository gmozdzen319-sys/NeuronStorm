// Quaiscan account API: https://docs.quaiscan.io/developer-support/api/rpc-endpoints/account
export function formatBalance(value, decimals) {
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid balance');
  const digits = BigInt(value).toString().padStart(decimals + 1, '0');
  if (!decimals) return digits;
  const fraction = digits.slice(-decimals).replace(/0+$/, '');
  return digits.slice(0, -decimals) + (fraction ? '.' + fraction : '');
}
export function createHoldingsReader(fetcher = fetch) {
  const cache = new Map();
  return async address => {
    const key = address.toLowerCase(), saved = cache.get(key);
    if (saved && Date.now() - saved.at < 15000) return saved.promise;
    async function request(action) {
      const url = new URL('https://quaiscan.io/api');
      url.search = new URLSearchParams({module:'account',action,address});
      const response = await fetcher(url, {signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('Explorer unavailable');
      const data = await response.json();
      if (data.status !== '1' && !(action === 'tokenlist' && data.status === '0' && data.message === 'No tokens found' && Array.isArray(data.result) && !data.result.length)) throw new Error('Explorer error');
      return data.result;
    }
    const promise = (async () => {
      try {
        const [balance, tokens] = await Promise.all([request('balance'), request('tokenlist')]);
        if (!Array.isArray(tokens)) throw new Error('Invalid token list');
        const assets = [{name:'Quai',symbol:'QUAI',type:'Native',contract:null,balance:formatBalance(balance,18)}];
        for (const token of tokens) {
          if (!/^0x[0-9a-f]{40}$/i.test(token.contractAddress)) throw new Error('Invalid contract');
          const decimals = token.type === 'ERC-721' || token.type === 'ERC-1155' ? 0 : (token.decimals === null || token.decimals === undefined || token.decimals === '' ? null : Number(token.decimals));
          const formatted = formatBalance(token.balance, decimals ?? 0);
          if (BigInt(token.balance) === 0n) continue;
          assets.push({name:String(token.name || 'Unnamed token').slice(0,160),symbol:String(token.symbol || '').slice(0,40),type:String(token.type || 'Token').slice(0,30),contract:token.contractAddress,balance:formatted,rawUnits:decimals === null});
        }
        return {address,network:'Quai Mainnet',assets,updatedAt:new Date().toISOString()};
      } catch { cache.delete(key); throw Object.assign(new Error('Wallet balances are unavailable. Please try again shortly.'), {status:502}); }
    })();
    if(cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(key,{at:Date.now(),promise});
    return promise;
  };
}
