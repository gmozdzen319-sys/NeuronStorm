import {expireQuestions,QUESTION_LIFETIME} from '../lifecycle.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {id} from 'quais';
import {createApp} from '../server.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
import {createQuestion,replyToThread,readThread,voteOnReply} from '../threads.mjs';
import {createPayments,REWARD_ADDRESS,transferData,nsUnits} from '../payments.mjs';
import {NS_TOKEN} from '../neuron-token.mjs';
import {presence,ranking,weekStart,rewardGrowth} from '../community.mjs';
const a={address:'0x0011111111111111111111111111111111111111',role:'member'},b={address:'0x0022222222222222222222222222222222222222',role:'member'},c={address:'0x0033333333333333333333333333333333333333',role:'member'};
function fixture(t){const {db}=createApp({database:':memory:'});t.after(()=>db.close());const now=Date.UTC(2026,9,1,12);for(const [account,nickname] of [[a,'Writer'],[b,'Driver'],[c,'Traveller']]){db.prepare('INSERT INTO accounts VALUES(?,?)').run(account.address,now);saveProfile(db,account.address,{nickname,work:['Driving'],hobbies:['Travel']},now);}const category=db.prepare('SELECT id FROM categories WHERE kind=?').get('work').id;const question=createQuestion(db,a,{categoryIds:[category],body:'Question'},now).id;replyToThread(db,b,question,{body:'First answer'},now);const reply=readThread(db,a,question).replies[0].id;return {db,now,question,reply,category};}
function network(){let height=100n,receipt=null,tx=null,canonical='0x'+'bb'.repeat(32),chain='0x9';const hash='0x'+'aa'.repeat(32);return {hash,setChain:value=>chain=value,fetch:async(url,options)=>{const {method}=JSON.parse(options.body);const result=method==='quai_chainId'?chain:method==='quai_blockNumber'?'0x'+height.toString(16):method==='quai_getTransactionReceipt'?receipt:method==='quai_getTransactionByHash'?tx:method==='quai_getBlockByNumber'?{hash:canonical}:null;return {ok:true,json:async()=>({result})};},paid(intent,overrides={}){height=104n;receipt={transactionHash:hash,status:'0x1',blockNumber:'0x66',blockHash:canonical,logs:[{address:NS_TOKEN.address,topics:[id('Transfer(address,address,uint256)'), '0x'+intent.transaction.from.slice(2).padStart(64,'0'),'0x'+intent.recipient.slice(2).toLowerCase().padStart(64,'0')],data:'0x'+BigInt(intent.units).toString(16).padStart(64,'0')}]};tx={hash,from:intent.transaction.from,to:NS_TOKEN.address,input:intent.transaction.data,value:'0x0',blockHash:canonical};Object.assign(receipt,overrides);return {receipt,tx};},height:value=>height=value,canonical:value=>canonical=value};}
test('one answer slot survives deletion and highest upvotes sort first',t=>{const {db,question,reply,now}=fixture(t);assert.throws(()=>replyToThread(db,b,question,{body:'Second'},now),e=>e.status===409);replyToThread(db,c,question,{body:'Other answer'},now);const other=readThread(db,a,question).replies.find(r=>r.id!==reply).id;voteOnReply(db,a,question,other,{value:1},now);assert.equal(readThread(db,a,question).replies[0].id,other);db.prepare('UPDATE replies SET deleted_at=? WHERE id=?').run(now,reply);assert.throws(()=>replyToThread(db,b,question,{body:'Replacement'},now),e=>e.status===409);assert.equal(readThread(db,b,question).canReply,false);});
test('paid edit verifies exact NS transfer, clears ratings, and applies once',async t=>{const {db,reply,question,now}=fixture(t),net=network(),payments=createPayments(db,net.fetch);voteOnReply(db,a,question,reply,{value:1},now);const intent=await payments.prepare(b,{replyId:reply,action:'edit',body:'Updated answer'},now);assert.equal(intent.recipient,REWARD_ADDRESS);assert.equal(intent.units,'1000000000000000000');assert.equal(intent.transaction.data,transferData(REWARD_ADDRESS,intent.units));await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===409);net.paid(intent);await payments.confirm(b,{id:intent.id,txHash:net.hash},now);await payments.confirm(b,{id:intent.id,txHash:net.hash},now);const answer=readThread(db,a,question).replies[0];assert.equal(answer.body,'Updated answer');assert.equal(answer.version,2);assert.equal(readProfile(db,b.address).points,0);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_intents WHERE completed_at IS NOT NULL').get().n,1);});
test('payment rejects wrong payer, failed receipt, amount, old block, confirmations and fork',async t=>{const {db,reply,question,now}=fixture(t),net=network(),payments=createPayments(db,net.fetch),intent=await payments.prepare(b,{replyId:reply,action:'delete'},now);
 await assert.rejects(payments.prepare(a,{replyId:reply,action:'delete'},now),e=>e.status===403);
 await assert.rejects(payments.confirm(a,{id:intent.id,txHash:net.hash},now),e=>e.status===404);
 net.paid(intent,{status:'0x0'});await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===400);
 net.paid(intent,{blockNumber:'0x64'});await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===400);
 net.paid(intent);net.height(102n);await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===409);
 const bad=net.paid(intent);bad.receipt.logs[0].data='0x'+'0'.repeat(63)+'1';await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===400);
 const sender=net.paid(intent);sender.tx.from=a.address;await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===400);
 net.paid(intent);net.canonical('0x'+'cc'.repeat(32));await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},now),e=>e.status===409);
 assert.equal(readThread(db,a,question).replies.length,1);assert.equal(db.prepare('SELECT count(*) AS n FROM payment_intents WHERE completed_at IS NOT NULL').get().n,0);
 net.paid(intent);await payments.confirm(b,{id:intent.id,txHash:net.hash},now);assert.equal(readThread(db,a,question).replies.length,0);
});
test('tips pay the answer author and cannot reuse a confirmed transaction',async t=>{const {db,reply,now}=fixture(t),net=network(),payments=createPayments(db,net.fetch);await assert.rejects(payments.prepare(b,{replyId:reply,action:'tip',amount:'1'},now),e=>e.status===400);const intent=await payments.prepare(a,{replyId:reply,action:'tip',amount:'2.5'},now);assert.equal(intent.recipient,b.address);net.paid(intent);await payments.confirm(a,{id:intent.id,txHash:net.hash},now);const second=await payments.prepare(a,{replyId:reply,action:'tip',amount:'2.5'},now);await assert.rejects(payments.confirm(a,{id:second.id,txHash:net.hash},now),e=>e.status===409);assert.equal(nsUnits('0.000000000000000001'),'1');assert.throws(()=>nsUnits('0'));assert.throws(()=>nsUnits('1e5'));});
test('weekly ranking resets in UTC, keeps lifetime stars and filters fields',t=>{const {db,reply,question,now,category}=fixture(t);voteOnReply(db,a,question,reply,{value:1},now);const params=new URLSearchParams({category:String(category)});const rows=ranking(db,params,now).rows;assert.equal(rows[0].nickname,'Driver');assert.equal(ranking(db,params,now,true).rows[0].address,b.address);assert.equal(rows[0].stars,1);assert.equal(rows[0].activity,1);assert.ok(!JSON.stringify(rows).includes('0x'));const next=weekStart(now)+604800000;assert.equal(new Date(next).getUTCDay(),1);assert.equal(ranking(db,params,next).rows.length,0);assert.equal(readProfile(db,b.address).points,1);});
test('online presence deduplicates accounts, weekly visits browsers, and expires',t=>{const {db,now}=fixture(t);assert.equal(presence(db,'browser-a',a,true,now).online,1);const same=presence(db,'browser-b',a,true,now);assert.equal(same.online,1);assert.equal(same.weeklyVisitors,2);assert.equal(presence(db,'browser-c',null,true,now).online,2);assert.equal(presence(db,'browser-c',null,false,now+70000).online,0);const next=presence(db,'browser-a',a,true,weekStart(now)+604800000);assert.equal(next.weeklyVisitors,1);});

test('reward growth persists its weekly baseline and handles deposits, withdrawals and zero',t=>{
  const {db,now}=fixture(t);
  assert.equal(rewardGrowth(db,'100',now).changePercent,'0.00');
  assert.equal(rewardGrowth(db,'125',now+1000).changePercent,'25.00');
  const withdrawn=rewardGrowth(db,'50',now+2000);
  assert.equal(withdrawn.changePercent,'-50.00');assert.equal(withdrawn.baselineAt,now);
  const next=weekStart(now)+604800000;
  assert.equal(rewardGrowth(db,'0',next).changePercent,'0.00');
  assert.equal(rewardGrowth(db,'2',next+1000).changePercent,null);
  assert.throws(()=>rewardGrowth(db,'invalid',next+2000));
});

test('answer tip totals include only verified tips, preserve exact decimals and never double count',async t=>{
  const {db,reply,question,now}=fixture(t),net=network(),payments=createPayments(db,net.fetch);
  const total=()=>readThread(db,a,question).replies.find(r=>r.id===reply);
  assert.equal(total().tipTotal,'0');
  const intent=await payments.prepare(a,{replyId:reply,action:'tip',amount:'2.500000000000000001'},now);
  assert.equal(total().tipTotal,'0');net.paid(intent);
  await payments.confirm(a,{id:intent.id,txHash:net.hash},now);
  assert.equal(total().tipTotal,'2.500000000000000001');assert.equal(total().tipCount,1);
  await payments.confirm(a,{id:intent.id,txHash:net.hash},now);
  assert.equal(total().tipCount,1);
  const net2=network(),payments2=createPayments(db,net2.fetch);
  const second=await payments2.prepare(c,{replyId:reply,action:'tip',amount:'1'},now);
  const pair=net2.paid(second),hash='0x'+'cc'.repeat(32);pair.receipt.transactionHash=hash;pair.tx.hash=hash;
  await payments2.confirm(c,{id:second.id,txHash:hash},now);
  assert.equal(total().tipTotal,'3.500000000000000001');assert.equal(total().tipCount,2);
});

test('a paid edit confirmed after expiry cannot change the archived winner',async t=>{
  const {db,reply,question,now}=fixture(t),net=network();let time=now;const payments=createPayments(db,net.fetch,()=>time);
  const intent=await payments.prepare(b,{replyId:reply,action:'edit',body:'Late edit'},time);net.paid(intent);time=now+QUESTION_LIFETIME;
  expireQuestions(db,time);
  await assert.rejects(payments.confirm(b,{id:intent.id,txHash:net.hash},time),e=>e.status===409&&/Do not pay again/.test(e.message));
  assert.equal(db.prepare('SELECT answer_body FROM accepted_answers WHERE question_id=?').get(question).answer_body,'First answer');
  assert.equal(db.prepare('SELECT body FROM replies WHERE id=?').get(reply).body,'First answer');
});
