// Presentation-only event queue. Random positions are unrelated to identity/location.
export function activityQueue(){
 const seen=new Map(),queue=[];
 return {push(events,now){for(const e of events){if(!['question','answer'].includes(e.kind)||!e.id||seen.has(e.id)||now-e.at>45000||e.at>now+5000)continue;seen.set(e.id,now);queue.push(e);}while(queue.length>8)queue.shift();for(const [id,at] of seen)if(now-at>120000)seen.delete(id);while(seen.size>200)seen.delete(seen.keys().next().value);},next(now){while(queue.length){const e=queue.shift();if(now-e.at<=45000)return e;}return null;},clear(){queue.length=0;},get size(){return queue.length;}};
}
export function createLiveNetwork(pathFor,enabled){
 const queue=activityQueue(),contexts=new Map(),images=new Map();let cursor=null,busy=false,nextPoll=0,animation=null,geometrySize=0;
 const fetchImage=id=>{
  if(!id||!/^[a-f0-9-]{36}$/i.test(id))return null;
  if(images.has(id))return images.get(id);
  const image=new Image();image.decoding='async';image.src='/api/network-avatar/'+id;images.set(id,image);
  while(images.size>48)images.delete(images.keys().next().value);return image;
 };
 async function poll(){
  if(busy||!enabled()||document.hidden||Date.now()<nextPoll)return;
  busy=true;nextPoll=Date.now()+5000;
  try{const res=await fetch('/api/network-activity'+(cursor===null?'':'?since='+cursor),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(8000)});if(!res.ok)throw Error();const data=await res.json();if(!Number.isFinite(data.through)||!Array.isArray(data.events))throw Error();cursor=data.through;if(enabled()&&!document.hidden){queue.push(data.events,Date.now());for(const e of data.events){fetchImage(e.person?.avatar);fetchImage(e.asker?.avatar);}}}catch{nextPoll=Date.now()+15000;}finally{busy=false;}
 }
 // Existing renderer drives polling too: no extra animation loop or layout work.
 function draw(ctx,positions,edges,width,height,now){
  if(!enabled()||document.hidden){animation=null;queue.clear();return;}
  if(!busy&&Date.now()>=nextPoll)void poll();
  if(geometrySize!==positions.length){contexts.clear();animation=null;geometrySize=positions.length;}
  for(const [id,c] of contexts)if(now-c.updated>600000)contexts.delete(id);
  if(!animation){const event=queue.next(Date.now());if(!event)return;
   const suitable=positions.map((p,i)=>({p,i})).filter(({p})=>p.x>28&&p.x<width-28&&p.y>100&&p.y<height-45);
   const pick=exclude=>{const choices=suitable.filter(({i})=>!exclude.includes(i));return choices.length?choices[Math.floor(Math.random()*choices.length)].i:null;};
   let context=contexts.get(event.conversation);
   if(!context){const asker=pick([]);if(asker===null)return;context={asker,topic:pick([asker]),updated:now};contexts.set(event.conversation,context);}
   context.updated=now;while(contexts.size>100)contexts.delete(contexts.keys().next().value);
   const from=event.kind==='question'?context.asker:pick([context.asker,context.topic]),to=event.kind==='question'?context.topic:context.asker;
   if(from===null||to===null)return;const path=pathFor(edges,from,to);if(path.length<2)return;
   animation={event,path,start:now};
  }
  const {event,path,start}=animation,t=(now-start)/12000;if(t>=1){animation=null;return;}
  const alpha=Math.min(1,t/.12,(1-t)/.17)*.55,travel=Math.max(0,Math.min(1,(t-.18)/.62));
  const origin=positions[path[0]],target=positions[path.at(-1)];
  ctx.save();ctx.globalAlpha=alpha;ctx.lineWidth=1;ctx.lineCap='round';ctx.strokeStyle=event.kind==='question'?'#ef6c86':'#68dff8';
  const lengths=path.slice(1).map((id,i)=>Math.hypot(positions[id].x-positions[path[i]].x,positions[id].y-positions[path[i]].y));let distance=lengths.reduce((a,b)=>a+b,0)*travel,segment=0;
  while(segment<lengths.length-1&&distance>lengths[segment])distance-=lengths[segment++];
  const a=positions[path[segment]],b=positions[path[segment+1]],f=lengths[segment]?distance/lengths[segment]:0,x=a.x+(b.x-a.x)*f,y=a.y+(b.y-a.y)*f;
  ctx.beginPath();ctx.moveTo(origin.x,origin.y);for(let i=1;i<=segment;i++)ctx.lineTo(positions[path[i]].x,positions[path[i]].y);ctx.lineTo(x,y);ctx.stroke();
  const glow=ctx.createRadialGradient(x,y,0,x,y,11);glow.addColorStop(0,event.kind==='question'?'#ef6c86':'#68dff8');glow.addColorStop(1,'transparent');ctx.fillStyle=glow;ctx.fillRect(x-11,y-11,22,22);
  function person(at,p,status){const image=fetchImage(p?.avatar);ctx.save();ctx.beginPath();ctx.arc(at.x,at.y,10,0,Math.PI*2);ctx.clip();ctx.fillStyle='#193541';ctx.fillRect(at.x-10,at.y-10,20,20);
   if(image?.complete&&image.naturalWidth)ctx.drawImage(image,at.x-10,at.y-10,20,20);else{ctx.fillStyle='#8fb6c6';ctx.beginPath();ctx.arc(at.x,at.y-3,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(at.x,at.y+8,7,Math.PI,Math.PI*2);ctx.fill();}ctx.restore();
   ctx.font='10px Arial, Helvetica, sans-serif';ctx.textAlign=at.x>width-160?'right':'left';ctx.textBaseline='top';const tx=at.x+(ctx.textAlign==='right'?-15:15);ctx.fillStyle='#c4edff';ctx.fillText(String(p?.nickname||'Member').slice(0,22),tx,at.y-9);if(status){ctx.font='9px Arial, Helvetica, sans-serif';ctx.fillStyle='#8bb7d1';ctx.fillText(status,tx,at.y+5);}}
  person(origin,event.person,event.kind==='question'?'QUESTION SENT':'ANSWER SENT');
  if(event.kind==='answer')person(target,event.asker,'');
  if(travel>=1){ctx.strokeStyle='#68dff8';ctx.beginPath();ctx.arc(target.x,target.y,11+Math.sin((t-.8)*Math.PI/.2)*5,0,Math.PI*2);ctx.stroke();}
  ctx.restore();
 }
 return {draw};
}
