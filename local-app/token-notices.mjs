import assert from 'node:assert/strict';
import {id,Interface,formatUnits} from 'quais';
import {currentWalletForIdentity} from './current-wallet.mjs';
const transfer=id('Transfer(address,address,uint256)').toLowerCase();
const metadata=new Interface(['function decimals() view returns(uint8)','function symbol() view returns(string)']);
const hex=n=>'0x'+BigInt(n).toString(16),lower=x=>String(x??'').toLowerCase();
// Notification observation only. Never imports a signer, sender or activation worker.
// One bounded range per account per minute; cursor is committed with verified notices.
export function createTokenNotices(db,rpc,now=Date.now){
 const running=new Set(),last=new Map();
 async function scan(account){
  const address=account.address.toLowerCase();let wallet;
  if(account.method==='passkey'){
   const proof=await db.verifyCurrentWallet?.(account.id);
   assert(proof?.view?.deployed&&proof.row?.account_id===account.id&&proof.row.generation===3&&proof.row.revoked_at===null,'Verified active wallet required');
   wallet=lower(proof.row.plan.address);
  }else wallet=lower(await currentWalletForIdentity(db,address,{required:true}));
  assert(/^0x00[0-9a-f]{38}$/.test(wallet));assert.equal(await rpc('quai_chainId',[]),'0x9');
  const head=await rpc('quai_getBlockByNumber',['latest',false]);assert(head?.hash&&head.number);
  const endLimit=BigInt(head.number)-2n;if(endLimit<0n)return;
  const cursor=await db.prepare("SELECT * FROM token_notice_cursors WHERE address=$1 AND wallet=$2 AND token='*'").get(address,wallet);
  let from=cursor?BigInt(cursor.block_number)+1n:(endLimit>127n?endLimit-127n:0n);
  if(cursor){const previous=await rpc('quai_getBlockByNumber',[hex(cursor.block_number),false]);assert.equal(lower(previous?.hash),lower(cursor.block_hash),'Notification cursor no longer canonical');}
  if(from>endLimit)return;
  const end=from+127n<endLimit?from+127n:endLimit,anchor=await rpc('quai_getBlockByNumber',[hex(end),false]);assert(anchor?.hash);
  const topic='0x'+wallet.slice(2).padStart(64,'0');
  const logs=await rpc('quai_getLogs',[{fromBlock:hex(from),toBlock:hex(end),topics:[transfer,null,topic]}]);
  assert(Array.isArray(logs)&&logs.length<1000,'Incomplete notification log range');
  const notices=[],cache=new Map();
  for(const log of logs){
   assert(!log.removed&&lower(log.topics?.[0])===transfer&&lower(log.topics?.[2])===topic);
   assert(BigInt(log.blockNumber)>=from&&BigInt(log.blockNumber)<=end);
   // ERC-721 uses a fourth topic; it is not a fungible-token receipt.
   if(log.topics.length!==3||!/^0x[0-9a-f]{64}$/i.test(log.data)||BigInt(log.data)===0n)continue;
   const receipt=await rpc('quai_getTransactionReceipt',[log.transactionHash]);
   assert(receipt?.status==='0x1'&&lower(receipt.transactionHash??receipt.hash)===lower(log.transactionHash));
   assert.equal(lower(receipt.blockHash),lower(log.blockHash));
   const block=await rpc('quai_getBlockByNumber',[log.blockNumber,false]);assert.equal(lower(block?.hash),lower(log.blockHash));
   assert(receipt.logs.some(x=>!x.removed&&lower(x.address)===lower(log.address)&&lower(x.logIndex)===lower(log.logIndex)&&lower(x.data)===lower(log.data)&&JSON.stringify(x.topics.map(lower))===JSON.stringify(log.topics.map(lower))));
   const contract=lower(log.address);assert(/^0x00[0-9a-f]{38}$/.test(contract));
   let asset=cache.get(contract);
   if(!asset){
    try{const dec=await rpc('quai_call',[{to:contract,data:metadata.encodeFunctionData('decimals')},hex(end)]),sym=await rpc('quai_call',[{to:contract,data:metadata.encodeFunctionData('symbol')},hex(end)]);
     asset={decimals:Number(metadata.decodeFunctionResult('decimals',dec)[0]),symbol:String(metadata.decodeFunctionResult('symbol',sym)[0]).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,32)};
     assert(asset.decimals>=0&&asset.decimals<=36);
    }catch{asset={decimals:0,symbol:contract+' (raw units)'};}
    cache.set(contract,asset);
   }
   notices.push({key:'token:'+wallet+':'+lower(log.transactionHash)+':'+log.logIndex,amount:formatUnits(BigInt(log.data),asset.decimals),symbol:asset.symbol+' · '+contract,hash:lower(log.transactionHash)});
  }
  assert.equal(lower((await rpc('quai_getBlockByNumber',[hex(end),false]))?.hash),lower(anchor.hash));
  assert.equal(lower((await rpc('quai_getBlockByNumber',[head.number,false]))?.hash),lower(head.hash));
  await db.transaction(async()=>{
   await db.lock('token-notices:'+address+':'+wallet);
   const current=await db.prepare("SELECT * FROM token_notice_cursors WHERE address=$1 AND wallet=$2 AND token='*'").get(address,wallet);
   assert.equal(current?.block_hash,cursor?.block_hash);assert.equal(current?.block_number,cursor?.block_number);
   for(const n of notices)await db.prepare("INSERT INTO account_activity(address,event_key,kind,amount,symbol,tx_hash,created_at) VALUES($1,$2,'token',$3,$4,$5,$6) ON CONFLICT(event_key) DO NOTHING").run(address,n.key,n.amount,n.symbol,n.hash,now());
   await db.prepare("INSERT INTO token_notice_cursors(address,wallet,token,block_number,block_hash) VALUES($1,$2,'*',$3,$4) ON CONFLICT(address,wallet,token) DO UPDATE SET block_number=excluded.block_number,block_hash=excluded.block_hash").run(address,wallet,Number(end),anchor.hash);
  });
 }
 return {scan,schedule(account){if(!account?.address)return;const key=account.address.toLowerCase();if(running.has(key)||now()-(last.get(key)??0)<60000)return;last.set(key,now());running.add(key);void scan(account).catch(()=>console.error('[token-notification] verification deferred')).finally(()=>running.delete(key));}};
}
