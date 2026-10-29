import {randomUUID} from 'node:crypto';
import {id as eventId} from 'quais';
import {requireAdmin} from './admin.mjs';
import {NS_TOKEN} from './neuron-token.mjs';
import {REWARD_ADDRESS,transferData} from './payments.mjs';
const lower=v=>typeof v==='string'?v.toLowerCase():'',hex=v=>typeof v==='string'&&/^0x[0-9a-f]+$/i.test(v),hash=v=>/^0x[0-9a-f]{64}$/i.test(v||'');
const fail=(status,message)=>Object.assign(Error(message),{status});
export function createWeeklyPayments(db,fetcher=fetch){
 const rpc=async(method,params)=>{try{const r=await fetcher('https://rpc.quai.network/cyprus1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();const d=await r.json();if(d.error)throw Error();return d.result;}catch{throw fail(502,'Network verification unavailable. Keep the existing payment; do not send again.');}};
 async function auth(account){await requireAdmin(db,account);}
 async function terms(id){const row=await db.prepare('SELECT w.*,s.payable_at FROM weekly_rewards w JOIN weekly_reward_snapshots s USING(round_id) WHERE w.id=$1').get(id);if(!row)throw fail(404,'Weekly reward not found.');return row;}
 async function chain(){if(await rpc('quai_chainId',[])!=='0x9')throw fail(502,'Quai Mainnet could not be verified.');}
 return {
 async prepare(account,input,now){
  await auth(account);if(account.method==='passkey'||lower(account.address)!==lower(REWARD_ADDRESS))throw fail(403,'Connect and sign in with the reward wallet to authorize this payment.');
  const row=await terms(input.rewardId);if(row.status!=='unpaid')throw fail(409,'Check the existing payment. Do not pay again.');if(now<row.payable_at)throw fail(409,'Rewards become payable the day after the round ends.');if(!row.recipient)throw fail(423,'The frozen recipient could not be verified. Administrator review is required.');
  const links=await db.prepare('SELECT account_id FROM passkey_community_accounts WHERE address=$1').all(row.member);
  if(links.length){
   if(links.length!==1)throw fail(423,'Recipient wallet mapping is ambiguous.');
   const proof=await db.verifyCurrentWallet?.(links[0].account_id);
   if(!proof?.view?.deployed||proof.row?.account_id!==links[0].account_id||proof.row.generation!==3||proof.row.revoked_at!==null||lower(proof.row.plan?.address)!==row.recipient)throw fail(423,'Frozen wallet recipient could not be verified. No payment prepared.');
  }
  await chain();
  const [latest,pending,head,code,balance]=await Promise.all([rpc('quai_getTransactionCount',[REWARD_ADDRESS,'latest']),rpc('quai_getTransactionCount',[REWARD_ADDRESS,'pending']),rpc('quai_blockNumber',[]),rpc('quai_getCode',[REWARD_ADDRESS,'latest']),rpc('quai_call',[{to:NS_TOKEN.address,data:'0x70a08231'+REWARD_ADDRESS.slice(2).toLowerCase().padStart(64,'0')},'latest'])]);
  if(!hex(latest)||!hex(pending)||latest!==pending||!hex(head)||code!=='0x')throw fail(409,'Reward wallet has pending or unverifiable activity. Wait and check it first.');
  if(!hex(balance)||BigInt(balance)<BigInt(row.units))throw fail(409,'The reward wallet does not have enough NS.');
  const failed=await db.prepare("SELECT * FROM weekly_reward_attempts WHERE reward_id=$1 AND status='failed'").all(row.id);
  for(const prior of failed){
   const previousReceipt=await rpc('quai_getTransactionReceipt',[prior.tx_hash]);
   const previousBlock=await rpc('quai_getBlockByNumber',['0x'+BigInt(prior.block_number).toString(16),false]);
   if(previousReceipt?.status!=='0x0'||lower(previousReceipt.blockHash)!==prior.block_hash||lower(previousBlock?.hash)!==prior.block_hash||BigInt(latest)<=BigInt(prior.nonce))throw fail(409,'Previous failed payment is no longer safely canonical. Review required; do not send again.');
  }
  const id=randomUUID();
  await db.transaction(async()=>{await db.lock('weekly-reward-wallet');const current=await terms(row.id);if(current.status!=='unpaid'||await db.prepare("SELECT 1 FROM weekly_reward_attempts WHERE status IN('awaiting_wallet','submitted')").get())throw fail(409,'Another reward payment is awaiting verification.');
   if(await db.prepare('SELECT 1 FROM weekly_reward_attempts WHERE nonce=$1').get(BigInt(latest).toString()))throw fail(409,'Network nonce is stale. No payment request created; wait for a fresh network view.');
   await db.prepare("INSERT INTO weekly_reward_attempts(id,reward_id,admin,nonce,start_block,created_at,status) VALUES($1,$2,$3,$4,$5,$6,'awaiting_wallet')").run(id,row.id,lower(account.address),BigInt(latest).toString(),BigInt(head).toString(),now);
   await db.prepare("UPDATE weekly_rewards SET status='pending' WHERE id=$1").run(row.id);
  });
  return {id,rewardId:row.id,transaction:{from:REWARD_ADDRESS,to:NS_TOKEN.address,value:'0x0',data:transferData(row.recipient,row.units),nonce:latest},recipient:row.recipient,units:row.units};
 },
 async confirm(account,input,now){
  await auth(account);if(!hash(input.txHash))throw fail(400,'Enter the transaction hash from the reward wallet activity.');
  const attempt=await db.prepare('SELECT * FROM weekly_reward_attempts WHERE id=$1').get(input.attemptId);if(!attempt)throw fail(404,'Payment attempt not found.');const row=await terms(attempt.reward_id),txHash=lower(input.txHash);
  if(attempt.tx_hash&&attempt.tx_hash!==txHash)throw fail(409,'This attempt already references another transaction.');
  if(row.status==='paid'){if(row.tx_hash===txHash)return {status:'paid',txHash};throw fail(409,'This reward is already paid.');}
  await chain();const [tx,receipt,head]=await Promise.all([rpc('quai_getTransactionByHash',[txHash]),rpc('quai_getTransactionReceipt',[txHash]),rpc('quai_blockNumber',[])]);
  // Persist only a hash whose transaction matches the frozen intent and nonce.
  if(!tx)return {status:'pending',message:'Transaction not yet visible. Do not send again.'};
  if(lower(tx.hash)!==txHash||lower(tx.from)!==lower(REWARD_ADDRESS)||lower(tx.to)!==lower(NS_TOKEN.address)||lower(tx.input??tx.data)!==transferData(row.recipient,row.units)||!hex(tx.value)||BigInt(tx.value)!==0n||!hex(tx.nonce)||BigInt(tx.nonce).toString()!==attempt.nonce)throw fail(400,'Transaction does not match this frozen reward, sender, amount or nonce.');
  await db.transaction(async()=>{await db.lock('weekly-reward-wallet');const a=await db.prepare('SELECT * FROM weekly_reward_attempts WHERE id=$1').get(attempt.id);if(a.tx_hash&&a.tx_hash!==txHash)throw fail(409,'Payment changed.');if(a.status==='awaiting_wallet')await db.prepare("UPDATE weekly_reward_attempts SET tx_hash=$1,status='submitted' WHERE id=$2").run(txHash,a.id);});
  if(!receipt)return {status:'pending',txHash};
  if(lower(receipt.transactionHash??receipt.hash)!==txHash||!hash(receipt.blockHash)||lower(tx.blockHash)!==lower(receipt.blockHash)||!hex(receipt.blockNumber)||!hex(head)||BigInt(receipt.blockNumber)<BigInt(attempt.start_block)||BigInt(head)-BigInt(receipt.blockNumber)+1n<3n)return {status:'pending',txHash};
  const block=await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]);if(lower(block?.hash)!==lower(receipt.blockHash)||!hex(block?.timestamp)||Number(BigInt(block.timestamp))*1000<attempt.created_at-1000)return {status:'pending',txHash};
  if(!['0x0','0x1'].includes(receipt.status))return {status:'pending',txHash};
  if(receipt.status==='0x1'){
   const topic=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
   const transfers=(receipt.logs||[]).filter(l=>!l.removed&&lower(l.address)===lower(NS_TOKEN.address)&&lower(l.topics?.[0])===eventId('Transfer(address,address,uint256)').toLowerCase()&&lower(l.topics?.[1])===topic(REWARD_ADDRESS)&&lower(l.topics?.[2])===topic(row.recipient)&&/^0x[0-9a-f]{64}$/i.test(l.data||'')&&BigInt(l.data)===BigInt(row.units));
   if(transfers.length!==1)throw fail(409,'Successful receipt lacks the exact NS transfer. Review required; do not pay again.');
  }
  // Re-read canonical inclusion immediately before settlement. Fail closed on any change.
  if(lower((await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]))?.hash)!==lower(receipt.blockHash))return {status:'pending',txHash};
  return db.transaction(async()=>{
   await db.lock('weekly-reward-wallet');await db.lock('transaction:'+txHash);const current=await terms(row.id),a=await db.prepare('SELECT * FROM weekly_reward_attempts WHERE id=$1').get(attempt.id);
   if(current.status==='paid'){if(current.tx_hash===txHash)return {status:'paid',txHash};throw fail(409,'Already paid.');}
   if(a.status==='failed')return {status:'failed',txHash};
   if(receipt.status==='0x0'){
    await db.prepare("UPDATE weekly_reward_attempts SET status='failed',block_hash=$1,block_number=$2,checked_at=$3 WHERE id=$4").run(lower(receipt.blockHash),BigInt(receipt.blockNumber).toString(),now,a.id);
    await db.prepare("UPDATE weekly_rewards SET status='unpaid' WHERE id=$1").run(row.id);return {status:'failed',txHash};
   }
   await db.prepare("INSERT INTO used_transactions(chain_id,tx_hash,kind,reference) VALUES(9,$1,'reward',$2)").run(txHash,'weekly:'+row.id);
   await db.prepare("UPDATE weekly_reward_attempts SET status='paid',block_hash=$1,block_number=$2,checked_at=$3 WHERE id=$4").run(lower(receipt.blockHash),BigInt(receipt.blockNumber).toString(),now,a.id);
   await db.prepare("UPDATE weekly_rewards SET status='paid',tx_hash=$1,paid_at=$2 WHERE id=$3").run(txHash,now,row.id);
   return {status:'paid',txHash};
  });
 }
 };
}
