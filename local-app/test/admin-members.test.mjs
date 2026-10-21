import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {adminMembers} from '../admin.mjs';
import {saveProfile} from '../profiles.mjs';
test('Admin directory sorts by registration, shows real v3 assignment and never guesses legacy provider',async t=>{
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const db=app.db;
 const admin='0x0000000000000000000000000000000000000011',social='0x0000000000000000000000000000000000000022',wallet='0x0000000000000000000000000000000000000033';
 for(const [address,at] of [[admin,1],[social,2]])await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,at);
 await saveProfile(db,admin,{nickname:'Admin',work:['Testing'],hobbies:[]},1);
 await db.prepare("INSERT INTO passkey_accounts VALUES('pk','handle',2,NULL,'neuronstorm.onrender.com','https://neuronstorm.onrender.com')").run();
 await db.prepare("INSERT INTO passkey_credentials VALUES('key','pk','public',0,'test',false,2,NULL,NULL)").run();
 await db.prepare("INSERT INTO passkey_community_accounts VALUES('pk',$1)").run(social);
 await db.prepare("INSERT INTO passkey_fee_wallets VALUES('pk','key',$1,'keyid','{}',2)").run(wallet);
 const owner={address:admin,role:'admin'};
 await assert.rejects(adminMembers(db,null,new URLSearchParams()),e=>e.status===401);
 await assert.rejects(adminMembers(db,{address:admin,role:'member'},new URLSearchParams()),e=>e.status===403);
 let r=await adminMembers(db,owner,new URLSearchParams());assert.deepEqual(r.members.map(x=>x.createdAt),[1,2]);assert.equal(r.members[0].method,'external_unknown');
 assert.equal(r.members[1].address,wallet);assert.equal(r.members[1].method,'passkey');assert.equal(r.members[1].walletStatus,'reserved');assert.equal(r.members[1].accountId,'pk');assert(!JSON.stringify(r.members[1]).includes(social));
 r=await adminMembers(db,owner,new URLSearchParams({search:wallet}));assert.equal(r.total,1);assert.equal(r.members[0].address,wallet);
 await assert.rejects(adminMembers(db,owner,new URLSearchParams({page:'0'})),e=>e.status===400);
 r=await adminMembers(db,owner,new URLSearchParams({order:'newest'}));assert.deepEqual(r.members.map(x=>x.createdAt),[2,1]);
 r=await adminMembers(db,owner,new URLSearchParams({method:'passkey'}));assert.equal(r.total,1);assert.equal(r.members[0].address,wallet);
 r=await adminMembers(db,owner,new URLSearchParams({method:'external_unknown'}));assert.equal(r.total,1);assert.equal(r.members[0].address,admin);
 for(const [method,address,at] of [['pelagus','0x0000000000000000000000000000000000000044',3],['blippay','0x0000000000000000000000000000000000000055',4]]){
  await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,at);
  await db.prepare('INSERT INTO account_registration_methods VALUES($1,$2,$3)').run(address,method,at);
  r=await adminMembers(db,owner,new URLSearchParams({method,order:'newest',search:address,page:'999'}));assert.equal(r.total,1);assert.equal(r.page,1);assert.equal(r.members[0].address,address);
 }
 r=await adminMembers(db,owner,new URLSearchParams({method:'passkey',search:'no-match'}));assert.equal(r.total,0);assert.deepEqual(r.members,[]);
 for(const params of [{method:'invalid'},{order:'DESC; DROP TABLE accounts'}])await assert.rejects(adminMembers(db,owner,new URLSearchParams(params)),e=>e.status===400);
});
