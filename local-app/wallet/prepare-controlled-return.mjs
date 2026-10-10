// Free operator setup: no signer, secret loading or broadcast capability.
import assert from 'node:assert/strict';
import {formatUnits} from 'quais';
import {openDatabase} from '../db/database.mjs';
import {loadCloneWallet,WALLET_GENERATION} from '../wallet-infrastructure.mjs';
import {createWalletChain} from './chain.mjs';
import {RETURN} from './controlled-return.mjs';
assert.equal(process.argv[2],'--prepare-approved-once');assert.equal(WALLET_GENERATION,2);
for(const flag of ['NS_WALLET_AUTO_ACTIVATE','NS_WALLET_SEND_ENABLED','NS_WALLET_PROVISION_ENABLED'])assert.notEqual(process.env[flag],'true');
const db=await openDatabase(process.env.DATABASE_URL);
try{
 assert.equal((await db.prepare('SELECT * FROM passkey_relayer_lanes').all()).length,0);
 assert.equal((await db.prepare('SELECT id FROM passkey_native_operations WHERE account_id=$1').all(RETURN.account)).length,0);
 const row=await loadCloneWallet(db,RETURN.account);assert(row&&row.address===RETURN.wallet.toLowerCase()&&row.revoked_at===null);
 const chain=createWalletChain(),view=await chain.snapshot(row.plan);assert(view.deployed&&view.nonce==='0'&&view.epoch==='0'&&view.balanceWei===RETURN.amount);
 const rpc=chain.rpc;assert.equal(BigInt(await rpc('quai_getTransactionCount',[RETURN.recipient,'latest'])),11n);assert.equal(BigInt(await rpc('quai_getTransactionCount',[RETURN.recipient,'pending'])),11n);
 const price=BigInt(await rpc('quai_gasPrice',[])),balance=BigInt(await rpc('quai_getBalance',[RETURN.recipient,'latest'])),reserve=price*1000000n;
 assert(price>0n&&price<=75000000000000n&&reserve<=BigInt(RETURN.maximumWei));assert(balance>=reserve+10000000000000000000n);
 // Unique ID is never updated/upserted. Re-running cannot refresh this authorization.
 const expires=Date.now()+1800000;
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run(RETURN.grant,RETURN.recipient,RETURN.maximumWei,expires);
 console.log(JSON.stringify({scope:'One 0.007 QUAI return only',wallet:RETURN.wallet,recipient:RETURN.recipient,grant:RETURN.grant,expiresAt:new Date(expires).toISOString(),freshPriceGwei:formatUnits(price,9),conservativeReserveQuai:formatUnits(reserve,18),remainingMaximumQuai:formatUnits(RETURN.maximumWei,18),balanceQuai:formatUnits(balance,18),requiresNewManualPasskey:true,broadcasts:0}));
}finally{await db.close();}
