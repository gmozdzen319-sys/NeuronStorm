import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {openDatabase} from '../db/database.mjs';
test('v2 restart preserves identity/credential and immutable v1 evidence while isolating new assignment',{skip:!process.env.NEURON_TEST_DATABASE_URL},async()=>{
 const app=await createApp();let db;
 try{
  const a='generation-test',credential='retained-passkey',old='0x0011111111111111111111111111111111111111',fresh='0x0022222222222222222222222222222222222222';
  await app.db.prepare('INSERT INTO passkey_accounts VALUES($1,$2,1,NULL,$3,$4)').run(a,'retained-handle','neuronstorm.onrender.com','https://neuronstorm.onrender.com');
  await app.db.prepare('INSERT INTO passkey_credentials VALUES($1,$2,$3,7,$4,FALSE,1,1,NULL)').run(credential,a,'public-key-fixture','Existing device');
  await app.db.prepare('INSERT INTO passkey_clone_wallets VALUES($1,$2,$3,$4,$5,1)').run(a,credential,old,'key-fixture','v1-plan');
  await app.db.prepare("INSERT INTO passkey_clone_approvals(account_id,quote,commitment,expires_at,phase,approved) VALUES($1,'v1-quote','v1-commitment',1,'confirmed',FALSE)").run(a);
  const name=(await app.db.prepare('SELECT current_database() AS name').get()).name;
  if(!process.env.NEURON_TEST_DATABASE_URL)throw Error('This cutover regression requires native local PostgreSQL');
  const url=new URL(process.env.NEURON_TEST_DATABASE_URL);url.pathname='/'+name;
  db=await openDatabase(url.href,{walletGeneration:2});
  assert.equal(await db.prepare('SELECT * FROM passkey_clone_wallets WHERE account_id=$1').get(a),undefined);
  assert.equal(await db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1').get(a),undefined);
  const saved=await db.prepare('SELECT * FROM passkey_credentials WHERE id=$1').get(credential);assert.equal(saved.counter,7);assert.equal(saved.account_id,a);
  await db.prepare('INSERT INTO passkey_clone_wallets VALUES($1,$2,$3,$4,$5,2)').run(a,credential,fresh,'key-fixture','v2-plan');
  await assert.rejects(db.prepare('UPDATE passkey_clone_wallets SET address=$1 WHERE account_id=$2').run(old,a),/immutable/);
  assert.equal((await db.prepare('SELECT * FROM passkey_v1_assignments WHERE account_id=$1').get(a)).address,old);
  assert.equal((await app.db.prepare('SELECT * FROM passkey_clone_approvals WHERE account_id=$1').get(a)).quote,'v1-quote');
  await db.close();db=await openDatabase(url.href,{walletGeneration:2});
  assert.equal((await db.prepare('SELECT * FROM passkey_clone_wallets WHERE account_id=$1').get(a)).address,fresh);
 }finally{await db?.close();await app.db.close();}
});
