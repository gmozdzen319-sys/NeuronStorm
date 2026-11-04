import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const secret=()=>randomBytes(32).toString('hex');
const digest=value=>createHash('sha256').update(value).digest();
const valid=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const matches=(value,hash)=>valid(value)&&hash&&timingSafeEqual(digest(value),hash);
const reject=(status,message)=>{throw Object.assign(new Error(message),{status})};

// Ephemeral capabilities. A service restart invalidates every pairing. No session cookies
// or private keys leave the device that logged in. Expiration uses a monotonic clock.
export function createMiningPairs({clock=()=>performance.now(),capacity=256}={}){
 const pairs=new Map();
 function open(method){
  if(!['pelagus','blippay'].includes(method))reject(400,'Invalid external wallet method');
  const now=clock();
  for(const [id,p] of pairs)if(p.until<=now)pairs.delete(id);
  if(pairs.size>=capacity)reject(429,'Too many pending mining connections');
  const id=secret(),control=secret(),invite=secret();
  pairs.set(id,{method,control:digest(control),invite:digest(invite),until:now+120000});
  return {id,control,invite};
 }
 function get(id){
  const p=pairs.get(id);if(!p||clock()>=p.until){pairs.delete(id);reject(410,'Mining connection expired');}
  return p;
 }
 function check(p,session,address,method){
  if(!session||!/^0x00[0-7][0-9a-f]{37}$/i.test(address)||/^0x0{40}$/i.test(address)||p.method!==method)reject(403,'Authenticated wallet required');
 }
 function claim({id,invite},session,address,method){
  const p=get(id);check(p,session,address,method);
  if(!matches(invite,p.invite))reject(403,'Invalid or used connection link');
  const heartbeat=secret();
  Object.assign(p,{invite:null,session,address:address.toLowerCase(),heartbeat:digest(heartbeat),until:clock()+10000});
  return {heartbeat};
 }
 function prove(id,token,session){
  const p=get(id);if(!matches(token,p.heartbeat))reject(403,'Invalid mining confirmation');
  if(session!==p.session){pairs.delete(id);reject(409,'Login session changed');}return p;
 }
 function challenge({id,heartbeat},session){
  const p=prove(id,heartbeat,session);p.challenge=secret();p.issued=clock();
  return {challenge:p.challenge};
 }
 function confirm({id,heartbeat,challenge,address,method,chain},session,activeAddress){
  const p=prove(id,heartbeat,session);
  if(!valid(challenge)||p.challenge!==challenge||p.method!==method||chain!=='9'||
    p.address!==address?.toLowerCase()||p.address!==activeAddress?.toLowerCase()){
    pairs.delete(id);reject(409,'Wallet changed');
  }
  p.challenge=null;
  // A slow request or delayed response cannot grant a new period upon arrival.
  p.deadline=p.issued+4000;
  if(clock()>=p.deadline){pairs.delete(id);reject(410,'Confirmation expired');}
  p.until=p.deadline;
  return {confirmed:true};
 }
 function poll({id,control}){
  const p=get(id);if(!matches(control,p.control))reject(403,'Invalid desktop connection');
  if(!p.deadline)return {bound:false};
  return {bound:true,address:p.address,method:p.method,remainingMs:Math.max(0,Math.floor(p.deadline-clock()))};
 }
 function close({id,heartbeat,control}){
  const p=get(id);if(!matches(heartbeat,p.heartbeat)&&!matches(control,p.control))reject(403,'Invalid mining connection');
  pairs.delete(id);return {stopped:true};
 }
 function revokeSession(session){for(const [id,p] of pairs)if(p.session===session)pairs.delete(id);}
 return {open,claim,challenge,confirm,poll,close,revokeSession};
}
