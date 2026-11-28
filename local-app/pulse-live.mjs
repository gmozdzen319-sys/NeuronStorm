import {createHash,randomBytes,randomInt} from 'node:crypto';
// Ephemeral HTTPS relay. No addresses, free text, location inference or offline queue.
export function createPulseLive({clock=()=>Date.now(),random=randomInt}={}) {
 const members=new Map(),deliveries=new Map();
 const subject=id=>createHash('sha256').update('ns-pulse-v1:'+id).digest('hex');
 const push=(m,event)=>{if(m&&m.events.length<64)m.events.push(event);};
 const fail=message=>{throw Object.assign(new Error(message),{status:400});};
 function prune(now){
  for(const [id,m] of members)if(now-m.seen>45000)members.delete(id);
  for(const [id,d] of deliveries)if(now-d.at>120000){if(!d.acked)push(members.get(d.from),{type:'error',code:'DELIVERY_UNCONFIRMED_NO_REROUTE'});deliveries.delete(id);}
 }
 function act(account,b){
  const now=clock();prune(now);const key=subject(account);
  if(!b||!['poll','send','react','block','leave'].includes(b.action)||!/^[a-f0-9]{32}$/.test(b.node||''))fail('Invalid request');
  let m=members.get(key);
  if(b.action==='leave'){if(m?.node===b.node)members.delete(key);return {events:[]};}
  if(b.action==='poll'){
   const p=b.preferences;
   if(!p||p.enabled!==true||typeof p.receive!=='boolean'||!['great','good','normal','bad','sad'].includes(p.mood)||!Number.isFinite(p.mood_until)||p.mood_until<=now/1000||p.mood_until>now/1000+86402||p.country!=null&&!/^[A-Z]{2}$/.test(p.country))fail('Choose a current mood');
   if(!Array.isArray(b.blocked)||b.blocked.length>1000||b.blocked.some(x=>!/^[a-f0-9]{64}$/.test(x)))fail('Invalid block list');
   if(!m){if(members.size>=10000)fail('Pulse is busy');m={node:b.node,events:[],sent:0,blocked:new Set()};members.set(key,m);}
   if(m.node!==b.node)fail('Pulse is already enabled on another device');
   m.p={enabled:true,receive:p.receive,mood:p.mood,mood_until:p.mood_until,country:p.country||null};m.seen=now;m.blocked=new Set(b.blocked);
   for(const id of Array.isArray(b.acks)?b.acks.slice(0,64):[]){const d=deliveries.get(id);if(d?.to===key&&!d.acked&&!m.blocked.has(d.from)){d.acked=true;push(members.get(d.from),{type:'delivered',id,country:d.country,mood:d.mood});}}
  }else{
   if(!m||m.node!==b.node)fail('Enable Pulse again');
   m.seen=now;
   if(b.action==='send'){
    if(m.p.mood_until<=now/1000)fail('Choose your mood again');
    if(now-m.sent<15000)fail('Wait a few seconds before sending another Pulse');
    if(deliveries.size>=10000)fail('Pulse is busy; try again shortly');
    m.sent=now;push(m,{type:'searching'});
    const available=[...members].filter(([id,r])=>id!==key&&r.p.receive&&['good','great'].includes(r.p.mood)&&r.p.mood_until>now/1000&&!r.blocked.has(key)&&!m.blocked.has(id)&&r.events.length<60);
    if(!available.length)push(m,{type:'error',code:'NO_ELIGIBLE_PEER_FOUND'});
    else{const [to,r]=available[random(available.length)],id=randomBytes(16).toString('hex');deliveries.set(id,{from:key,to,at:now,mood:r.p.mood,country:r.p.country||null,acked:false});push(m,{type:'selected',origin:m.p.country||null,country:r.p.country||null});push(r,{type:'received',id,subject:key,mood:m.p.mood,country:m.p.country||null});}
   }else if(b.action==='react'){
    const d=deliveries.get(b.pulse);
    if(!d||d.to!==key||!d.acked||d.reacted||!['heart','hug','smile'].includes(b.reaction)||m.blocked.has(d.from)||members.get(d.from)?.blocked.has(key))fail('Reaction unavailable');
    d.reacted=true;push(members.get(d.from),{type:'reaction',id:b.pulse,reaction:b.reaction});
   }else if(b.action==='block'){
    if(!/^[a-f0-9]{64}$/.test(b.subject||'')||m.blocked.size>=1000)fail('Invalid member');m.blocked.add(b.subject);
    m.events=m.events.filter(e=>e.subject!==b.subject);
   }
  }
  return {subject:key,events:m.events.splice(0,64),status:'Online · HTTPS relay'};
 }
 async function handle(req,res,account,reauth){
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  if(req.method!=='POST'){send(405,{error:'POST required'});return;}
  if(req.headers['x-ns-desktop']!=='1'||req.headers.origin&&req.headers.origin!=='https://neuronstorm.onrender.com'){send(403,{error:'Origin rejected'});return;}
  let size=0,chunks=[];
  try{for await(const chunk of req){size+=chunk.length;if(size>70000){send(413,{error:'Request too large'});return;}chunks.push(chunk);}
   if(await reauth()!==account){send(401,{error:'Session changed'});return;}
   send(200,act(account,JSON.parse(Buffer.concat(chunks).toString('utf8'))));
  }catch(e){send(e.status||400,{error:e.status?e.message:'Invalid Pulse request'});}
 }
 return {act,handle};
}
