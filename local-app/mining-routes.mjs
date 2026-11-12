import {createPrivateKey,createPublicKey,generateKeyPairSync} from 'node:crypto';
import QRCode from 'qrcode';
import {clientIp} from './geography.mjs';
import {createMiningPairs} from './mining-pairs.mjs';
import {createDesktopMining} from './desktop-mining.mjs';
import {renewMiningIdentity} from './mining-renewal.mjs';

export function miningRoutes({db,feeWallet,origin,now,account,externalAccount,body,cookies,hash}){
 const privateKey=process.env.NS_DESKTOP_IDENTITY_KEY?createPrivateKey(process.env.NS_DESKTOP_IDENTITY_KEY):generateKeyPairSync('ed25519').privateKey;
 const keyPem=privateKey.export({format:'pem',type:'pkcs8'});
 const verifyKey=Buffer.from(createPublicKey(privateKey).export({format:'jwk'}).x,'base64url').toString('hex');
 const attest=createDesktopMining({db,feeWallet,origin,now,keyPem});
 const pairs=createMiningPairs();
 const walletBindings=new Map();
 function desktopSession(req){
   const raw=cookies(req).ns_passkey_session;
   return typeof raw==='string' && /^[\w-]{43}$/.test(raw)?hash(raw):null;
 }
 function resetDesktop(req){
   walletBindings.delete(desktopSession(req));
 }
 function bindingFor(session){
   if(!session)return null;
   if(!walletBindings.has(session)){
     if(walletBindings.size>=2048)walletBindings.delete(walletBindings.keys().next().value);
     walletBindings.set(session,{});
   }
   return walletBindings.get(session);
 }
 const openCounts=new Map(),attestCounts=new Map();
 function rate(map,id,limit,windowMs){
   const t=now(), entry=map.get(id);
   if(entry && entry.until>t){if(++entry.count>limit)bad(429,'Too many mining connection requests');return;}
   if(map.size>=2048){for(const [k,v] of map)if(v.until<=t)map.delete(k);}
   if(map.size>=2048)bad(429,'Too many mining connections');
   map.set(id,{count:1,until:t+windowMs});
 }
 const bad=(status,message)=>{throw Object.assign(new Error(message),{status});};
 async function route(req,json,path){
  if(req.method==='GET' && path==='/api/desktop/key')return json(200,{verifyKey});
  if(req.method==='GET' && path==='/api/desktop/mining-identity'){
   const q=new URL(req.url,origin).searchParams;
   const observed=q.has('method')?{method:q.get('method'),address:q.get('address'),chain:q.get('chain')}:null;
   const current=await account(req);
   if(current)rate(attestCounts,current.id||current.address,20,10000);
   const binding=current?.method==='passkey'?bindingFor(desktopSession(req)):null;
   try {
     return json(200,await renewMiningIdentity({loadAccount:()=>account(req),
      attest:(a,c,o)=>attest(a,c,o,binding),
      challenge:q.get('challenge'),observed,
      diagnostic:value=>console.warn('[desktop-mining-renewal]',JSON.stringify(value))}));
   } catch(error){
     resetDesktop(req);
     throw error;
   }
  }
  if(req.method!=='POST'||!path.startsWith('/api/desktop/pair/'))bad(404,'Unknown desktop action');
  const action=path.slice('/api/desktop/pair/'.length);
  if(req.headers.origin!==origin && !(req.headers.origin===undefined&&req.headers['x-ns-desktop']==='1'&&['open','poll','close'].includes(action)))bad(403,'Invalid origin');
  if(!req.headers['content-type']?.startsWith('application/json'))bad(415,'JSON required');
  const p=await body(req,2048);
  if(action==='open'){
   rate(openCounts,clientIp(req,process.env.RENDER==='true')||'unknown',12,60000);
   const pair=pairs.open(p.method);
   const link=origin+'/desktop-link.html#'+new URLSearchParams({id:pair.id,invite:pair.invite,method:p.method});
   return json(200,{...pair,link,qr:await QRCode.toDataURL(link,{width:256})});
  }
  if(action==='poll')return json(200,pairs.poll(p));
  if(action==='close')return json(200,pairs.close(p));
  const current=await externalAccount(req);
  if(!current)bad(401,'Sign in to Neuron Storm in this wallet browser first.');
  const session=hash(cookies(req).ns_session);
  if(action==='claim'){
   if(p.address?.toLowerCase()!==current.address.toLowerCase())bad(409,'Selected wallet does not match your login.');
   return json(200,pairs.claim(p,session,current.address,p.method));
  }
  if(action==='challenge')return json(200,pairs.challenge(p,session));
  if(action==='confirm')return json(200,pairs.confirm(p,session,current.address));
  bad(404,'Unknown pairing action');
 }
 route.resetDesktop=resetDesktop;
 route.revokeSession=pairs.revokeSession; return route;
}
