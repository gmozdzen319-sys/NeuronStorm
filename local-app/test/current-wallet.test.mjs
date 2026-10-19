import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {currentAccountWallet,currentWalletForIdentity} from '../current-wallet.mjs';
import {withFeeWallet} from '../wallet/fee-wallet.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
import {createQuestion,replyToThread,readThread} from '../threads.mjs';
import {createPayments} from '../payments.mjs';
import {debate} from '../debate.mjs';
import {acceptAnswer,acceptedAnswers} from '../lifecycle.mjs';
import {listNotifications,readNotifications} from '../notifications.mjs';
const social='0x0000000000000000000000000000000000000011',active='0x0000000000000000000000000000000000000022',payer='0x0000000000000000000000000000000000000033';
test('Forward-only current wallet identity across community and payments',async t=>{
 const app=await createApp({database:':memory:'}),db=app.db;t.after(()=>app.close());const now=Date.now();
 await db.prepare("INSERT INTO passkey_accounts VALUES('new','handle',$1,NULL,'neuronstorm.onrender.com','https://neuronstorm.onrender.com')").run(now);
 await db.prepare("INSERT INTO passkey_current_wallet_accounts VALUES('new',$1)").run(now);
 await db.prepare("INSERT INTO passkey_credentials VALUES('key','new','public',0,'test',false,$1,NULL,NULL)").run(now);
 for(const address of [social,payer])await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,now);
 await db.prepare("INSERT INTO passkey_community_accounts VALUES('new',$1)").run(social);
 await db.prepare("INSERT INTO passkey_fee_wallets VALUES('new','key',$1,'keyid','{}',$2)").run(active,now);
 await db.prepare("INSERT INTO passkey_clone_wallets VALUES('new','key',$1,'legacy-key','{}',$2)").run(social,now);
 const row={account_id:'new',generation:3,revoked_at:null,plan:{address:active}},view={deployed:true,quaiBalance:'60.0'};
 db.verifyCurrentWallet=async id=>{assert.equal(id,'new');return {row,view};};
 const account={id:'new',method:'passkey',address:social,role:'member'},other={address:payer,role:'admin'};
 for(const [address,nickname] of [[social,'NewAuthor'],[payer,'Other']])await saveProfile(db,address,{nickname,work:['Testing'],hobbies:[]},now);
 const categoryId=(await db.prepare('SELECT id FROM categories').get()).id;
 const question=(await createQuestion(db,other,{body:'Question',categoryId},now)).id;
 await replyToThread(db,account,question,{body:'Answer'},now+1);
 const answer=(await db.prepare('SELECT * FROM replies WHERE question_id=$1').get(question));
 let rpcCalls=0;
 const payments=createPayments(db,async(url,opts)=>{rpcCalls++;return {ok:true,json:async()=>({result:JSON.parse(opts.body).method==='quai_chainId'?'0x9':'0x100'})};});
 const tip=extra=>payments.prepare(other,{replyId:answer.id,action:'tip',amount:'1',...extra},now+2);
 await t.test('reserved wallet is not current and Tip stops before RPC or intent',async()=>{
  assert.equal(await currentWalletForIdentity(db,social),null);
  await assert.rejects(tip(),e=>e.code==='CURRENT_WALLET_UNAVAILABLE');assert.equal(rpcCalls,0);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM payment_intents').get()).n,0);
 });
 await db.prepare("INSERT INTO passkey_fee_approvals(account_id,quote,commitment,approved,expires_at,phase,receipt) VALUES('new','{}','test',true,$1,'confirmed',$2)").run(now+60000,JSON.stringify({status:'0x1'}));
 const legacy={state:async()=>({address:social,receiveAvailable:true,tokens:[]}),receive:async()=>({address:social})};
 const service=withFeeWallet(db,legacy,{registry:{load:async()=>row},chain:{snapshot:async()=>view},send:{available:async()=>true}},{readBalance:async()=> '0'});
 await t.test('activated v3 is the sole canonical Receive and profile wallet',async()=>{
  assert.equal(await currentAccountWallet(db,'new'),active);
  assert.equal((await service.receive(account)).address,active);
  assert.equal((await readProfile(db,social)).currentWalletAddress,active);
 });
 await t.test('answer display and Tip match Receive, never social or historical v2',async()=>{
  assert.equal((await readThread(db,other,question)).replies[0].walletAddress,active);
  const intent=await tip();assert.equal(intent.recipient,active);assert(intent.transaction.data.includes(active.slice(2)));
 });
 await t.test('client supplied recipient, wallet and account cannot redirect Tip',async()=>{
  const intent=await tip({recipient:payer,wallet:social,accountId:'old'});assert.equal(intent.recipient,active);
 });
 await t.test('different sessions/devices and logged-in payer do not determine recipient',async()=>{
  for(const device of ['phone','desktop']){
   const intent=await payments.prepare({...other,device,session:device},{replyId:answer.id,action:'tip',amount:'1'},now+3);
   assert.equal(intent.recipient,active);
  }
 });
 await t.test('question/debate author identity is preserved, not used as a payment address',async()=>{
  const q=await createQuestion(db,account,{body:'New question',categoryId},now);
  await debate(db,account,question,'device',new URLSearchParams(),{body:'Discussion',clientId:crypto.randomUUID()},now+4);
  assert.equal((await db.prepare('SELECT author FROM questions WHERE id=$1').get(q.id)).author,social);
  assert.equal((await db.prepare('SELECT author FROM debate_messages WHERE question_id=$1').get(question)).author,social);
 });
 await t.test('unverified runtime, revoked key and inconsistent assignment fail closed',async()=>{
  for(const alter of [()=>view.deployed=false,()=>row.revoked_at=now,()=>row.plan.address=payer,()=>row.account_id='other']){
   alter();await assert.rejects(tip());assert.equal(await currentWalletForIdentity(db,social),null);
   Object.assign(row,{account_id:'new',revoked_at:null,plan:{address:active}});view.deployed=true;
  }
 });
 await t.test('ambiguous wallet query cannot select an arbitrary wallet',async()=>{
  const fake={prepare:sql=>({get:async()=>({account_id:'new'}),all:async()=>sql.includes('passkey_fee_wallets')?[{},{}]:[{account_id:'new'}]})};
  await assert.rejects(currentAccountWallet(fake,'new'));await assert.rejects(currentWalletForIdentity(fake,social,{required:true}));
 });
 await t.test('reorg errors never expose fallback legacy Receive',async()=>{
  const old=db.verifyCurrentWallet;db.verifyCurrentWallet=async()=>{throw Error('canonicality mismatch');};
  await assert.rejects(tip());assert.equal(await currentWalletForIdentity(db,social),null);db.verifyCurrentWallet=old;
 });
 await t.test('missing v3 configuration or assignment cannot expose legacy Receive/Send',async()=>{
  const off=withFeeWallet(db,legacy,null,{});
  assert.equal((await off.state(account)).address,null);await assert.rejects(off.receive(account));await assert.rejects(off.send.prepare(account,{}));
  const missing=withFeeWallet(db,legacy,{registry:{load:async()=>null}},{readBalance:async()=> '0'});
  assert.equal((await missing.state(account)).address,null);await assert.rejects(missing.receive(account));
 });
 await t.test('reward destination uses current wallet while accepted author remains historical identity',async()=>{
  await acceptAnswer(db,other,question,{replyId:answer.id,version:answer.version},now+10);
  assert.equal((await acceptedAnswers(db,new URLSearchParams())).answers[0].walletAddress,active);
  assert.equal((await db.prepare('SELECT answer_author FROM accepted_answers WHERE question_id=$1').get(question)).answer_author,social);
 });
 await t.test('reward receipt preserves real destination and notification belongs only to immutable author',async()=>{
  await db.prepare('INSERT INTO reward_receipts(question_id,recipient,units,tx_hash,created_at) VALUES($1,$2,$3,$4,$5)').run(question,active,'1000000000000000000','0x'+'a'.repeat(64),now+11);
  const result=await listNotifications(db,account,new URLSearchParams()),notification=result.notifications.find(n=>n.kind==='reward');
  assert(notification);assert.equal(notification.amount,'1');
  assert(!(await listNotifications(db,other,new URLSearchParams())).notifications.some(n=>n.kind==='reward'));
  await assert.rejects(readNotifications(db,other,{id:notification.id},false,now+12));
  await readNotifications(db,account,{id:notification.id},false,now+12);
  const receipt=await db.prepare('SELECT recipient,read_at FROM reward_receipts WHERE question_id=$1').get(question);
  assert.equal(receipt.recipient,active);assert.equal(receipt.read_at,now+12);
  assert.equal((await acceptedAnswers(db,new URLSearchParams())).answers[0].walletAddress,active);
 });
 await t.test('legacy accounts are unchanged; no wallet, content or identity rewritten',async()=>{
  assert.equal(await currentWalletForIdentity(db,payer),payer);
  assert.equal((await db.prepare('SELECT author FROM replies WHERE id=$1').get(answer.id)).author,social);
  assert.equal((await db.prepare("SELECT address FROM passkey_clone_wallets WHERE account_id='new'").get()).address,social);
  assert.equal((await db.prepare("SELECT address FROM passkey_fee_wallets WHERE account_id='new'").get()).address,active);
  await assert.rejects(db.prepare("UPDATE passkey_current_wallet_accounts SET account_id='other' WHERE account_id='new'").run());
  await assert.rejects(db.prepare("UPDATE passkey_community_accounts SET address=$1 WHERE account_id='new'").run(payer));
 });
});
