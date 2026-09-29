const labels = { connect: 'wallet connection', challenge: 'message preparation', sign: 'message signing', account: 'account check', verify: 'server verification' };
async function atStage(stage, action) {
  try { return await action(); }
  catch (cause) {
    const error = new Error(cause?.message || 'The operation failed.', { cause });
    error.stage = stage;
    error.code = cause?.code ?? cause?.error?.code ?? cause?.info?.error?.code;
    throw error;
  }
}
export async function connectWallet(provider) {
  if (!provider?.request) throw new Error('Pelagus was not detected. Open this page in a browser with Pelagus installed, then refresh it.');
  return atStage('connect', async () => {
    const accounts = await provider.request({ method: 'quai_requestAccounts', params: [] });
    if (!Array.isArray(accounts) || !/^0x[0-9a-f]{40}$/i.test(accounts[0] || '')) throw new Error('Pelagus did not provide a QUAI account.');
    return accounts[0];
  });
}
export async function signIn(provider, address, api, progress = () => {}) {
  const selected = await atStage('account', () => provider.request({ method: 'quai_accounts', params: [] }));
  if (selected?.[0]?.toLowerCase() !== address.toLowerCase()) throw new Error('The account has changed. Please start signing in again.');
  const challenge = await atStage('challenge', () => api('/api/challenge', { address }));
  progress('Sign the sign-in message in Pelagus…');
  // Confirmed against Pelagus personal_sign and quais JsonRpcSigner.signMessage.
  const bytes = new TextEncoder().encode(challenge.message);
  const message = '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const signature = await atStage('sign', () => provider.request({ method: 'personal_sign', params: [message, address.toLowerCase()] }));
  if (typeof signature !== 'string' || !/^0x[0-9a-f]{130}$/i.test(signature)) throw new Error('Pelagus returned an invalid signature format.');
  const current = await atStage('account', () => provider.request({ method: 'quai_accounts', params: [] }));
  if (current?.[0]?.toLowerCase() !== address.toLowerCase()) throw new Error('The account has changed. Please start signing in again.');
  progress('Verifying your signature…');
  return atStage('verify', () => api('/api/verify', { id: challenge.id, signature }));
}
export async function authenticate(provider, api, progress = () => {}) {
  return signIn(provider, await connectWallet(provider), api, progress);
}
export function walletError(error) {
  const code = error?.code ?? error?.error?.code ?? error?.info?.error?.code;
  const stage = labels[error?.stage] || 'sign-in';
  const detail = `Stage: ${stage}${code !== undefined ? `; code: ${String(code).replace(/[^a-zA-Z0-9_-]/g, '').slice(0,32)}` : ''}.`;
  if (Number(code) === 4001 || code === 'ACTION_REJECTED') return `Pelagus did not complete the request. It may have been declined, the window may have closed, or a wallet error may have occurred. The code alone cannot distinguish these causes.\n${detail}\nIf you did not decline the request, unlock Pelagus and try again.`;
  if (Number(code) === -32002) return `Pelagus is waiting for a response to an earlier request. Open the wallet window.\n${detail}`;
  if (Number(code) === 4100) return `Pelagus has not granted this website access to this account. Connect your wallet again.\n${detail}`;
  if ([4200,-32601].includes(Number(code))) return `This version of Pelagus does not support the required operation. Check for an extension update.\n${detail}`;
  if ([4900,4901].includes(Number(code))) return `Pelagus is disconnected. Open the wallet and check its connection.\n${detail}`;
  if (['connect','sign','account'].includes(error?.stage)) return `Pelagus could not complete the request. Check the wallet window and try again.\n${detail}`;
  return `${error?.message || 'Sign-in failed. Please try again.'}${error?.stage ? '\n' + detail : ''}`;
}
