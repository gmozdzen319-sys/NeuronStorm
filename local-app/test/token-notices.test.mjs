import test from 'node:test';
import assert from 'node:assert/strict';
import {id,Interface} from 'quais';
import {createApp} from './database.mjs';
import {createTokenNotices} from '../token-notices.mjs';
const address='0x0011111111111111111111111111111111111111',token='0x0022222222222222222222222222222222222222',hash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
const abi=new Interface(['function decimals() view returns(uint8)','function symbol() view returns(string)']);
async function fixture(t){
 const app=await createApp({database:':memory:'});t.after(()=>app.close());const {db}=app;await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,1);
 let malformed=false,reorg=false,head=130n;const methods=[];
 const log={address:token,transactionHash:hash,blockNumber:'0x7f',blockHash,logIndex:'0x0',topics:[id('Transfer(address,address,uint256)'),'0x'+'0'.repeat(64),'0x'+address.slice(2).padStart(64,'0')],data:'0x'+(5n*10n**18n).toString(16).padStart(64,'0')};
 const rpc=async(method,args)=>{methods.push(method);if(method==='quai_chainId')return '0x9';if(method==='quai_getBlockByNumber')return {number:args[0]==='latest'?'0x'+head.toString(16):args[0],hash:reorg?'0x'+'ee'.repeat(32):blockHash};if(method==='quai_getLogs')return malformed?[{...log,removed:true}]:[log].filter(l=>BigInt(l.blockNumber)>=BigInt(args[0].fromBlock));if(method==='quai_getTransactionReceipt')return {status:'0x1',transactionHash:hash,blockHash,logs:[log]};if(method==='quai_call')return args[0].data===abi.encodeFunctionData('decimals')?abi.encodeFunctionResult('decimals',[18]):abi.encodeFunctionResult('symbol',['TOKEN']);throw Error(method);};
 return {db,rpc,methods,change(value){malformed=value==='malformed';reorg=value==='reorg';if(value==='advance')head+=1n;}};
}
test('External token notice verifies receipt and canonical block, persists cursor and survives restart without duplicate',async t=>{
 const f=await fixture(t);await createTokenNotices(f.db,f.rpc,()=>1).scan({address});
 let rows=await f.db.prepare('SELECT * FROM account_activity').all();assert.equal(rows.length,1);assert.equal(rows[0].amount,'5.0');assert.equal(rows[0].tx_hash,hash);
 f.change('advance');await createTokenNotices(f.db,f.rpc,()=>2).scan({address});assert.equal((await f.db.prepare('SELECT count(*) AS n FROM account_activity').get()).n,1);
 assert(!f.methods.some(m=>/send|sign/i.test(m)));
 f.change('reorg');await assert.rejects(createTokenNotices(f.db,f.rpc).scan({address}));assert.equal((await f.db.prepare('SELECT count(*) AS n FROM account_activity').get()).n,1);
});
test('Removed/inconsistent token logs cannot create a notice or advance a cursor',async t=>{
 const f=await fixture(t);f.change('malformed');await assert.rejects(createTokenNotices(f.db,f.rpc).scan({address}));
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM account_activity').get()).n,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM token_notice_cursors').get()).n,0);
});

test('Passkey incoming notices use verified current wallet, not the social identity or another account',async t=>{
 const f=await fixture(t),identity='0x0033333333333333333333333333333333333333';await f.db.prepare('INSERT INTO accounts VALUES($1,$2)').run(identity,1);
 f.db.verifyCurrentWallet=async()=>({row:{account_id:'account',generation:3,revoked_at:null,plan:{address}},view:{deployed:true}});
 await createTokenNotices(f.db,f.rpc).scan({id:'account',method:'passkey',address:identity});
 const row=await f.db.prepare('SELECT * FROM account_activity').get();assert.equal(row.address,identity);assert(row.event_key.includes(address));
 await assert.rejects(createTokenNotices(f.db,f.rpc).scan({id:'different',method:'passkey',address:identity}));
 assert.equal((await f.db.prepare('SELECT count(*) AS n FROM account_activity').get()).n,1);
});
test('Failed or different-block receipts never become incoming-token notifications',async t=>{
 for(const mode of ['failed','wrong-block']){
  const f=await fixture(t),rpc=async(method,args)=>{const result=await f.rpc(method,args);if(method==='quai_getTransactionReceipt')return {...result,...(mode==='failed'?{status:'0x0'}:{blockHash:'0x'+'ef'.repeat(32)})};return result;};
  await assert.rejects(createTokenNotices(f.db,rpc).scan({address}));assert.equal((await f.db.prepare('SELECT count(*) AS n FROM account_activity').get()).n,0);
 }
});
