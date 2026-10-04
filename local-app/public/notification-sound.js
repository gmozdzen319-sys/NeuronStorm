// Monotonic per-account event counts do not replay on read, pagination or restore.
export function advanceSequence(previous,next){
  if(!Number.isSafeInteger(next)||next<0)return {sequence:previous,count:0};
  return {sequence:Math.max(previous??0,next),count:previous===null?0:Math.max(0,next-previous)};
}
export function createNotificationSound(button){
  let owner=null,sequence=null,context=null,muted=false;
  try{muted=localStorage.getItem('ns-notification-muted')==='true';}catch{}
  function render(){button.textContent=muted?'🔇':'🔊';button.setAttribute('aria-pressed',String(muted));button.title=muted?'Unmute notification sounds':'Mute notification sounds';button.setAttribute('aria-label',button.title);}
  function unlock(){
    if(muted)return;
    try{context??=new (window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')context.resume().catch(()=>{});}catch{}
  }
  document.addEventListener('pointerdown',unlock,{passive:true});document.addEventListener('keydown',unlock);
  function play(count){
    if(muted||context?.state!=='running')return;
    // Short, quiet two-note chime. A large backlog is grouped, not played endlessly.
    for(let n=0;n<Math.min(count,3);n++)for(const [offset,hz] of [[0,660],[.1,880]]){
      const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+n*.4+offset;
      oscillator.type='sine';oscillator.frequency.value=hz;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.045,start+.015);gain.gain.exponentialRampToValueAtTime(.0001,start+.2);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start);oscillator.stop(start+.21);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
    }
  }
  button.addEventListener('click',()=>{muted=!muted;try{localStorage.setItem('ns-notification-muted',String(muted));}catch{}render();if(muted)context?.suspend().catch(()=>{});else unlock();});
  window.addEventListener('storage',event=>{if(event.key==='ns-notification-muted'){muted=event.newValue==='true';render();if(muted)context?.suspend().catch(()=>{});}});
  render();
  return {notify(){if(owner)play(1);},setAccount(account){const next=account?.address.toLowerCase()||null;if(next!==owner){owner=next;sequence=null;}button.hidden=!owner;},update(next){if(!owner)return;const result=advanceSequence(sequence,next);sequence=result.sequence;play(result.count);}};
}
