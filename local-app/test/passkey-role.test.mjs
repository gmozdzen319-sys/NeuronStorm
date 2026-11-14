import test from 'node:test';
import assert from 'node:assert/strict';
import {passkeyRole} from '../passkey-role.mjs';
test('admin is restricted to the authenticated owner of the explicitly approved wallet',async()=>{
 const wallets=new Map([['approved',{address:'0x000450fd930f4c05d6e96d4e51935f4cd403286c'}],['other',{address:'0x0011111111111111111111111111111111111111'}]]);
 const db={prepare(sql){assert.equal(sql,'SELECT address FROM passkey_fee_wallets WHERE account_id=$1');return {get:async id=>wallets.get(id)}}};
 assert.equal(await passkeyRole(db,'approved'),'admin');
 assert.equal(await passkeyRole(db,'other'),'member');
 assert.equal(await passkeyRole(db,'missing'),'member');
});
