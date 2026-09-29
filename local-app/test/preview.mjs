// Isolated UI QA only: disposable wallets, in-memory database, no user data.
import {randomBytes,createHash} from 'node:crypto';
import {Wallet,isQuaiAddress} from 'quais';
import {createApp,ADMIN} from '../server.mjs';
const origin='http://127.0.0.1:43127';const {server,db}=createApp({database:':memory:',origin});
await new Promise(resolve=>server.listen(43127,'127.0.0.1',resolve));
const sessions={};
for(const [actor,nickname,topic]of [['author','Morgan','Cooking'],['alex','Alex','Electrical work'],['sam','Sam','Electrical work'],['outsider','Taylor','Gardening']]){
  let wallet;do{wallet=new Wallet(randomBytes(32).toString('hex'));}while(!isQuaiAddress(wallet.address));
  const challengeResponse=await fetch(origin+'/api/challenge',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({address:wallet.address})});
  const challenge=await challengeResponse.json();
  const response=await fetch(origin+'/api/verify',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:challengeResponse.headers.getSetCookie()[0].split(';')[0]},body:JSON.stringify({id:challenge.id,signature:await wallet.signMessage(challenge.message)})});
  if(!response.ok)throw new Error('QA authentication failed');sessions[actor]=response.headers.getSetCookie()[0];
  const profile=await fetch(origin+'/api/profile',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessions[actor].split(';')[0]},body:JSON.stringify({nickname,work:[topic],hobbies:[]})});if(!profile.ok)throw new Error('QA profile failed');
}
// Synthetic administrator session exists only in this disposable in-memory fixture.
const adminToken=randomBytes(32).toString('hex');db.prepare('INSERT INTO accounts VALUES(?,?)').run(ADMIN,Date.now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(adminToken).digest('hex'),ADMIN,Date.now()+28800000);sessions.admin='ns_session='+adminToken+'; HttpOnly; SameSite=Strict; Path=/';
async function qaRequest(actor,path,data){const response=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:sessions[actor].split(';')[0]},body:data===undefined?undefined:JSON.stringify(data)});if(!response.ok)throw new Error('QA seed failed '+response.status);return response.json();}
await qaRequest('admin','/api/profile',{nickname:'Test Administrator',work:['Administration'],hobbies:[]});
const categoryId=(await qaRequest('author','/api/categories')).categories.work.find(c=>c.name==='Electrical work').id;
const question=await qaRequest('author','/api/questions',{categoryId,body:'How should I plan the lighting in a small kitchen?'});
await qaRequest('alex','/api/questions/'+question.id+'/replies',{body:'Use separate task lighting above the worktop.'});
const reply=(await qaRequest('author','/api/questions/'+question.id)).thread.replies[0];await qaRequest('author','/api/questions/'+question.id+'/replies/'+reply.id+'/vote',{value:1});
await qaRequest('author','/api/questions',{categoryId,body:'Which lighting controls are easiest to use?'});
const handler=server.listeners('request')[0];server.removeListener('request',handler);
server.on('request',(req,res)=>{
  const actor=req.url?.match(/^\/qa\/(author|alex|sam|outsider|admin)$/)?.[1];
  if(actor){res.writeHead(302,{'Set-Cookie':sessions[actor],Location:'/'});return res.end();}
  if(req.url==='/'&&req.method==='GET'){
    if(!req.headers.cookie?.includes('ns_session='))res.setHeader('Set-Cookie',sessions.author);
    const end=res.end.bind(res);
    res.end=(data,...args)=>end(Buffer.from(data).toString().replace('<body>','<body><p class="shell" role="note">TEST PREVIEW — disposable accounts. Switch test account: <a href="/qa/author">Morgan (author)</a> · <a href="/qa/alex">Alex (recipient)</a> · <a href="/qa/sam">Sam (recipient)</a> · <a href="/qa/outsider">Taylor (outsider)</a> · <a href="/qa/admin">Test Administrator</a></p>'),...args);
  }
  handler(req,res);
});
console.log('Isolated multi-account QA: '+origin);
