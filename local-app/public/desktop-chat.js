import {memberProfileButton,closePublicProfile} from './file-ui.js';
export function setupDesktopChat(){
 if(!window.nsDesktopChat)return;
 const menu=document.querySelector('#member-menu-links'),button=document.createElement('button');
 button.type='button';button.textContent='Chat';menu.insertBefore(button,menu.querySelector('a'));
 const dialog=document.createElement('dialog');dialog.className='member-profile-dialog desktop-chat';
 dialog.setAttribute('aria-labelledby','desktop-chat-title');
 dialog.innerHTML='<header><h2 id="desktop-chat-title">Desktop Chat</h2><button type="button" aria-label="Close chat">Close ×</button></header><div class="chat-feed" aria-label="Messages"></div><form><label for="chat-text">Your message</label><textarea id="chat-text" maxlength="1000" required rows="2"></textarea><button class="primary" type="submit">Send</button></form><small role="status"></small>';
 document.body.append(dialog);
 const feed=dialog.querySelector('.chat-feed'),form=dialog.querySelector('form'),input=form.querySelector('textarea'),status=dialog.querySelector('small');
 const invoke=(action,args={})=>window.__TAURI_INTERNALS__.invoke('desktop_chat',{action,...args});
 let generation=0,timer,draftId,loading=false,last='',sending=false;
 const entries=new Map();
 function clear(){generation++;clearTimeout(timer);entries.clear();feed.replaceChildren();status.textContent='';input.value='';last='';draftId=null;loading=false;sending=false;form.querySelector('button').disabled=false;}
 dialog.onclose=clear;
 window.addEventListener('ns-desktop-session-changed',()=>{if(dialog.open){closePublicProfile();dialog.close();}clear();});
 async function refresh(rev){
  if(rev!==generation||!dialog.open||loading)return;
  clearTimeout(timer);loading=true;
  try{
   const {messages}=await invoke('read');
   if(rev!==generation||!dialog.open)return;
   const stick=!last||feed.scrollHeight-feed.scrollTop-feed.clientHeight<48;
   const ids=new Set(messages.map(m=>String(m.id)));
   for(const [key,row] of entries)if(!ids.has(key)){row.remove();entries.delete(key);}
   for(const m of messages){
    const key=String(m.id),signature=JSON.stringify([m.nickname,m.avatar?.id]);
    let row=entries.get(key);
    if(row?.dataset.signature===signature)continue;
    const next=document.createElement('article'),body=document.createElement('p'),time=document.createElement('time');
    next.dataset.signature=signature;body.textContent=m.body;time.textContent=new Date(Number(m.createdAt)).toLocaleString();
    next.append(memberProfileButton(m.nickname,m.avatar,null,'desktop-chat',key),time,body);
    if(row)row.replaceWith(next);else feed.append(next);entries.set(key,next);
   }
   last=messages.length?String(messages.at(-1).id):'';
   if(stick)feed.scrollTop=feed.scrollHeight;
   if(!sending && !draftId)status.textContent=messages.length?'':'No messages yet.';
  }catch(e){if(rev===generation)status.textContent=String(e);}
  finally{if(rev===generation&&dialog.open){loading=false;timer=setTimeout(()=>refresh(rev),3000);}}
 }
 button.onclick=()=>{if(dialog.open)return;clear();if(document.querySelector('#member-menu-toggle').getAttribute('aria-expanded')==='true')document.querySelector('#member-menu-toggle').click();dialog.showModal();refresh(generation);};
 dialog.querySelector('header button').onclick=()=>dialog.close();
 input.oninput=()=>{draftId=null;};
 form.onsubmit=async e=>{
  e.preventDefault();const text=input.value.trim(),rev=generation;if(!text||sending)return;
  sending=true;form.querySelector('button').disabled=true;draftId??=crypto.randomUUID();
  try{await invoke('send',{text,requestId:draftId});if(rev===generation){if(input.value.trim()===text)input.value='';draftId=null;status.textContent='';await refresh(rev);}}
  catch(error){if(rev===generation)status.textContent=String(error);}
  finally{if(rev===generation){sending=false;form.querySelector('button').disabled=false;}}
 };
}
