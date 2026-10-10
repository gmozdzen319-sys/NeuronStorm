import test from 'node:test';import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {RETURN as R,scopeControlledReturn} from '../wallet/controlled-return.mjs';
test('Controlled return sentinel works with PostgreSQL constraints and cannot sponsor or retry',async t=>{
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db;
 await db.prepare('INSERT INTO passkey_relayer_grants(id,relayer,budget_wei,expires_at,enabled) VALUES($1,$2,$3,$4,TRUE)').run(R.grant,R.recipient,R.maximumWei,Date.now()+60000);
 let prepared=0;const e=scopeControlledReturn(db,{prepare:async()=>{prepared++;throw Error('Test preflight STOP');},execute:async()=>assert.fail('Must not execute')});
 const row={account_id:R.account,plan:{address:R.wallet}},op={wallet:R.wallet,recipient:R.recipient,amount:R.amount,chainId:9,action:5,walletNonce:'0',epoch:'0'};
 await assert.rejects(e.prepare(row,op),/Test preflight STOP/);assert.equal(prepared,1);
 const lock=await db.prepare('SELECT * FROM passkey_relayer_grants WHERE id=$1').get(R.grant+':used');assert(lock);assert.equal(String(lock.budget_wei),'1');assert.equal(lock.enabled,false);assert.equal(Number(lock.expires_at),0);assert.equal(String(lock.reserved_wei),'0');
 assert.equal((await db.prepare('SELECT enabled FROM passkey_relayer_grants WHERE id=$1').get(R.grant)).enabled,false);
 await assert.rejects(e.prepare(row,op),/duplicate key/);assert.equal(prepared,1);
});
