import {loadLegal} from '../legal.mjs';
import {NS_TOKEN} from '../neuron-token.mjs';
import {mockTokenFetch} from './token-fixture.mjs';
// Isolated UI QA only: disposable wallets, in-memory database, no user data.
import {randomBytes,createHash} from 'node:crypto';
import {Wallet,isQuaiAddress,id as eventId} from 'quais';
import {createApp,ADMIN} from './database.mjs';
let paymentHeight=100n;const paymentTransactions=new Map();
const mockPaymentFetch=async(url,options)=>{const {method,params}=JSON.parse(options.body);const saved=paymentTransactions.get(params[0]);const result=method==='quai_chainId'?'0x9':method==='quai_blockNumber'?'0x'+paymentHeight.toString(16):method==='quai_getTransactionReceipt'?saved?.receipt||null:method==='quai_getTransactionByHash'?saved?.tx||null:method==='quai_getBlockByNumber'?{hash:'0x'+'bb'.repeat(32)}:null;return {ok:true,json:async()=>({result})};};
const origin='http://127.0.0.1:43127';const {server,db}=(await createApp({legal:loadLegal({published:false,version:'QA'}),database:':memory:',origin,...(process.env.QA_GLOBE_DEMO==='1'?{trustProxy:true,geoLookup:()=> 'GB'}:{}),paymentFetch:mockPaymentFetch,tokenFetch:mockTokenFetch,holdingsFetch:async url=>({ok:true,json:async()=>({status:'1',result:url.searchParams.get('action')==='balance'?'125012345678901234567':[{name:'Demo token (test data)',symbol:'DEMO',type:'ERC-20',contractAddress:'0x0000000000000000000000000000000000000001',balance:'25000000',decimals:'6'}]})})}));
await new Promise(resolve=>server.listen(43127,'127.0.0.1',resolve));
const sessions={},addresses={},wallets={};
for(const [actor,nickname,topic]of [['author','Morgan','Cooking'],['alex','Alex','Electrical work'],['sam','Sam','Electrical work'],['outsider','Taylor','Gardening'],['newcomer','New member','Books']]){
  let wallet;do{wallet=new Wallet(randomBytes(32).toString('hex'));}while(!isQuaiAddress(wallet.address)||!wallet.address.toLowerCase().startsWith('0x00'));
  addresses[actor]=wallet.address;wallets[actor]=wallet;
  const challengeResponse=await fetch(origin+'/api/challenge',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({address:wallet.address})});
  const challenge=await challengeResponse.json();
  const response=await fetch(origin+'/api/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:challengeResponse.headers.getSetCookie()[0].split(';')[0]},body:JSON.stringify({id:challenge.id,signature:await wallet.signMessage(challenge.message)})});
  if(!response.ok)throw new Error('QA authentication failed');sessions[actor]=response.headers.getSetCookie()[0];if(actor==='newcomer')continue;
  await fetch(origin+'/api/token/confirm',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessions[actor].split(';')[0]},body:JSON.stringify({contract:NS_TOKEN.address,confirmed:true})});
  const profile=await fetch(origin+'/api/profile',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessions[actor].split(';')[0]},body:JSON.stringify({nickname,work:[topic],hobbies:[]})});if(!profile.ok)throw new Error('QA profile failed');
}
// Synthetic administrator session exists only in this disposable in-memory fixture.
const adminToken=randomBytes(32).toString('hex');(await db.prepare("INSERT INTO accounts VALUES($1,$2)").run(ADMIN,Date.now()));(await db.prepare("INSERT INTO sessions VALUES($1,$2,$3)").run(createHash('sha256').update(adminToken).digest('hex'),ADMIN,Date.now()+28800000));sessions.admin='ns_session='+adminToken+'; HttpOnly; SameSite=Strict; Path=/';
async function qaRequest(actor,path,data){if(data?.body&&(path==='/api/questions'||/^\/api\/questions\/[^/]+\/replies$/.test(path))){const challenge=await qaRequest(actor,'/api/actions/challenge',{path,payload:data});data={actionId:challenge.id,signature:await wallets[actor].signMessage(challenge.message)};}const response=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessions[actor].split(';')[0]},body:data===undefined?undefined:JSON.stringify(data)});if(!response.ok)throw new Error('QA seed failed '+response.status);return response.json();}
await qaRequest('admin','/api/token/confirm',{contract:NS_TOKEN.address,confirmed:true});
await qaRequest('admin','/api/profile',{nickname:'Test Administrator',work:['Administration'],hobbies:[]});
const categoryId=(await qaRequest('author','/api/categories')).categories.work.find(c=>c.name==='Electrical work').id;
const question=await qaRequest('author','/api/questions',{categoryId,body:'How should I plan the lighting in a small kitchen?'});
await qaRequest('alex','/api/questions/'+question.id+'/replies',{body:'Use separate task lighting above the worktop.'});
const reply=(await qaRequest('author','/api/questions/'+question.id)).thread.replies[0];await qaRequest('author','/api/questions/'+question.id+'/replies/'+reply.id+'/vote',{value:1});
await qaRequest('author','/api/questions',{categoryId,body:'Which lighting controls are easiest to use?'});
if(process.env.QA_GLOBE_DEMO==='1'){const seed=async ()=>{for(const [actor,country] of [['alex','US'],['sam','PL'],['outsider','BR']])(await db.prepare("INSERT INTO globe_presence VALUES($1,$2,$3) ON CONFLICT(address) DO UPDATE SET seen=excluded.seen").run(addresses[actor].toLowerCase(),country,Date.now()));};(await seed());setInterval(seed,20000).unref();}
const handler=server.listeners('request')[0];server.removeListener('request',handler);
server.on('request',(req,res)=>{
  if(process.env.QA_GLOBE_DEMO==='1')req.headers['x-forwarded-for']='8.8.8.8';
  if(req.url==='/qa-wallet-provider.js'){const actor=Object.keys(sessions).find(key=>req.headers.cookie?.includes(sessions[key].split(';')[0]))||'author';res.writeHead(200,{'Content-Type':'text/javascript'});return res.end((process.env.QA_BLIP==='1'?'window.quai={isBlip:true,':'window.pelagus={')+'request:async ({method,params})=>{if((method==="quai_accounts"||method==="quai_requestAccounts"))return '+JSON.stringify([addresses[actor]])+';if(method==="quai_chainId")return "0x9";if(method==="wallet_watchAsset")return true;if(method==="quai_sendTransaction"){const r=await fetch("/qa-send",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(params[0])});return (await r.json()).hash;}if(method==="personal_sign"){const r=await fetch("/qa-sign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:params[0]})});return (await r.json()).signature;}throw new Error("Unsupported QA request")}};');}
  if(req.url==='/qa-send'&&req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{try{const input=JSON.parse(body),hash='0x'+randomBytes(32).toString('hex'),block='0x'+(++paymentHeight).toString(16),blockHash='0x'+'bb'.repeat(32);paymentHeight+=2n;const tx={hash,from:input.from,to:input.to,value:input.value,input:input.data,blockHash};const receipt={transactionHash:hash,status:'0x1',blockNumber:block,blockHash,logs:[{address:NS_TOKEN.address,topics:[eventId('Transfer(address,address,uint256)'),'0x'+input.from.slice(2).padStart(64,'0'),'0x'+input.data.slice(10,74)],data:'0x'+input.data.slice(74)}]};paymentTransactions.set(hash,{tx,receipt});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({hash}));}catch{res.writeHead(400);res.end('{}');}});return;}
  if(req.url==='/qa-sign'&&req.method==='POST'){const actor=Object.keys(sessions).find(key=>req.headers.cookie?.includes(sessions[key].split(';')[0]));if(!wallets[actor]){res.writeHead(403);return res.end('{}');}let body='';req.on('data',chunk=>body+=chunk);req.on('end',async()=>{try{const message=Buffer.from(JSON.parse(body).message.slice(2),'hex').toString('utf8');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({signature:await wallets[actor].signMessage(message)}));}catch{res.writeHead(400);res.end('{}');}});return;}
  const actor=req.url?.match(/^\/qa\/(author|alex|sam|outsider|admin|newcomer)$/)?.[1];
  if(actor){res.writeHead(302,{'Set-Cookie':sessions[actor],Location:'/'});return res.end();}
  if(req.url==='/'&&req.method==='GET'){
    if(!req.headers.cookie?.includes('ns_session='))res.setHeader('Set-Cookie',sessions.author);
    const end=res.end.bind(res);
    res.end=(data,...args)=>end(Buffer.from(data).toString().replace('<head>','<head><script src="/qa-wallet-provider.js"></script>').replace('<body>','<body><p class="shell" role="note">TEST PREVIEW — simulated locations, balances, payments and wallet approval; disposable accounts. Switch test account: <a href="/qa/author">Morgan (author)</a> · <a href="/qa/alex">Alex (recipient)</a> · <a href="/qa/sam">Sam (recipient)</a> · <a href="/qa/outsider">Taylor (outsider)</a> · <a href="/qa/admin">Test Administrator</a> · <a href="/qa/newcomer">New registration</a></p>'),...args);
  }
  handler(req,res);
});
console.log('Isolated multi-account QA: '+origin);
