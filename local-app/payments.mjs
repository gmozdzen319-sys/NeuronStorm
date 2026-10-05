import {QUESTION_LIFETIME} from './lifecycle.mjs';
import {randomUUID} from 'node:crypto';
import {id as hashEvent} from 'quais';
import {NS_TOKEN} from './neuron-token.mjs';
import {requireProfile,allowed} from './threads.mjs';
export const REWARD_ADDRESS='0x001d5bE0940145De0c2c1D851b99f33968DED764';
const fail=(status,message)=>Object.assign(new Error(message),{status});
const lower=value=>typeof value==='string'?value.toLowerCase():'';
const TRANSFER=hashEvent('Transfer(address,address,uint256)').toLowerCase();
export function nsUnits(value){
  if(typeof value!=='string'||!/^\d{1,12}(\.\d{1,18})?$/.test(value))throw fail(400,'Enter an NS amount with up to 18 decimal places.');
  const [whole,fraction='']=value.split('.'),units=BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));
  if(units<=0n)throw fail(400,'The tip must be greater than zero.');return units.toString();
}
export const transferData=(recipient,units)=>'0xa9059cbb'+recipient.slice(2).toLowerCase().padStart(64,'0')+BigInt(units).toString(16).padStart(64,'0');

export function createPayments(db,fetcher=fetch,clock=null){
  async function rpc(method,params){try{const response=await fetcher('https://rpc.quai.network/cyprus1',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();const data=await response.json();if(data.error)throw Error();return data.result;}catch{throw fail(502,'Quai Network is unavailable. Keep your transaction hash and check again.');}}
  async function head(){const chain=await rpc('quai_chainId',[]);if(chain!=='0x9')throw fail(502,'Quai Mainnet could not be verified.');const block=await rpc('quai_blockNumber',[]);if(typeof block!=='string'||!/^0x[0-9a-f]+$/i.test(block))throw fail(502,'Invalid Quai block.');return BigInt(block);}
  async function reply(account,replyId){(await requireProfile(db,account));const row=(await db.prepare("SELECT * FROM replies WHERE id=$1 AND deleted_at IS NULL").get(replyId));if(!row)throw fail(404,'This answer is no longer available.');const question=(await allowed(db,row.question_id,account));if(clock&&question.created_at+QUESTION_LIFETIME<=clock())throw fail(409,'This conversation has expired. Keep any payment hash for the administrator.');return row;}
  function output(row){return {id:row.id,action:row.action,recipient:row.recipient,units:row.units,replyId:row.reply_id,body:row.body,completed:row.completed_at!==null,transaction:{from:row.payer,to:NS_TOKEN.address,value:'0x0',data:transferData(row.recipient,row.units)}};}
  return {
    async prepare(account,input,now){
      if(!Number.isSafeInteger(input.replyId)||!['tip','edit',"delete"].includes(input.action))throw fail(400,'Choose an answer and payment action.');
      const row=(await reply(account,input.replyId)),payer=account.address.toLowerCase(),action=input.action;
      if(action!=='tip'&&row.author!==payer)throw fail(403,'Only the author can change this answer.');
      if(action==='tip'&&row.author===payer)throw fail(400,'You cannot tip your own answer.');
      const recipient=action==='tip'?row.author:REWARD_ADDRESS;
      if(!/^0x00[0-9a-f]{38}$/i.test(payer)||!/^0x00[0-9a-f]{38}$/i.test(recipient))throw fail(400,'NS payments require Quai accounts in Cyprus-1.');
      const units=action==='tip'?nsUnits(input.amount):'1000000000000000000';
      const body=action==='edit'?input.body?.trim():'';
      if(action==='edit'&&(typeof body!=='string'||!body||body.length>2000||body===row.body))throw fail(400,'Enter a changed answer between 1 and 2,000 characters.');
      const start=await head(),intentId=randomUUID();
      // Recheck after RPC so no stale reply version is offered for payment.
      return db.transaction(async()=>{
      await db.lock('question:'+row.question_id);
      const current=(await reply(account,input.replyId));if(current.version!==row.version)throw fail(409,'The answer changed. Please review it again.');
      (await db.prepare("INSERT INTO payment_intents(id,payer,reply_id,action,recipient,units,body,reply_version,start_block,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)").run(intentId,payer,row.id,action,recipient,units,body,row.version,start.toString(),now));
      return output((await db.prepare("SELECT * FROM payment_intents WHERE id=$1").get(intentId)));
      });
    },
    async confirm(account,input,now){
      (await requireProfile(db,account));if(typeof input.id!=='string'||typeof input.txHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(input.txHash))throw fail(400,'Enter a valid transaction hash.');
      const intent=(await db.prepare("SELECT * FROM payment_intents WHERE id=$1 AND payer=$2").get(input.id,account.address.toLowerCase()));if(!intent)throw fail(404,'Payment request not found.');
      const hash=input.txHash.toLowerCase();
      if(intent.completed_at!==null){if(intent.tx_hash!==hash)throw fail(409,'This request already has a different payment.');return {ok:true,action:intent.action};}
      if((await db.prepare("SELECT 1 FROM reward_receipts WHERE tx_hash=$1").get(hash)))throw fail(409,'This transaction has already been used.');
      const used=(await db.prepare("SELECT id FROM payment_intents WHERE tx_hash=$1").get(hash));if(used&&used.id!==intent.id)throw fail(409,'This transaction has already been used.');
      const currentBlock=await head();const [receipt,tx]=await Promise.all([(await rpc('quai_getTransactionReceipt',[hash])),(await rpc('quai_getTransactionByHash',[hash]))]);
      if(!receipt||!tx)throw fail(409,'Transaction pending. Check again without sending another payment.');
      if(receipt.status!=='0x1')throw fail(400,'This transaction did not succeed. No answer change was applied.');
      const block=typeof receipt.blockNumber==='string'&&/^0x[0-9a-f]+$/i.test(receipt.blockNumber)?BigInt(receipt.blockNumber):null;
      if(block===null||block<=BigInt(intent.start_block))throw fail(400,'The payment must be sent after this request was created.');
      if(currentBlock-block+1n<3n)throw fail(409,'Waiting for 3 confirmations. Check again without paying twice.');
      if(lower(receipt.transactionHash??receipt.hash)!==hash||lower(tx.hash)!==hash||lower(tx.from)!==intent.payer||lower(tx.to)!==NS_TOKEN.address.toLowerCase()||lower(tx.input??tx.data)!==transferData(intent.recipient,intent.units)||(typeof tx.value!=='string'||!/^0x[0-9a-f]+$/i.test(tx.value)||BigInt(tx.value)!==0n)||lower(tx.blockHash)!==lower(receipt.blockHash))throw fail(400,'This transaction does not match this NS payment.');
      const canonical=await rpc('quai_getBlockByNumber',[receipt.blockNumber,false]);if(!canonical||lower(canonical.hash)!==lower(receipt.blockHash))throw fail(409,'Waiting for the canonical payment block. Check again.');
      const from='0x'+intent.payer.slice(2).padStart(64,'0'),to='0x'+intent.recipient.slice(2).toLowerCase().padStart(64,'0');
      const transferred=receipt.logs?.some(log=>!log.removed&&lower(log.address)===NS_TOKEN.address.toLowerCase()&&lower(log.topics?.[0])===TRANSFER&&lower(log.topics?.[1])===from&&lower(log.topics?.[2])===to&&/^0x[0-9a-f]{64}$/i.test(log.data)&&BigInt(log.data).toString()===intent.units);
      if(!transferred)throw fail(400,'The exact NS transfer was not found in the receipt.');

      return db.transaction(async()=>{
        await db.lock('payment:'+intent.id);
        await db.lock('transaction:'+hash);
        if(intent.action!=='tip'){
          const answer=await db.prepare('SELECT question_id FROM replies WHERE id=$1').get(intent.reply_id);
          if(answer)await db.lock('question:'+answer.question_id);
        }
        const latest=(await db.prepare("SELECT * FROM payment_intents WHERE id=$1").get(intent.id));
        if(latest.completed_at!==null){if(latest.tx_hash!==hash)throw fail(409,'Payment already completed.');return {ok:true,action:intent.action};}
        if((await db.prepare("SELECT 1 FROM reward_receipts WHERE tx_hash=$1").get(hash)))throw fail(409,'This transaction has already been used.');
        if((await db.prepare("SELECT 1 FROM payment_intents WHERE tx_hash=$1").get(hash)))throw fail(409,'This transaction has already been used.');
        await db.prepare("INSERT INTO used_transactions VALUES(9,$1,'payment',$2)").run(hash,intent.id);
        if(intent.action!=='tip'){
          let answer;try{answer=(await reply(account,intent.reply_id));}catch(error){if(error.status===404||error.status===409)throw fail(409,'This conversation closed before the answer change was confirmed. Keep your transaction hash and contact the administrator. Do not pay again.');throw error;}
          if(answer.author!==intent.payer||answer.version!==intent.reply_version)throw fail(409,'The answer changed after payment preparation. Keep your transaction hash and contact the administrator.');
          await db.query("SELECT set_config('neuron.event_time',$1,true)",[String(now)]);
          if(intent.action==='edit'){(await db.prepare("UPDATE replies SET body=$1,edited_at=$2,version=version+1 WHERE id=$3").run(intent.body,now,answer.id));(await db.prepare("DELETE FROM reply_votes WHERE reply_id=$1").run(answer.id));}
          else {await db.prepare("UPDATE replies SET deleted_at=$1,version=version+1 WHERE id=$2").run(now,answer.id);await db.prepare("DELETE FROM reply_votes WHERE reply_id=$1").run(answer.id);}
          (await db.prepare("UPDATE questions SET revision=revision+1,updated_at=$1 WHERE id=$2").run(now,answer.question_id));
        }
        (await db.prepare("UPDATE payment_intents SET tx_hash=$1,completed_at=$2 WHERE id=$3").run(hash,now,intent.id));return {ok:true,action:intent.action};
      });
    }
  };
}
