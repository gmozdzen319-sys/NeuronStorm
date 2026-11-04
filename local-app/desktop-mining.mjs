import {createPrivateKey, sign} from 'node:crypto';

const fail = (status, code) => Object.assign(new Error(code), {status, code});
const originName = 'https://neuronstorm.onrender.com';
const payable = address => typeof address === 'string' &&
  /^0x00[0-7][a-f0-9]{37}$/i.test(address) && !/^0x0{40}$/i.test(address);

export function createDesktopMining({db, feeWallet, origin, now = Date.now,
  keyPem = process.env.NS_DESKTOP_IDENTITY_KEY, payoutVerified = false}) {
  const key = keyPem ? createPrivateKey(keyPem) : null;
  if (key && key.asymmetricKeyType !== 'ed25519') throw Error('Expected Ed25519 identity key');
  return async function attest(account, challenge, observed) {
    if (!key) throw fail(503,'DESKTOP_MINING_NOT_ENABLED');
    if (origin !== originName && origin !== originName + '/') throw fail(503,'DESKTOP_ORIGIN_INVALID');
    if (!account) throw fail(401,'LOGIN_REQUIRED');
    if (!/^[a-f0-9]{64}$/.test(challenge || '')) throw fail(400,'INVALID_DESKTOP_CHALLENGE');
    let wallet, method, owner, generation;
    if (account.method === 'passkey') {
      if (!account.id || observed) throw fail(409,'SESSION_METHOD_CHANGED');
      const row = await feeWallet?.registry.load(db,account.id);
      if (!row || row.account_id !== account.id || row.generation !== 3 || row.revoked_at !== null)
        throw fail(423,'ACTIVE_V3_REQUIRED');
      const approval = await db.prepare('SELECT phase FROM passkey_fee_approvals WHERE account_id=$1').all(account.id);
      if (approval.length !== 1 || approval[0].phase !== 'confirmed') throw fail(423,'CONFIRMED_ACTIVATION_REQUIRED');
      const state = await feeWallet.chain.snapshot(row.plan);
      if (!state.deployed) throw fail(423,'DEPLOYED_WALLET_REQUIRED');
      wallet = row.plan.address; method = 'passkey'; owner = account.id; generation = 3;
    } else {
      // externalAccount() obtains address only from a live session created by signature recovery.
      if (account.method || !['pelagus','blippay'].includes(observed?.method) ||
          observed.chain !== '9' || !payable(account.address) || typeof observed.address !== 'string' ||
          observed.address.toLowerCase() !== account.address.toLowerCase()) throw fail(409,'CONNECTED_WALLET_MISMATCH');
      wallet = account.address; method = observed.method; owner = wallet.toLowerCase(); generation = 0;
    }
    if (!payable(wallet)) throw fail(423,'CYPRUS1_QUAI_ADDRESS_REQUIRED');
    const issued = Math.floor(now()/1000);
    const payload = Buffer.from(JSON.stringify({purpose:'neuron-storm-mining-v2',origin:originName,
      challenge,account:owner,wallet:wallet.toLowerCase(),method,generation,chain:9,issued,expires:issued+15,
      policy:payoutVerified?'quai-coinbase-v1':'session-wallet-v2'})).toString('base64url');
    return {payload,signature:sign(null,Buffer.from(payload),key).toString('base64url')};
  };
}
