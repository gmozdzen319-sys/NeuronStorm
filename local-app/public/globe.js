const TAU=Math.PI*2;
export function spherePoint(lat,lon){const a=lat*Math.PI/180,b=lon*Math.PI/180;return [Math.cos(a)*Math.sin(b),Math.sin(a),Math.cos(a)*Math.cos(b)];}
export function createGlobe({api,getAccount}){
  const $=s=>document.querySelector(s),mini=$('#globe-mini'),large=$('#globe-large'),dialog=$('#globe-dialog'),trigger=$('#globe-open');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let map=[],countries=new Map(),data=null,owner=null,epoch=0,busy=false,paused=reduced.matches,angle=-.25,frame=0,last=0,miniVisible=false,loaded=false;
  let paths=[];
  const label=code=>countries.get(code)?.name||code;
  const point=code=>{const c=countries.get(code);return c?spherePoint(c.lat,c.lon):null;};
  function rebuild(){
    const target=data?.viewerCountry&&point(data.viewerCountry);paths=[];
    if(!target)return;
    // At most 100 beams are drawn; full counts remain in the legend.
    for(const group of data.countries){const start=point(group.country);if(!start)continue;const count=Math.max(0,group.count-(data.enabled&&group.country===data.viewerCountry?1:0));
      for(let j=0;j<Math.min(count,100-paths.length);j++){
        if(group.country===data.viewerCountry){paths.push([start,start]);continue;}
        const curve=[];for(let k=0;k<=40;k++){const t=k/40,p=start.map((v,i)=>v*(1-t)+target[i]*t),length=Math.hypot(...p);if(length<.001)continue;const lift=1+(.16+(j%5)*.035)*Math.sin(t*Math.PI);curve.push(p.map(v=>v/length*lift));}paths.push(curve);
      }
    }
  }
  function text(){
    if(!data)return;$('#globe-share').checked=data.enabled;
    $('#globe-location').textContent=data.viewerCountry?'Your connection: '+label(data.viewerCountry):'Your country is unavailable (for example, a local network).';
    $('#globe-count').textContent=data.sharingOnline+' members sharing · '+data.countries.length+' countries';
    $('#globe-summary').textContent=data.sharingOnline===0?'No members are sharing a country yet.':!data.viewerCountry?'Country markers are live. Your location is unavailable, so no connection arcs are drawn.':'Live, approximate connections · refreshed every 25 seconds';
    const list=$('#globe-countries');list.replaceChildren();for(const c of data.countries){const row=document.createElement('div');row.textContent=label(c.country)+' · '+c.count;list.append(row);}
  }
  async function refresh(input={active:!document.hidden}){
    if(!owner||busy)return;busy=true;const current=epoch;
    try{const result=await api('/api/globe',input);if(current!==epoch)return;data=result;text();rebuild();$('#globe-status').textContent='';draw();}
    catch(error){if(current===epoch){data=null;paths=[];$('#globe-location').textContent='';$('#globe-status').textContent='Live location data unavailable. Please try again.';$('#globe-summary').textContent='Live connections unavailable';$('#globe-countries').replaceChildren();$('#globe-count').textContent='';draw();}}
    finally{busy=false;}
  }
  async function loadMap(){if(loaded)return;loaded=true;try{const response=await fetch('/world-map.json');if(!response.ok)throw Error();const result=await response.json();map=result.countries.map(c=>({...c,lines:c.rings.map(r=>r.map(([lon,lat])=>spherePoint(lat,lon)))}));countries=new Map(map.map(c=>[c.code,c]));text();rebuild();draw();}catch{loaded=false;$('#globe-status').textContent='The globe map could not be loaded.';}}
  function projection(p,cx,cy,r){const c=Math.cos(angle),s=Math.sin(angle),x=p[0]*c+p[2]*s,z=p[2]*c-p[0]*s,tilt=.15,y=p[1]*Math.cos(tilt)-z*Math.sin(tilt),depth=p[1]*Math.sin(tilt)+z*Math.cos(tilt);return [cx+x*r,cy-y*r,depth];}
  function render(canvas,time){
    const rect=canvas.getBoundingClientRect();if(rect.width<1||rect.height<1)return;const dpr=Math.min(devicePixelRatio||1,2),w=rect.width,h=rect.height;
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    const r=Math.min(w,h)*.37,cx=w/2,cy=h/2;const gradient=ctx.createRadialGradient(cx-r*.4,cy-r*.3,0,cx,cy,r);gradient.addColorStop(0,'rgba(40,128,166,.09)');gradient.addColorStop(.8,'rgba(8,35,53,.13)');gradient.addColorStop(1,'rgba(52,190,221,.15)');ctx.fillStyle=gradient;ctx.strokeStyle='#64daff55';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,r,0,TAU);ctx.fill();ctx.stroke();
    function line(points,color,width=1){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();let drawing=false;for(const p of points){const [x,y,z]=projection(p,cx,cy,r);if(z<0){drawing=false;continue;}if(drawing)ctx.lineTo(x,y);else ctx.moveTo(x,y);drawing=true;}ctx.stroke();}
    for(let lat=-60;lat<=60;lat+=30){const points=[];for(let lon=-180;lon<=180;lon+=4)points.push(spherePoint(lat,lon));line(points,'#4bbad521',.65);}
    for(let lon=-180;lon<180;lon+=30){const points=[];for(let lat=-90;lat<=90;lat+=4)points.push(spherePoint(lat,lon));line(points,'#4bbad521',.65);}
    for(const country of map)for(const ring of country.lines)line(ring,'#63cbe768',.8);
    paths.forEach((path,i)=>{line(path,i%3===0?'#f05f7b80':'#56d7ef80',canvas===mini ? .85 : 1.2);if(paused||reduced.matches||path.length<3)return;const p=path[Math.floor(((time*.00016+i*.137)%1)*(path.length-1))],v=projection(p,cx,cy,r);if(v[2]<0)return;ctx.fillStyle=i%3===0?'#ff8297':'#8deaff';ctx.beginPath();ctx.arc(v[0],v[1],canvas===mini?1.3:2,0,TAU);ctx.fill();});
    const markers=new Set((data?.countries||[]).map(c=>c.country));if(data?.viewerCountry)markers.add(data.viewerCountry);
    for(const code of markers){const p=point(code);if(!p)continue;const [x,y,z]=projection(p,cx,cy,r);if(z<0)continue;const mine=code===data?.viewerCountry;ctx.fillStyle=mine?'#ff7993':'#70e1f4';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=8;ctx.beginPath();ctx.arc(x,y,canvas===mini?2.5:4,0,TAU);ctx.fill();ctx.shadowBlur=0;
      if(canvas===large){ctx.font='11px system-ui';ctx.fillText(mine?'You · '+label(code):label(code),x+8,y-8);}
    }
  }
  function draw(time=performance.now()){if(!document.hidden){if(dialog.open)render(large,time);else if(miniVisible)render(mini,time);}}
  function loop(time){frame=0;if(document.hidden||(!miniVisible&&!dialog.open)||paused||reduced.matches){last=0;draw(time);return;}if(last){angle+=Math.min(time-last,60)*.000035;}last=time;draw(time);frame=requestAnimationFrame(loop);}
  function wake(){if(!frame){last=0;frame=requestAnimationFrame(loop);}}
  new IntersectionObserver(entries=>{miniVisible=entries[0].isIntersecting;if(miniVisible){loadMap();wake();}}).observe(trigger);
  new ResizeObserver(()=>{draw();wake();}).observe(large);new ResizeObserver(()=>{draw();wake();}).observe(mini);
  trigger.addEventListener('click',()=>{const from=trigger.getBoundingClientRect();dialog.showModal();loadMap();refresh();draw();wake();if(!reduced.matches)dialog.animate([{opacity:0,transform:`translate(${from.x+from.width/2-innerWidth/2}px,${from.y+from.height/2-innerHeight/2}px) scale(.16)`},{opacity:1,transform:'translate(0,0) scale(1)'}],{duration:520,easing:'cubic-bezier(.2,.8,.2,1)'});});
  $('#globe-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{trigger.focus({preventScroll:true});wake();});
  $('#globe-share').addEventListener('change',async()=>{const checkbox=$('#globe-share');if(busy){checkbox.checked=!!data?.enabled;return;}checkbox.disabled=true;await refresh({enabled:checkbox.checked,active:!document.hidden});checkbox.disabled=false;});
  function motion(){paused=paused||reduced.matches;$('#globe-motion').textContent=paused?'Resume rotation':'Pause rotation';$('#globe-motion').setAttribute('aria-pressed',String(paused));wake();}
  $('#globe-motion').addEventListener('click',()=>{paused=!paused;motion();});reduced.addEventListener('change',()=>{paused=reduced.matches;motion();});motion();
  document.addEventListener('visibilitychange',()=>{refresh();wake();});setInterval(()=>{if(!document.hidden)refresh();},25000);
  function setAccount(account){const next=account?.address||null;if(next===owner)return;owner=next;epoch++;data=null;paths=[];dialog.close();$('#globe-countries').replaceChildren();$('#globe-count').textContent='';$('#globe-location').textContent='';$('#globe-share').checked=false;draw();if(next){loadMap();refresh();}}
  return {setAccount,show(){loadMap();refresh();wake();},clear(){setAccount(null);}};
}
