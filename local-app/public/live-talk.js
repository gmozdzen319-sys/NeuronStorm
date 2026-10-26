// Live audio only. No MediaRecorder, audio upload, transcription or replay.
export async function requestLiveMicrophone(mediaDevices=globalThis.navigator?.mediaDevices){
 if(!mediaDevices?.getUserMedia)throw Error('Microphone access is unavailable. Open Neuron Storm in a supported browser over HTTPS.');
 let stream;
 try{stream=await mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});}
 catch(e){throw Error(e.name==='NotAllowedError'?'Allow microphone access in your browser settings, then tap Join again.':e.name==='NotFoundError'?'No microphone was found on this device.':'Cannot access the microphone. Close other apps using it, then tap Join again.');}
 finally{stream?.getTracks().forEach(track=>track.stop());}
 // Permission only: never publish or keep the microphone open while listening.
}
export function createLiveTalkUI(api){
 const panel=document.createElement('section');panel.className='live-talk';panel.setAttribute('aria-label','Live Talk');
 const el=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
 const heading=el('div'),title=el('strong','🎙 Live Talk'),clock=el('span');heading.className='live-talk-heading';heading.append(title,clock);
 const status=el('p','Join to listen. One person speaks at a time.'),buttons=el('div'),queue=el('p'),rating=el('div'),select=document.createElement('select');
 status.setAttribute('role','status');buttons.className='live-talk-buttons';queue.className='field-hint';rating.className='live-talk-rating';select.setAttribute('aria-label','Topic for your live contribution');
 const audio=document.createElement('div');audio.hidden=true;
 const button=(label,handler)=>{const b=el('button',label);b.type='button';b.className='login';b.onclick=handler;buttons.append(b);return b;};
 let id=null,epoch=0,room=null,data=null,offset=0,pending=false,polling=false,error='',tracks=new Map(),mic=false,wantSpeak=false,micStarting=false;
 const now=()=>Date.now()+offset;
 const currentTurn=()=>data?.turns.find(t=>t.endedAt===null&&t.endsAt>now());
 const time=ms=>`${String(Math.floor(Math.max(0,ms)/60000)).padStart(2,'0')}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
 const join=button('Join',()=>act(async()=>{
  const q=id,g=epoch;await requestLiveMicrophone();if(g!==epoch)return;
  const sdk=await import('./livekit-client.js');
  if(g!==epoch)return;
  const result=await api(`/api/questions/${q}/live-talk`,{action:'join'});
  if(g!==epoch){api(`/api/questions/${q}/live-talk`,{action:'leave'}).catch(()=>{});return;}
  apply(result);const r=new sdk.Room({adaptiveStream:false,dynacast:true,publishDefaults:{audioPreset:{maxBitrate:24000},dtx:true,red:false},audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});room=r;
  r.on(sdk.RoomEvent.TrackSubscribed,(track,publication,participant)=>{if(track.kind==='audio'){tracks.set(publication.trackSid,{track,identity:participant.identity});syncAudio();void refresh();}});
  r.on(sdk.RoomEvent.TrackUnsubscribed,(track,publication)=>{track.detach().forEach(e=>e.remove());tracks.delete(publication.trackSid);});
  r.on(sdk.RoomEvent.Disconnected,()=>{if(room===r){disconnect();error='Audio disconnected. You can rejoin if time remains.';api(`/api/questions/${q}/live-talk`,{action:'leave'}).catch(()=>{});render();}});
  r.on(sdk.RoomEvent.ParticipantPermissionsChanged,()=>{render();void refresh();});
  r.on(sdk.RoomEvent.AudioPlaybackStatusChanged,()=>render());
  try{await r.connect(result.url,result.token,{autoSubscribe:true});if(g!==epoch){await r.disconnect();return;}await r.startAudio();}
  catch(e){disconnect();api(`/api/questions/${q}/live-talk`,{action:'leave'}).catch(()=>{});throw e;}
 }));
 const speak=button('Speak',()=>act(async()=>{wantSpeak=true;try{await action('speak',{fieldId:Number(select.value)});await startSpeaking();}catch(e){wantSpeak=false;throw e;}}));
 const end=button('Stop speaking',()=>act(async()=>{wantSpeak=false;if(room)await room.localParticipant.setMicrophoneEnabled(false);mic=false;await action('finish');}));
 async function startSpeaking(){
  if(!wantSpeak||mic||micStarting||!currentTurn()?.mine||!room?.localParticipant.permissions?.canPublish)return;
  const r=room,g=epoch;micStarting=true;
  try{await r.localParticipant.setMicrophoneEnabled(true);if(g!==epoch||room!==r||!wantSpeak||!currentTurn()?.mine){await r.localParticipant.setMicrophoneEnabled(false);return;}mic=true;await action('microphone');}
  catch(e){wantSpeak=false;mic=false;await r.localParticipant.setMicrophoneEnabled(false).catch(()=>{});if(g===epoch){error=e.message;await action('finish').catch(()=>{});}}
  finally{micStarting=false;render();}
 }
 const resume=button('Enable sound',()=>act(async()=>{await room?.startAudio();for(const a of audio.querySelectorAll('audio'))await a.play();}));
 const leave=button('Leave',()=>act(async()=>{const q=id;disconnect();await api(`/api/questions/${q}/live-talk`,{action:'leave'});await refresh();}));
 panel.append(heading,status,select,buttons,queue,rating,audio);
 document.querySelector('#debate-mute').before(panel);
 async function action(action,extra={}){const g=epoch,result=await api(`/api/questions/${id}/live-talk`,{action,...extra});if(g===epoch)apply(result);}
 async function act(fn){if(pending||!id)return;pending=true;error='';render();try{await fn();}catch(e){error=e.message||'Audio is temporarily unavailable. Please use the text debate.';}finally{pending=false;render();}}
 function disconnect(){const r=room;room=null;mic=false;wantSpeak=false;for(const {track} of tracks.values())track.detach().forEach(e=>e.remove());tracks.clear();audio.replaceChildren();if(r)r.disconnect();}
 function apply(result){if(result.paused)error='';data=result;offset=result.now-Date.now();const value=select.value,signature=JSON.stringify(result.fields);if(select.dataset.fields!==signature){select.replaceChildren(...result.fields.map(f=>new Option(f.name,f.id)));if(result.fields.some(f=>String(f.id)===value))select.value=value;select.dataset.fields=signature;}render();}
 function syncAudio(){
  const speaker=currentTurn()?.identity;
  for(const {track,identity} of tracks.values()){
   if(identity!==speaker){track.detach().forEach(e=>e.remove());continue;}
   if(!track.attachedElements.length){const a=track.attach();a.autoplay=true;audio.append(a);}
  }
 }
 function render(){
  panel.hidden=!id;if(!id)return;
  const turn=currentTurn(),connected=!!room;
  if((data?.finished||data?.paused||data?.endsAt&&now()>=data.endsAt)&&room)disconnect();
  if(mic&&!turn?.mine){mic=false;room?.localParticipant.setMicrophoneEnabled(false).catch(()=>{});}
  clock.textContent='Talk remaining '+time((data?.remainingMs??600000)-(data?.speaking?Math.max(0,Math.min(now(),data.speakingUntil)-data.now):0));
  status.textContent=error||(data?.finished?'Live Talk has ended. Continue in the text debate.':!data?.enabled?'Live Talk is not available yet.':data?.paused?'Paused · tap Join to continue.':turn?`${turn.nickname} · ${turn.topic||'Follow-up'} · ${time(turn.endsAt-now())}${turn.mine&&!mic?' · Tap Enable mic to speak.':''}`:connected?'Listening · raise your hand to speak.':'Join and allow microphone access. One person speaks at a time.');
  join.hidden=connected;join.disabled=pending||!data?.enabled||data?.finished||data?.participants>=10;
  for(const b of [speak,end,resume,leave]){b.hidden=!connected;b.disabled=pending;}
  speak.hidden=!connected||!!turn?.mine;speak.disabled=pending||!data?.canSpeak||!!turn;
  end.hidden=!connected||!turn?.mine;resume.hidden=!connected||room?.canPlaybackAudio===true;
  select.hidden=!connected||data?.fields.length<2;select.disabled=!!turn?.mine||pending;
  queue.textContent=connected?`${data?.participants||0}/10 connected`:'';
  const rated=turn||data?.turns[0],signature=JSON.stringify(rated&&[rated.id,rated.upvotes,rated.downvotes,rated.myVote,rated.canVote]);
  if(rating.dataset.signature!==signature){rating.dataset.signature=signature;rating.replaceChildren();if(rated){rating.append(el('span',turn?'Rate this contribution: ':'Last: '+rated.nickname+' '));for(const [value,label,count] of [[1,'👍',rated.upvotes],[-1,'👎',rated.downvotes]]){const b=el('button',`${label} ${count}`);b.type='button';b.className='text-button';b.disabled=!rated.canVote;b.setAttribute('aria-label',value===1?'Helpful live contribution':'Not helpful live contribution');b.setAttribute('aria-pressed',String(rated.myVote===value));b.onclick=()=>act(async()=>{await api(`/api/questions/${id}/debate/${rated.messageId}/vote`,{value:rated.myVote===value?0:value});await refresh();});rating.append(b);}}}
  syncAudio();
  if(wantSpeak&&!micStarting&&!mic)void startSpeaking();
 }
 async function refresh(){if(!id||polling)return;polling=true;const q=id,g=epoch;try{const result=await api(`/api/questions/${q}/live-talk`,room?{action:'heartbeat'}:undefined);if(g===epoch)apply(result);}catch(e){if(g===epoch){error=e.message;if([401,403,404,409].includes(e.httpStatus))disconnect();render();}}finally{polling=false;}}
 const poll=setInterval(()=>{if(id&&(room||!document.hidden))refresh();},5000),ticker=setInterval(()=>{if(id)render();},500);
 function stop(){const q=id,was=!!room;epoch++;id=null;disconnect();data=null;error='';render();if(q&&was)api(`/api/questions/${q}/live-talk`,{action:'leave'}).catch(()=>{});}
 return {start(q){if(q===id)return;stop();id=q;render();refresh();},stop};
}
