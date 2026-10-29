import http from 'node:http';
import {test} from 'node:test';import assert from 'node:assert/strict';
import {createApp,ADMIN} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {roundStart,WEEK,rounds,reputationRanking} from '../reputation.mjs';
import {rewardUnits,weeklyRewardRows} from '../weekly-rewards.mjs';
import {createWeeklyPayments} from '../weekly-payments.mjs';
import {REWARD_ADDRESS,transferData} from '../payments.mjs';import {NS_TOKEN} from '../neuron-token.mjs';import {id} from 'quais';
const start=roundStart(Date.now()),end=start+WEEK,now=end+86400000+10000;
const admin={address:REWARD_ADDRESS.toLowerCase(),role:'admin'},H='0x'+'a'.repeat(64),B='0x'+'b'.repeat(64);
async function fixture(t){const app=await createApp({now:()=>start+1000,paymentFetch:async()=>{throw Error('No real RPC permitted');}});t.after(()=>app.close());const db=app.db;await db.prepare('UPDATE weekly_reward_policy SET first_round=$1').run(start);await rounds(db,start+1000);
 const members=Array.from({length:12},(_,i)=>'0x00'+(i+10).toString(16).padStart(38,'0'));
 for(const [i,address] of [...members,admin.address,ADMIN].entries()){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,start);await saveProfile(db,address,{nickname:'User '+i,work:['Builder'],hobbies:[]},start);}
 for(const [i,address] of members.entries())await db.prepare("INSERT INTO reputation_events(source,target_id,question_id,voter,recipient,previous_value,value,units,occurred_at,round_id) VALUES('qa',$1,'q',$2,$3,0,1,$4,$5,$6)").run(i+1,admin.address,address,(i>=9?1:12-i)*100,start+1,start);
 return {...app,members};}
function network(recipient,units){let receipt=null,tx=null,nonce='0x25',canonical=B;const calls=[];return {calls,inspect(){return structuredClone({tx,receipt});},set(v){({receipt=receipt,tx=tx,nonce=nonce,canonical=canonical}=v);},success(){tx={hash:H,from:REWARD_ADDRESS,to:NS_TOKEN.address,input:transferData(recipient,units),nonce:'0x25',value:'0x0',blockHash:B};receipt={transactionHash:H,status:'0x1',blockNumber:'0x65',blockHash:B,logs:[{address:NS_TOKEN.address,topics:[id('Transfer(address,address,uint256)'),'0x'+REWARD_ADDRESS.slice(2).toLowerCase().padStart(64,'0'),'0x'+recipient.slice(2).padStart(64,'0')],data:'0x'+BigInt(units).toString(16).padStart(64,'0')}]};},fail(){this.success();receipt.status='0x0';receipt.logs=[];},fetch:async(url,opts)=>{const q=JSON.parse(opts.body);calls.push(q.method);const values={quai_chainId:'0x9',quai_getTransactionCount:nonce,quai_blockNumber:receipt?'0x68':'0x64',quai_getCode:'0x',quai_call:'0x'+(1000000n*10n**18n).toString(16),quai_getTransactionReceipt:receipt,quai_getTransactionByHash:tx,quai_getBlockByNumber:{hash:canonical,timestamp:'0x'+Math.floor(now/1000).toString(16)}};assert.ok(Object.hasOwn(values,q.method),'unexpected RPC '+q.method);return {ok:true,json:async()=>({result:values[q.method]})};}};}
test('fixed schedule; full shared-place rewards can exceed 1000 NS',()=>{assert.equal(Array.from({length:10},(_,i)=>BigInt(rewardUnits(i+1))).reduce((a,b)=>a+b),1000n*10n**18n);assert.equal(rewardUnits(11),null);});
test('live projection, ties at cutoff, frozen terms and restart-safe snapshot',async t=>{const {db,members}=await fixture(t);let live=await reputationRanking(db,new URLSearchParams(),start+1000);assert.equal(live.rows[0].rewardUnits,rewardUnits(1));assert.equal(live.rows.filter(r=>r.position===10).length,3);
 await rounds(db,end+1);const frozen=await weeklyRewardRows(db,start);assert.equal(frozen.length,12);assert.equal(frozen.reduce((n,r)=>n+BigInt(r.units),0n),1040n*10n**18n);
 await db.prepare('UPDATE profiles SET nickname=$1 WHERE address=$2').run('Renamed',members[0]);await rounds(db,end+4000);assert.deepEqual(await weeklyRewardRows(db,start),frozen);
 await assert.rejects(db.prepare("UPDATE weekly_rewards SET units='1' WHERE id=$1").run(frozen[0].id),/immutable/);
 const closed=await reputationRanking(db,new URLSearchParams('round='+start),end+4000);assert.equal(closed.rows[0].nickname,'User 0');assert.equal(closed.rows[0].rewardFinal,true);
});
test('manual payout: authorization, frozen amount, pending lock, exact canonical receipt, idempotent settlement',async t=>{const {db}=await fixture(t);await rounds(db,end+1);const rows=await weeklyRewardRows(db,start),r=rows[0],net=network(r.recipient,r.units),pay=createWeeklyPayments(db,net.fetch);
 await assert.rejects(pay.prepare({...admin,role:'member'},{rewardId:r.id},now),e=>e.status===403);
 await assert.rejects(pay.prepare({address:ADMIN,role:'admin'},{rewardId:r.id},now),e=>e.status===403);
 await assert.rejects(pay.prepare(admin,{rewardId:r.id},end+1),e=>e.status===409);
 const attempt=await pay.prepare(admin,{rewardId:r.id,amount:'1',recipient:ADMIN},now);assert.equal(attempt.transaction.data,transferData(r.recipient,r.units));assert.equal(attempt.transaction.nonce,'0x25');
 await assert.rejects(pay.prepare(admin,{rewardId:rows[1].id},now),e=>e.status===409);
 assert.equal((await pay.confirm(admin,{attemptId:attempt.id,txHash:H},now)).status,'pending');
 net.success();net.set({canonical:'0x'+'c'.repeat(64)});assert.equal((await pay.confirm(admin,{attemptId:attempt.id,txHash:H},now)).status,'pending');
 net.set({canonical:B});assert.equal((await pay.confirm(admin,{attemptId:attempt.id,txHash:H},now)).status,'paid');assert.equal((await pay.confirm(admin,{attemptId:attempt.id,txHash:H},now)).status,'paid');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM used_transactions WHERE tx_hash=$1').get(H)).n,1);assert.equal((await db.prepare("SELECT count(*) AS n FROM weekly_reward_attempts WHERE status IN('awaiting_wallet','submitted')").get()).n,0);
 await assert.rejects(pay.prepare(admin,{rewardId:r.id},now),e=>e.status===409);await assert.rejects(pay.prepare(admin,{rewardId:rows[1].id},now),e=>e.status===409);assert.ok(!net.calls.some(m=>/send|sign/i.test(m)));
});
test('failed receipt permits retry only while its failure remains canonical and nonce is consumed',async t=>{const {db}=await fixture(t);await rounds(db,end+1);const [r]=await weeklyRewardRows(db,start),net=network(r.recipient,r.units),pay=createWeeklyPayments(db,net.fetch),attempt=await pay.prepare(admin,{rewardId:r.id},now);net.fail();assert.equal((await pay.confirm(admin,{attemptId:attempt.id,txHash:H},now)).status,'failed');await assert.rejects(pay.prepare(admin,{rewardId:r.id},now),e=>e.status===409);net.set({nonce:'0x26',canonical:'0x'+'d'.repeat(64)});await assert.rejects(pay.prepare(admin,{rewardId:r.id},now),e=>e.status===409);net.set({canonical:B});const next=await pay.prepare(admin,{rewardId:r.id},now+1);assert.notEqual(next.id,attempt.id);assert.equal(next.transaction.nonce,'0x26');});

test('wrong recipient, amount, token, nonce and missing transfer never mark paid',async t=>{
 const {db}=await fixture(t);await rounds(db,end+1);const [r]=await weeklyRewardRows(db,start),net=network(r.recipient,r.units),pay=createWeeklyPayments(db,net.fetch),a=await pay.prepare(admin,{rewardId:r.id},now);net.success();const valid=net.inspect();
 for(const change of [{to:ADMIN},{from:ADMIN},{nonce:'0x26'},{input:transferData(ADMIN,r.units)},{input:transferData(r.recipient,'1')},{value:'0x1'}]){net.set({tx:{...valid.tx,...change}});await assert.rejects(pay.confirm(admin,{attemptId:a.id,txHash:H},now),e=>e.status===400);}
 net.set({tx:valid.tx,receipt:{...valid.receipt,logs:[]}});await assert.rejects(pay.confirm(admin,{attemptId:a.id,txHash:H},now),e=>e.status===409);assert.equal((await db.prepare('SELECT status FROM weekly_rewards WHERE id=$1').get(r.id)).status,'pending');
 net.set(valid);assert.equal((await pay.confirm(admin,{attemptId:a.id,txHash:H},now)).status,'paid');
});
test('simultaneous SEND claims serialize; restart retains pending lock without a hash',async t=>{
 const {db}=await fixture(t);await rounds(db,end+1);const [r]=await weeklyRewardRows(db,start),net=network(r.recipient,r.units),pay=createWeeklyPayments(db,net.fetch);
 const results=await Promise.allSettled([pay.prepare(admin,{rewardId:r.id},now),pay.prepare(admin,{rewardId:r.id},now)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const restarted=createWeeklyPayments(db,net.fetch);await assert.rejects(restarted.prepare(admin,{rewardId:r.id},now+10000),e=>e.status===409);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM weekly_reward_attempts').get()).n,1);
});
import {createHash} from 'node:crypto';
test('server recognizes both authenticated administrators and rejects other sessions',async t=>{
 const app=await fixture(t),{db,server,members}=app;await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const request=cookie=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:server.address().port,path:'/api/admin/reputation',headers:{Host:'localhost:3000',Cookie:cookie}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject);});
 for(const [i,address] of [ADMIN,admin.address,members[0]].entries()){
  const token=(i+1).toString(16).repeat(64);await db.prepare('INSERT INTO sessions(token_hash,address,expires) VALUES($1,$2,$3)').run(createHash('sha256').update(token).digest('hex'),address,now+WEEK);
  const response=await request('ns_session='+token);assert.equal(response.status,i<2?200:403,response.body);
 }
 assert.equal((await request('')).status,401);
});
