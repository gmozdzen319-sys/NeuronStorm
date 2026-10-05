export function startNeuronBackground(){
  const canvas=document.querySelector('#neuron-background'),ctx=canvas?.getContext('2d');
  if(!ctx)return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let width=0,height=0,frame=0,last=0,time=0,points=[],edges=[];
  function resize(){
    width=innerWidth;height=innerHeight;
    const ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
    const cols=width<600?10:19,rows=8;points=[];edges=[];
    for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
      const index=points.length;
      points.push({u:col/(cols-1),v:row/(rows-1),phase:Math.sin(index*17.3)*Math.PI,depth:.4+.6*(.5+.5*Math.sin(index*7.9))});
      if(col)edges.push([index-1,index]);if(row)edges.push([index-cols,index]);if(row&&col&&(row+col)%2===0)edges.push([index-cols-1,index]);
    }
    draw();
  }
  function draw(){
    ctx.clearRect(0,0,width,height);
    const positions=points.map(p=>({x:p.u*width+Math.sin(p.phase*5)*width*.018+Math.sin(time*.09+p.phase)*9,y:(p.v+.11*Math.sin(p.u*6+time*.035+p.v*2)+Math.sin(p.phase*3)*.035)*height+Math.cos(time*.07+p.phase)*6}));
    const glow=Math.pow(.5+.5*Math.sin(time*Math.PI/32),8);
    edges.forEach(([a,b])=>{
      const p=points[a],start=positions[a],end=positions[b];
      const center=Math.abs(p.u-.5)*2;
      const red=Math.round(255+(45-255)*p.u),green=Math.round(65+(191-65)*p.u),blue=Math.round(95+(255-95)*p.u);
      ctx.strokeStyle=`rgba(${red},${green},${blue},${(.035+.085*center)*(1+glow*.4)*p.depth})`;
      ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(start.x,start.y);ctx.lineTo(end.x,end.y);ctx.stroke();
    });
    points.forEach((p,i)=>{
      const {x,y}=positions[i],color=p.u<.45?'255,100,112':'55,198,255',alpha=(.09+.14*Math.abs(p.u-.5)*2)*p.depth;
      ctx.fillStyle=`rgba(${color},${alpha+glow*.09})`;ctx.beginPath();ctx.arc(x,y,1+p.depth,0,Math.PI*2);ctx.fill();
      if(i%13===0){const halo=ctx.createRadialGradient(x,y,0,x,y,13);halo.addColorStop(0,`rgba(${color},${.07+glow*.05})`);halo.addColorStop(1,`rgba(${color},0)`);ctx.fillStyle=halo;ctx.fillRect(x-13,y-13,26,26);}
    });
  }
  function tick(now){
    if(document.hidden||reduced.matches){frame=0;return;}
    if(now-last>=1000/30){time+=Math.min((now-last)/1000,.1);last=now;draw();}
    frame=requestAnimationFrame(tick);
  }
  function reset(){cancelAnimationFrame(frame);frame=0;last=performance.now();draw();if(!document.hidden&&!reduced.matches)frame=requestAnimationFrame(tick);}
  resize();reset();window.addEventListener('resize',resize);document.addEventListener('visibilitychange',reset);reduced.addEventListener('change',reset);
}
