import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {installProductionFeeGrant,PRODUCTION_FEE_GRANT} from '../wallet/production-fee-grant.mjs';
const relayer='0x001893151cdcc11372f6dd067e3424f47ad8534a';
test('Production grant preserves expiry, spending and old history on repeat setup',async t=>{
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db,now=Date.now();
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,reserved_wei,expires_at,enabled) VALUES($1,$2,$3,$4,$5,TRUE)').run('old-test',relayer,'100','25',now-1);
 const first=await installProductionFeeGrant(db,relayer,now);assert.equal(BigInt(first.budget_wei),2200n*10n**18n);assert.equal(Number(first.expires_at),now+31*86400000);
 await db.prepare('UPDATE passkey_relayer_grants SET reserved_wei=7 WHERE id=$1').run(PRODUCTION_FEE_GRANT);
 const second=await installProductionFeeGrant(db,relayer,now+1000);assert.equal(Number(second.expires_at),Number(first.expires_at));assert.equal(BigInt(second.reserved_wei),7n);
 assert.equal(BigInt((await db.prepare('SELECT reserved_wei FROM passkey_relayer_grants WHERE id=$1').get('old-test')).reserved_wei),25n);
 await assert.rejects(installProductionFeeGrant(db,relayer,Number(first.expires_at)),/expired/);
});
test('Production grant rejects unresolved relayer lane and another active grant',async t=>{
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db,now=Date.now();
 await db.prepare("INSERT INTO passkey_relayer_lanes VALUES($1,$2,'send')").run(relayer,'ambiguous');await assert.rejects(installProductionFeeGrant(db,relayer,now),/lane/);
 await db.prepare('DELETE FROM passkey_relayer_lanes WHERE relayer=$1').run(relayer);
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run('active-test',relayer,'100',now+1000);await assert.rejects(installProductionFeeGrant(db,relayer,now),/Another live grant/);
 assert.equal(await db.prepare('SELECT id FROM passkey_relayer_grants WHERE id=$1').get(PRODUCTION_FEE_GRANT),undefined);
});
