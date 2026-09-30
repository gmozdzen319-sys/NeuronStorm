export function startNeuronBackground(){
  const canvas=document.querySelector('#neuron-background'),ctx=canvas.getContext('2d');
  if(!ctx)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');let timer,frame,width,height;
  function resize(){width=innerWidth;height=innerHeight;const ratio=Math.min(devicePixelRatio||1,2);canvas.width=width*ratio;canvas.height=height*ratio;ctx.setTransform(ratio,0,0,ratio,0,0);}
  function stop(){canvas.dataset.phase='idle';clearTimeout(timer);cancelAnimationFrame(frame);ctx.clearRect(0,0,width,height);}
  function schedule(delay=22000+Math.random()*14000){if(!document.hidden&&!reduced.matches)timer=setTimeout(pulse,delay);}
  function pulse(){
    const x=width*.04,y=height*(.2+Math.random()*.5),scale=Math.min(width/650,1);
    const points=[[0,0],[95,-80],[175,15],[75,115],[245,-65],[280,120],[-55,80]].map(([a,b])=>[x+a*scale,y+b*scale]);
    const edges=[[0,1],[0,2],[0,3],[0,6],[1,4],[2,4],[2,5],[3,5]];const start=performance.now();
    function draw(now){
      const t=(now-start)/6500;ctx.clearRect(0,0,width,height);if(t>=1){canvas.dataset.phase='idle';schedule();return;}canvas.dataset.phase=t>.35?'connected':'connecting';
      const fade=Math.sin(Math.PI*t)*.32;
      edges.forEach(([a,b],i)=>{const progress=Math.max(0,Math.min(1,(t-.08-i*.035)*3));if(!progress)return;const [ax,ay]=points[a],[bx,by]=points[b],color=i%2?'255,65,95':'45,191,255';ctx.strokeStyle=`rgba(${color},${fade})`;ctx.shadowColor=`rgba(${color},.5)`;ctx.shadowBlur=9;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax+(bx-ax)*progress,ay+(by-ay)*progress);ctx.stroke();});
      points.forEach(([px,py],i)=>{const color=i%2?'255,65,95':'45,191,255';ctx.fillStyle=`rgba(${color},${fade*1.7})`;ctx.shadowColor=`rgba(${color},.8)`;ctx.shadowBlur=15;ctx.beginPath();ctx.arc(px,py,2.6+Math.sin(t*7+i)*.6,0,Math.PI*2);ctx.fill();
        for(let branch=0;branch<3;branch++){const angle=i+branch*2.1;ctx.strokeStyle=`rgba(${color},${fade*.7})`;ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+Math.cos(angle)*14,py+Math.sin(angle)*14);ctx.stroke();}});
      frame=requestAnimationFrame(draw);
    }
    frame=requestAnimationFrame(draw);
  }
  function reset(){stop();if(!reduced.matches&&!document.hidden)schedule(2500);}
  resize();schedule(2500);window.addEventListener('resize',()=>{resize();});document.addEventListener('visibilitychange',reset);reduced.addEventListener('change',reset);
}
