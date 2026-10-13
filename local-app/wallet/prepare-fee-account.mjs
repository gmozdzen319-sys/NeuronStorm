// Explicit operator assignment only. No signer, grants or broadcasts. Existing
// accounts, credentials, v2 addresses and funds are retained unchanged.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {openDatabase} from '../db/database.mjs';
import {loadCloneWallet} from '../wallet-infrastructure.mjs';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain} from './chain.mjs';
const [accountId,oldAddress,newAddress]=process.argv.slice(2);
assert(/^[0-9a-f-]{36}$/.test(accountId??''));
for(const address of [oldAddress,newAddress])assert(/^0x00[0-7][0-9a-f]{37}$/i.test(address??''));
for(const name of ['NS_WALLET_AUTO_ACTIVATE','NS_WALLET_SEND_ENABLED','NS_WALLET_PROVISION_ENABLED'])assert.equal(process.env[name],'false');
assert.notEqual(process.env.NS_FEE_SEND_ENABLED,'true');
const registry=createFeeAssignments(JSON.parse(await readFile(new URL('./fee-v3-deployment.json',import.meta.url),'utf8')));
const db=await openDatabase(process.env.DATABASE_URL);
try{
 await db.transaction(async()=>{
 const old=await loadCloneWallet(db,accountId);assert(old&&old.revoked_at===null&&old.address===oldAddress.toLowerCase());
 assert((await createWalletChain().snapshot(old.plan)).deployed);
 const row=await registry.assign(db,accountId);assert.equal(row.credential_id,old.credential_id);assert.equal(row.address,newAddress.toLowerCase());
 const view=await createWalletChain({infrastructure:registry.infrastructure}).snapshot(row.plan);
 assert(view.deployed,'Only a chain-confirmed fee wallet may be selected');
 assert.equal((await loadCloneWallet(db,accountId)).address,old.address);
 console.log(JSON.stringify({feeAccountPrepared:true,address:row.plan.address,previousAddress:old.plan.address,passkeyPreserved:true,nonce:view.nonce,broadcasts:0}));
 });
}finally{await db.close();}
