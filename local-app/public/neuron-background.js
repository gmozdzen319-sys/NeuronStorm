import {createLiveNetwork} from './network-live.js';
import {storyData,storyScenes,storyPhase,topAnswerMember} from './network-story-data.js';
// Presentation only. The original canvas, topology and ambient motion remain shared.
const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=n=>{n=clamp(n);return n*n*(3-2*n);};
export function networkPath(edges,start,end){
 const adjacent=new Map();for(const [a,b] of edges){if(!adjacent.has(a))adjacent.set(a,[]);if(!adjacent.has(b))adjacent.set(b,[]);adjacent.get(a).push(b);adjacent.get(b).push(a);}
 const queue=[start],parents=new Map([[start,null]]);for(let i=0;i<queue.length;i++){const n=queue[i];if(n===end)break;for(const next of adjacent.get(n)||[])if(!parents.has(next)){parents.set(next,n);queue.push(next);}}
 if(!parents.has(end))return [];const result=[];for(let n=end;n!==null;n=parents.get(n))result.unshift(n);return result;
}
export function storyState(progress){
 const p=clamp(progress),enter=smooth(p/.09),settle=1-smooth((p-.96)/.04);
 return {progress:p,strength:settle,zoom:1+(.08*Math.sin(p*Math.PI*2)+.05*enter)*settle,wake:(.16+.84*enter)*settle,loss:0,question:smooth((p-.265)/.075),answer:smooth((p-.525)/.10)};
}
export function debateMembers(points,mobile=false){
 const candidates=points.map((p,index)=>({...p,index})).filter(p=>mobile?p.v>=.57&&p.v<=.86&&p.u>.1&&p.u<.9&&p.index%2===0:p.u>=.57&&p.u<=.83&&p.v>=.28&&p.v<=.72);
 return candidates.slice(0,mobile?8:16).map(({index},i)=>({index,years:storyData.responders[i][1],specialty:storyData.responders[i][0]}));
}
export function introReloadState(navigationType,historyState){
  const view=historyState?.neuronSection?.route?.view;
  return {homeReload:navigationType==='reload'&&view==='ask',skipSection:!!view&&view!=='ask'};
}
export function startNeuronBackground(){
  const canvas=document.querySelector('#neuron-background'),ctx=canvas?.getContext('2d');
  if(!ctx)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const liveNetwork=createLiveNetwork(networkPath,()=>!active&&!reduced.matches);
  let width=0,height=0,frame=0,last=0,time=0,points=[],edges=[],sparks=[],nextSpark=4+Math.random()*8;
  const story=document.querySelector('#network-story'),header=document.querySelector('body>header');
  const navigation=performance.getEntriesByType('navigation')[0];
  const {homeReload,skipSection}=introReloadState(navigation?.type,window.history.state);
  if(story&&skipSection)story.hidden=true;
  if(story&&!story.querySelector('.story-scroll-hint')){const hint=document.createElement('div');hint.className='story-scroll-hint';hint.textContent='Scroll down ↓';story.querySelector('.story-stage')?.append(hint);}
  // Build presentation text from the isolated fictional source. Never fetch member data.
  const copy=story?.querySelector('.story-copy'),annotations=story?.querySelector('.story-nodes');
  if(copy){copy.replaceChildren(...storyScenes.map(scene=>{const article=document.createElement('article');article.className='story-beat'+(scene.quote?' story-answer':'');article.dataset.storyAt=scene.at;
    for(const [tag,className,text] of [['p','story-kicker',scene.label],[scene.at===0?'h1':'h2','',scene.title],['p','story-support',scene.body],['blockquote','',scene.quote],['p','story-note',scene.note]])if(text){const element=document.createElement(tag);element.className=className;element.textContent=text;article.append(element);}return article;}));}
  const beats=[...(story?.querySelectorAll('.story-beat')||[])],starts=beats.map(b=>Number(b.dataset.storyAt));
  let progress=0,rawProgress=0,visualProgress=0,active=false,completed=skipSection,mouse={x:0,y:0},people=[],route=[],debate=[],debateRoutes=[],returnRoutes=[],exitRoute=[],lastBeat=-1;
  const hideAnnotations=()=>annotations?.replaceChildren();
  let sessionObserver;
  function finishIntro(){
    if(completed||!story)return;
    const top=header?.getBoundingClientRect().top??0;
    completed=true;active=false;hideAnnotations();story.hidden=true;
    document.body.classList.remove('story-in-network');
    window.removeEventListener('scroll',updateStory);
    story.querySelector('#story-skip')?.removeEventListener('click',skip);
    sessionObserver?.disconnect();
    window.scrollTo({top:Math.max(0,-top),behavior:'instant'});
    progress=1;visualProgress=1;rawProgress=1;draw();
  }
  function layoutStory(){
    if(!story||completed)return;
    story.classList.toggle('is-enhanced',!reduced.matches);
    if(reduced.matches){for(const b of beats){b.style.opacity='';b.style.removeProperty('--story-shift');b.removeAttribute('aria-hidden');b.inert=false;}hideAnnotations();}
    else lastBeat=-1;
    updateStory();
  }
  function updateStory(){
    if(!story||story.hidden||completed){active=false;hideAnnotations();document.body.classList.remove('story-in-network');return;}
    const rect=story.getBoundingClientRect();rawProgress=-rect.top/Math.max(1,story.offsetHeight-innerHeight);progress=clamp(rawProgress);
    if((reduced.matches&&header.getBoundingClientRect().top<=innerHeight*.2)||(!reduced.matches&&rawProgress>=1.075)){finishIntro();return;}
    active=rect.top<=innerHeight&&rect.bottom>0;
    document.body.classList.toggle('story-in-network',active);
    story.style.setProperty('--story-progress',String(progress));story.dataset.progress=progress.toFixed(4);
    if(!reduced.matches){
      let current=0;for(let i=1;i<starts.length;i++)if(progress>=starts[i])current=i;
      for(let i=0;i<beats.length;i++){
        const start=starts[i],end=starts[i+1]??.99;
        const fadeIn=i===0?1:smooth((progress-start)/.018),fadeOut=1-smooth((progress-end+.018)/.018);
        const opacity=progress>=start&&progress<=end?fadeIn*fadeOut:0;
        beats[i].style.opacity=String(opacity);beats[i].style.setProperty('--story-shift',((1-fadeIn)*18-(1-fadeOut)*12)+'px');
        if(lastBeat!==current){beats[i].setAttribute('aria-hidden',String(i!==current));beats[i].inert=i!==current;}
      }
      lastBeat=current;story.dataset.stage=String(current);

    }
    if(reduced.matches||!frame)draw();
  }
  function skip(){finishIntro();header?.querySelector('.brand')?.focus({preventScroll:true});}
  story?.querySelector('#story-skip').addEventListener('click',skip);
  window.addEventListener('scroll',updateStory,{passive:true});
  window.addEventListener('pointermove',event=>{if(event.pointerType!=='touch'){mouse.x=event.clientX/innerWidth-.5;mouse.y=event.clientY/innerHeight-.5;}},{passive:true});
  const logout=document.querySelector('#logout');
  if(story&&logout){sessionObserver=new MutationObserver(()=>{if(!logout.hidden&&!(homeReload&&window.history.state?.neuronSection?.route?.view==='ask'))finishIntro();});sessionObserver.observe(logout,{attributes:true,attributeFilter:['hidden']});}

  const transitionLabelAnchors=new Map();
  function resize(){
    transitionLabelAnchors.clear();
    width=innerWidth;height=innerHeight;
    const ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
    const cols=width<600?10:19,rows=8;points=[];edges=[];
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const index=points.length;
      points.push({u:col/(cols-1),v:row/(rows-1),phase:Math.sin(index*17.3)*Math.PI,depth:.4+.6*(.5+.5*Math.sin(index*7.9))});
      if(col)edges.push([index-1,index]);if(row)edges.push([index-cols,index]);if(row&&col&&(row+col)%2===0)edges.push([index-cols-1,index]);
    }
    const nearest=(u,v)=>points.reduce((best,p,i)=>(p.u-u)**2+(p.v-v)**2<(points[best].u-u)**2+(points[best].v-v)**2?i:best,0);

    const source=nearest(width<701?.15:.37,width<701?.88:.76);
    debate=debateMembers(points,width<701);
    // The first responder is also the eventual Best Answer author.
    const reserved=new Set([source,...debate.map(m=>m.index)]);
    const coordinates=width<701?[[.16,.46],[.65,.46],[.16,.60],[.65,.60],[.16,.74]]:[[.44,.43],[.9,.28],[.5,.43],[.9,.43],[.5,.57],[.9,.57],[.5,.71],[.9,.71],[.65,.86],[.4,.86]];
    people=[debate[0].index];
    for(const [u,v] of coordinates){const index=points.reduce((best,p,i)=>reserved.has(i)?best:best<0||(p.u-u)**2+(p.v-v)**2<(points[best].u-u)**2+(points[best].v-v)**2?i:best,-1);if(index>=0){people.push(index);reserved.add(index);}}
    route=networkPath(edges,source,people[0]);
    debateRoutes=debate.map(member=>networkPath(edges,people[0],member.index));
    returnRoutes=storyData.responses.map((answer,rank)=>{
      const start=debate[topAnswerMember(answer,width<701)].index;
      if(rank!==1||width<701)return networkPath(edges,start,source);
      // Guide Bricklayer through the centre, using only existing network edges.
      const from=points[start],to=points[source],stops=[start,...[.25,.5,.75].map(t=>nearest(from.u+(to.u-from.u)*t,from.v+(to.v-from.v)*t)),source];
      return stops.slice(1).reduce((path,end,i)=>path.concat(networkPath(edges,stops[i],end).slice(i?1:0)),[]);
    });
    exitRoute=networkPath(edges,nearest(.5,.14),nearest(.5,1));
    sparks=[];
    updateStory();draw();
  }
  function draw(){
    ctx.clearRect(0,0,width,height);
    visualProgress+=(progress-visualProgress)*.24;if(Math.abs(progress-visualProgress)<.00005)visualProgress=progress;
    const state=storyState(visualProgress),power=active&&!completed&&!reduced.matches?state.strength:0;
    const positions=points.map(p=>({x:p.u*width+Math.sin(p.phase*5)*width*.018+Math.sin(time*.09+p.phase)*9,y:(p.v+.11*Math.sin(p.u*6+time*.035+p.v*2)+Math.sin(p.phase*3)*.035)*height+Math.cos(time*.07+p.phase)*6}));
    if(power)for(let i=0;i<positions.length;i++){const p=positions[i],depth=points[i].depth;
      const zoom=1+(state.zoom-1)*(width<701?.28:1);
      p.x=width*.5+(p.x-width*.5)*zoom+mouse.x*16*depth*power;
      p.y=height*.5+(p.y-height*.5)*zoom+mouse.y*11*depth*power;
    }
    const exiting=active&&!completed&&!reduced.matches&&rawProgress>=.92;
    const exitPhase=clamp((rawProgress-.92)/.155);
    if(exiting)for(const point of positions)point.y-=height*.16*Math.sin(exitPhase*Math.PI);
    const life=i=>1-state.loss*(people.includes(i)?.88:(i%7===0?.65:.12));
    sparks=sparks.filter(s=>time<s.start+s.duration);
    if(!exiting&&!reduced.matches&&!document.hidden&&time>=nextSpark&&sparks.length===0){
      const candidates=positions.map((p,i)=>({ ...p,i })).filter(p=>p.x>20&&p.x<width-20&&p.y>20&&p.y<height-20);
      const count=Math.min(1+Math.floor(Math.random()*3),candidates.length);
      for(let n=0;n<count;n++){
        const [point]=candidates.splice(Math.floor(Math.random()*candidates.length),1);
        sparks.push({index:point.i,start:time+Math.random()*2,duration:5+Math.random()*3});
      }
      nextSpark=time+16+Math.random()*14;
    }
    const glow=Math.pow(.5+.5*Math.sin(time*Math.PI/32),8);
    edges.forEach(([a,b])=>{
      const p=points[a],start=positions[a],end=positions[b];
      const center=Math.abs(p.u-.5)*2;
      const red=Math.round(255+(45-255)*p.u),green=Math.round(65+(191-65)*p.u),blue=Math.round(95+(255-95)*p.u);
      ctx.strokeStyle=`rgba(${red},${green},${blue},${(.035+.085*center)*(1+glow*.4)*p.depth*(1+power*state.wake*3)* (power?Math.min(life(a),life(b)):1)})`;
      ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();
    });
    points.forEach((p,i)=>{
      const {x,y}=positions[i],color=p.u<.45?'255,100,112':'55,198,255',alpha=(.09+.14*Math.abs(p.u-.5)*2)*p.depth;
      ctx.fillStyle=`rgba(${color},${(alpha+glow*.09)*(1+power*state.wake*3)*(power?life(i):1)})`;ctx.beginPath();ctx.arc(x,y,1+p.depth,0,Math.PI*2);ctx.fill();
      const spark=sparks.find(s=>s.index===i),progress=spark?(time-spark.start)/spark.duration:-1;
      const strength=progress>0&&progress<1?Math.sin(Math.PI*progress)**2:0;
      if(strength>0&&!exiting){
        const radius=20+12*strength,halo=ctx.createRadialGradient(x,y,0,x,y,radius);
        halo.addColorStop(0,`rgba(${color},${strength*.48})`);halo.addColorStop(.3,`rgba(${color},${strength*.16})`);halo.addColorStop(1,`rgba(${color},0)`);
        ctx.fillStyle=halo;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
        ctx.fillStyle=`rgba(${color},${strength*.85})`;ctx.beginPath();ctx.arc(x,y,2+strength*1.4,0,Math.PI*2);ctx.fill();
      }
      if(i%13===0&&!exiting){const halo=ctx.createRadialGradient(x,y,0,x,y,13);halo.addColorStop(0,`rgba(${color},${.07+glow*.05})`);halo.addColorStop(1,`rgba(${color},0)`);ctx.fillStyle=halo;ctx.fillRect(x-13,y-13,26,26);}
    });
    if(power)drawStory(positions,state,power);
    else hideAnnotations();
    if(exiting)drawExit(positions,exitPhase);
    if(!active&&!reduced.matches)liveNetwork.draw(ctx,positions,edges,width,height,performance.now());
  }
  function drawStory(positions,state,power){
    const p=state.progress,mobile=width<701;
    const travel=(path,t,color,opacity=1)=>{
      if(path.length<2||t<=0)return;
      const lengths=path.slice(1).map((index,i)=>Math.hypot(positions[index].x-positions[path[i]].x,positions[index].y-positions[path[i]].y));
      let remaining=clamp(t)*lengths.reduce((a,b)=>a+b,0),segment=0;
      while(segment<lengths.length-1&&remaining>lengths[segment])remaining-=lengths[segment++];
      const fraction=lengths[segment]?remaining/lengths[segment]:0;
      ctx.lineWidth=1.4;ctx.lineJoin='round';ctx.lineCap='round';ctx.strokeStyle=`rgba(${color},${.55*opacity*power})`;ctx.beginPath();
      const first=positions[path[0]];ctx.moveTo(first.x,first.y);
      for(let j=1;j<=segment;j++){const at=positions[path[j]];ctx.lineTo(at.x,at.y);}
      const a=positions[path[segment]],b=positions[path[segment+1]],x=a.x+(b.x-a.x)*fraction,y=a.y+(b.y-a.y)*fraction;ctx.lineTo(x,y);ctx.stroke();
      const halo=ctx.createRadialGradient(x,y,0,x,y,19);halo.addColorStop(0,`rgba(${color},${.8*opacity*power})`);halo.addColorStop(1,`rgba(${color},0)`);ctx.fillStyle=halo;ctx.fillRect(x-19,y-19,38,38);ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fillStyle=`rgba(${color},${opacity*power})`;ctx.fill();
    };
    const phase=storyPhase(p),windowAlpha=(from,to,fade=.014)=>smooth((p-from)/fade)*(1-smooth((p-to+fade)/fade))*power;
    // Labels are canvas text anchored to the existing person's node, never cards.
    const occupied=[];
    const continuousLabels=p>=.41&&p<.59;
    if(!continuousLabels)transitionLabelAnchors.clear();
    const label=(at,lines,alpha,{above='',accent='104,223,248',offset=0}={})=>{
      const font=mobile?9:10;
      ctx.textAlign='left';ctx.textBaseline='top';ctx.font=`${font}px Arial, Helvetica, sans-serif`;
      const wrapped=[];
      for(const line of lines){let part='';for(const word of line.split(' ')){const next=part?part+' '+word:word;if(part&&ctx.measureText(next).width>(mobile?105:132)){wrapped.push(part);part=word;}else part=next;}wrapped.push(part);}
      const w=Math.max(...wrapped.map(line=>ctx.measureText(line).width)),h=wrapped.length*13+(above?17:0);
      let best=null;
      for(const dy of [offset,offset-30,offset+18,offset-48])for(const side of [1,-1]){
        const x=side===1?at.x+8:at.x-w-8,y=at.y+dy-(above?17:0);
        const box={x,y,w,h};let cost=(x<8||x+w>width-8||y<60||y+h>height-8)?100000:0;
        for(const b of occupied)cost+=Math.max(0,Math.min(x+w,b.x+b.w)-Math.max(x,b.x))*Math.max(0,Math.min(y+h,b.y+b.h)-Math.max(y,b.y));
        if(!best||cost<best.cost)best={...box,cost};if(cost===0)break;
      }
      // Keep each label on its chosen side of its node through the 04 → 05 boundary.
      if(continuousLabels){
        const key=positions.indexOf(at),anchor=transitionLabelAnchors.get(key);
        if(anchor)best={...best,x:at.x+anchor.x,y:at.y+anchor.y};
        else transitionLabelAnchors.set(key,{x:best.x-at.x,y:best.y-at.y});
      }
      occupied.push(best);const y=best.y+(above?17:0);
      ctx.fillStyle=`rgba(196,237,255,${alpha})`;wrapped.forEach((line,i)=>ctx.fillText(line,best.x,y+i*13));
      if(above){ctx.font=`600 ${mobile?10:11}px Arial, Helvetica, sans-serif`;ctx.fillStyle=`rgba(${accent},${alpha})`;ctx.fillText(above,best.x,y-17);}
    };
    const dot=(at,alpha,color='104,223,248',radius=3)=>{ctx.fillStyle=`rgba(${color},${alpha})`;ctx.beginPath();ctx.arc(at.x,at.y,radius,0,Math.PI*2);ctx.fill();};
    const peopleAlpha=smooth((p-.08)/.012)*(1-smooth((p-.80)/.04))*power;
    if(peopleAlpha>0)people.forEach((index,i)=>{
      // Builder is shared by PEOPLE and the responding community: one person, one dot.
      if(i===0&&p>=.28)return;
      const revealed=smooth((p-(.08+i*.009))/.009);if(!revealed)return;
      const at=positions[index],person=storyData.people[i],alpha=peopleAlpha*revealed*(p>.20?.5:1);
      dot(at,alpha);label(at,mobile&&p>.28?[`${person[0]} · ${person[1]} years`]:[`${person[0]} · ${person[1]} years`,person[2]],alpha);
    });
    const origin=positions[route[0]],danielAlpha=windowAlpha(.20,.825);
    if(danielAlpha>0){dot(origin,danielAlpha,p>.50&&p<.59?'104,223,248':'239,108,134',4.5);
      label(origin,[storyData.daniel.name,`${storyData.daniel.role} · ${storyData.daniel.years} years experience`],danielAlpha);
    }
    if(p>.215&&p<.50)travel(route,smooth(phase.question),'239,108,134',windowAlpha(.20,.50));
    const communityAlpha=(p>=.28?1:0)*(1-smooth((p-.811)/.014))*power,choice=smooth((p-.425)/.055);
    if(communityAlpha>0){
      for(let i=0;i<debate.length;i++){
        const member=debate[i],at=positions[member.index],rank=storyData.responses.findIndex(answer=>topAnswerMember(answer,mobile)===i),top=rank>=0,reveal=i===0?1:smooth((phase.spread-i*.025)/.35),strength=(top?1:i%3===0?.65:.45)*(1-choice*(top?0:.4)),alpha=communityAlpha*reveal*strength;
        if(!reveal)continue;
        if(p<.50)travel(debateRoutes[i],smooth(clamp((phase.spread-i*.025)/.6)),'104,223,248',alpha*.24);
        dot(at,alpha,'104,223,248',top?4:2.5);
        if(top&&p>=.43){ctx.strokeStyle=`rgba(239,140,163,${alpha*choice})`;ctx.beginPath();ctx.arc(at.x,at.y,11,-Math.PI/2,-Math.PI/2+Math.PI*2*choice);ctx.stroke();}
        // Keep the same node-anchored label layout across COMMUNITY CHOICE and TOP ANSWERS.
        if(top&&p>=.50&&p<.59){
          ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${mobile?10:11}px Arial, Helvetica, sans-serif`;
          ctx.fillStyle=`rgba(196,237,255,${alpha})`;ctx.fillText(String(rank+1),at.x,at.y-19);
        }
        const helpfulAt=.34+rank*.03,helpful=top&&p>=helpfulAt&&p<helpfulAt+.023;
        let above=helpful?'HELPFUL +1':'';
        if(i===0&&phase.chosen){above=p>=.70&&p<.77?'+5 REPUTATION':'BEST ANSWER';}
        const lines=[`${member.specialty} · ${member.years} years`];
        if(i===0)lines.push(storyData.people[0][2]);
        if(i===0&&p>=.70)lines.push(`${storyData.builderReputationBeforeChoice+Math.round(phase.bonus*storyData.rules.bestAnswer)} Reputation`);
        label(at,lines,alpha,{above,offset:mobile&&i%2?-24:0});
      }
    }
    // Scene 05: same three existing routes, timing, colours and return movement.
    if(p>=.50&&p<.62)for(let i=0;i<returnRoutes.length;i++)travel(returnRoutes[i],smooth(clamp((phase.returning-i*.10)/.8)),i===1?'239,108,134':'104,223,248',windowAlpha(.50,.62));
    // Daniel authorizes his final choice with one red signal along the original path.
    if(p>=.60&&p<.69)travel(route,smooth(clamp((p-.60)/.065)),'239,108,134',windowAlpha(.60,.69));
    if(phase.chosen&&p<.825){const at=positions[debate[0].index],pulse=1-clamp((p-.665)/.035);
      ctx.strokeStyle=`rgba(239,108,134,${windowAlpha(.665,.825)})`;ctx.lineWidth=2;ctx.beginPath();ctx.arc(at.x,at.y,10+pulse*9+Math.sin(phase.bonus*Math.PI)*5,0,Math.PI*2);ctx.stroke();}
  }
  function drawExit(positions,t){
    if(exitRoute.length<2)return;
    const pathProgress=Math.min(1,t/.82),scaled=pathProgress*(exitRoute.length-1),i=Math.min(exitRoute.length-2,Math.floor(scaled)),f=scaled-i;
    const a=positions[exitRoute[i]],b=positions[exitRoute[i+1]];
    const x=a.x+(b.x-a.x)*f;
    let y=a.y+(b.y-a.y)*f;
    if(t>.82)y+=(height+30-y)*clamp((t-.82)/.18);
    const halo=ctx.createRadialGradient(x,y,0,x,y,17);halo.addColorStop(0,'rgba(255,100,112,.65)');halo.addColorStop(1,'rgba(255,100,112,0)');ctx.fillStyle=halo;ctx.fillRect(x-17,y-17,34,34);ctx.fillStyle='#ff6470';ctx.beginPath();ctx.arc(x,y,3.5,0,Math.PI*2);ctx.fill();
  }

  function tick(now){
    if(document.hidden||reduced.matches){frame=0;return;}
    if(now-last>=1000/30){time+=Math.min((now-last)/1000,.1);last=now;draw();}
    frame=requestAnimationFrame(tick);
  }
  function reset(){cancelAnimationFrame(frame);frame=0;last=performance.now();draw();if(!document.hidden&&!reduced.matches)frame=requestAnimationFrame(tick);}
  if(story&&!story.hidden){window.scrollTo({top:0,behavior:'instant'});window.addEventListener('pageshow',()=>{if(!completed)requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));},{once:true});}
  let sameSiteReturn=false;try{sameSiteReturn=navigation?.type!=='reload'&&new URL(document.referrer).origin===location.origin;}catch{}
  resize();if(sameSiteReturn)finishIntro();reset();window.addEventListener('resize',resize);document.addEventListener('visibilitychange',reset);reduced.addEventListener('change',()=>{layoutStory();reset();});layoutStory();
}
