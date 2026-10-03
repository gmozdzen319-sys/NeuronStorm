import {id as hashEvent} from 'quais';
import {requireAdmin} from './admin.mjs';
import {NS_TOKEN} from './neuron-token.mjs';
import {REWARD_ADDRESS,transferData} from './payments.mjs';
import {formatBalance} from './holdings.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status}),lower=v=>typeof v==='string'?v.toLowerCase():'';
export function createRewardConfirmation(db,fetcher=fetch){
 const rpc=async(method,params)=>{try{const res=await fetcher('https://rpc.quai.network/cyprus1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error();const data=await res.json();if(data.error)throw Error();return data.result;}catch{throw fail(502,'Quai Network is unavailable. Try checking again.');}};
 return async(account,input,now=Date.now())=>{
  requireAdmin(db,account);if(typeof input.questionId!=='string'||!/^0x[0-9a-f]{64}$/i.test(input.txHash||''))throw fail(400,'Choose an accepted answer and enter its reward transaction hash.');
  const accepted=db.prepare('SELECT * FROM accepted_answers WHERE question_id=? AND answer_author IS NOT NULL').get(input.questionId);if(!accepted)throw fail(404,'Accepted answer not found.');
  const hash=input.txHash.toLowerCase(),existing=db.prepare('SELECT * FROM reward_receipts WHERE question_id=?').get(input.questionId);
  if(existing){if(existing.tx_hash!==hash)throw fail(409,'This answer already has a confirmed reward.');return {ok:true,amount:formatBalance(existing.units,18)};}
  if(db.prepare('SELECT 1 FROM reward_receipts WHERE tx_hash=?').get(hash)||db.prepare('SELECT 1 FROM payment_intents WHERE tx_hash=?').get(hash))throw fail(409,'This transfer has already been used.');
  if(await rpc('quai_chainId',[])!=='0x9')throw fail(502,'Quai Mainnet could not be verified.');
  const [receipt,tx,head]=await Promise.all([rpc('quai_getTransactionReceipt',[hash]),rpc('quai_getTransactionByHash',[hash]),rpc('quai_blockNumber',[])]);
  if(!receipt||!tx)throw fail(409,'Reward pending. Check again after confirmation.');
  if(receipt.status!=='0x1'||!/^0x[0-9a-f]+$/i.test(receipt.blockNumber||'')||!/^0x[0-9a-f]+$/i.test(head||''))throw fail(400,'A successful confirmed transfer is required.');
  if(BigInt(head)-BigInt(receipt.blockNumber)+1n<3n)throw fail(409,'Waiting for 3 network confirmations.');
  const block=await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]);
  if(!block||lower(block.hash)!==lower(receipt.blockHash)||!/^0x[0-9a-f]+$/i.test(block.timestamp||'')||Number(BigInt(block.timestamp))*1000<accepted.closed_at)throw fail(400,'Use a canonical transfer sent after the answer was accepted.');
  const from='0x'+REWARD_ADDRESS.slice(2).toLowerCase().padStart(64,'0'),to='0x'+accepted.answer_author.slice(2).toLowerCase().padStart(64,'0');
  const logs=(Array.isArray(receipt.logs)?receipt.logs:[]).filter(l=>!l.removed&&lower(l.address)===NS_TOKEN.address.toLowerCase()&&lower(l.topics?.[0])===hashEvent('Transfer(address,address,uint256)').toLowerCase()&&lower(l.topics?.[1])===from&&lower(l.topics?.[2])===to&&/^0x[0-9a-f]{64}$/i.test(l.data||''));
  if(logs.length!==1||BigInt(logs[0].data)<=0n)throw fail(400,'NS transfer from the reward pool to this answer author was not found.');
  const units=BigInt(logs[0].data).toString();
  if(lower(receipt.transactionHash??receipt.hash)!==hash||lower(tx.hash)!==hash||lower(tx.from)!==REWARD_ADDRESS.toLowerCase()||lower(tx.to)!==NS_TOKEN.address.toLowerCase()||lower(tx.blockHash)!==lower(receipt.blockHash)||lower(tx.input??tx.data)!==transferData(accepted.answer_author,units)||!/^0x[0-9a-f]+$/i.test(tx.value||'')||BigInt(tx.value)!==0n)throw fail(400,'This transaction does not match a direct NS reward transfer.');
  // All checks are complete before the synchronous, unique insert.
  const raced=db.prepare('SELECT * FROM reward_receipts WHERE question_id=? OR tx_hash=?').get(input.questionId,hash);
  if(raced){if(raced.question_id!==input.questionId||raced.tx_hash!==hash)throw fail(409,'Reward already recorded.');return {ok:true,amount:formatBalance(raced.units,18)};}
  if(db.prepare('SELECT 1 FROM payment_intents WHERE tx_hash=?').get(hash))throw fail(409,'This transfer has already been used.');
  db.prepare('INSERT INTO reward_receipts(question_id,recipient,units,tx_hash,created_at) VALUES(?,?,?,?,?)').run(input.questionId,accepted.answer_author,units,hash,now);
  return {ok:true,amount:formatBalance(units,18)};
 };
}
