import test from 'node:test';
import assert from 'node:assert/strict';
import {miningRoutes} from '../mining-routes.mjs';

test('one chain verification per opening and authenticated binding',async()=>{
 const wallet='0x000450fd930f4c05d6e96d4e51935f4cd403286c';
 let account={method:'passkey',id:'account'},session='a'.repeat(43),phase='confirmed',reads=0,time=0;
 const row={account_id:'account',generation:3,revoked_at:null,credential_id:'key',plan:{address:wallet}};
 const route=miningRoutes({origin:'https://neuronstorm.onrender.com',now:()=>time,
  cookies:()=>({ns_passkey_session:session}),hash:s=>'hashed-'+s,account:async()=>account,
  db:{prepare:()=>({all:async()=>[{phase}]})},
  feeWallet:{registry:{load:async()=>row},chain:{snapshot:async()=>{reads++;return {deployed:true}}}}});
 const path='/api/desktop/mining-identity';
 async function renew(){
  time+=2000;
  const challenge=time.toString(16).padStart(64,'0');
  const req={method:'GET',url:path+'?challenge='+challenge};
  const ticket=await route(req,(status,t)=>t,path);
  assert.equal(JSON.parse(Buffer.from(ticket.payload,'base64url')).challenge,challenge);
 }
 for(let i=0;i<200;i++)await renew();
 assert.equal(reads,1);
 route.resetDesktop({});
 await renew();assert.equal(reads,2);
 session='b'.repeat(43);
 await renew();assert.equal(reads,3);
 row.credential_id='other-key';
 await renew();assert.equal(reads,4);
 phase='stopped';
 await assert.rejects(renew,/CONFIRMED_ACTIVATION_REQUIRED/);
 phase='confirmed';
 await renew();assert.equal(reads,5);
 row.revoked_at=1;
 await assert.rejects(renew,/ACTIVE_V3_REQUIRED/);
 account=null;
 await assert.rejects(renew,/LOGIN_REQUIRED/);
});
