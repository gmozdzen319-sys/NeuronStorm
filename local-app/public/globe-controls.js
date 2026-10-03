export const clampZoom=value=>Math.max(.65,Math.min(3,value));
export function bindGlobeGestures(canvas,{rotate,zoom,interact,reset}){
  const pointers=new Map();
  const distance=()=>{const [a,b]=[...pointers.values()];return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;};
  canvas.addEventListener('pointerdown',event=>{
    if(event.pointerType==='mouse'&&event.button!==0)return;
    event.preventDefault();canvas.focus({preventScroll:true});
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');interact();
  });
  canvas.addEventListener('pointermove',event=>{
    const old=pointers.get(event.pointerId);if(!old)return;
    event.preventDefault();const before=distance();
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===1)rotate((event.clientX-old.x)*.008,(event.clientY-old.y)*.008);
    else if(pointers.size===2&&before>1){const after=distance();if(after>1)zoom(after/before);}
  });
  const end=event=>{pointers.delete(event.pointerId);if(!pointers.size)canvas.classList.remove('dragging');};
  for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,end);
  canvas.addEventListener('wheel',event=>{
    event.preventDefault();interact();const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.clientHeight:1);
    zoom(Math.exp(-Math.max(-300,Math.min(300,pixels))*.002));
  },{passive:false});
  canvas.addEventListener('keydown',event=>{
    const moves={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,-.12],ArrowDown:[0,.12]};
    if(moves[event.key]){event.preventDefault();interact();rotate(...moves[event.key]);}
    else if(['+','=','-','0','Home'].includes(event.key)){event.preventDefault();interact();if(event.key==='0'||event.key==='Home')reset();else zoom(event.key==='-'?1/1.2:1.2);}
  });
  return ()=>{for(const id of pointers.keys())if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);pointers.clear();canvas.classList.remove('dragging');};
}
