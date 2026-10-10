// Read-only operator audit; no signer, approval, or broadcast capability.
import assert from 'node:assert/strict';
import {openDatabase} from '../db/database.mjs';
import {assertV1Settled} from '../db/wallet-generation.mjs';
assert.equal(process.env.NS_WALLET_AUTO_ACTIVATE,'false');
assert.equal(process.env.NS_WALLET_PROVISION_ENABLED,'false');
assert.equal(process.env.NS_WALLET_SEND_ENABLED,'false');
assert.equal(process.env.NS_WALLET_GENERATION??'1','1');
const db=await openDatabase(process.env.DATABASE_URL);
try {
 await assertV1Settled(db.query);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM passkey_relayer_lanes').get()).n,0,'Unresolved relayer lane');
 const accounts=await db.prepare(`SELECT w.account_id,w.address,w.credential_id,c.revoked_at,
 a.phase AS approval_phase,a.tx_hash FROM passkey_clone_wallets w
 JOIN passkey_credentials c ON c.id=w.credential_id AND c.account_id=w.account_id
 LEFT JOIN passkey_clone_approvals a ON a.account_id=w.account_id ORDER BY w.created_at`).all();
 // Credential identifiers are deliberately omitted from output.
 console.log(JSON.stringify({v2CutoverAudit:{at:new Date().toISOString(),automatic:false,send:false,provision:false,
  pendingV1:false,relayerLaneEmpty:true,accounts:accounts.map(({credential_id,...a})=>a)},broadcasts:0}));
}finally{await db.close();}
