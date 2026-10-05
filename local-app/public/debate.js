export function createDebate(api,onExpired,getAccount=()=>null,onMessage=()=>{}){
  const $=s=>document.querySelector(s),panel=$('#debate-panel'),list=$('#debate-messages');
  new ResizeObserver(entries=>document.documentElement.style.setProperty('--header-height',entries[0].target.getBoundingClientRect().height+'px')).observe(document.querySelector('header'));
  let initialized=false,muted=false;const muteKey=()=>'ns-debate-muted:'+getAccount()?.address.toLowerCase()+':'+id;const muteButton=$('#debate-mute');function renderMute(){muteButton.textContent=muted?'Unmute this debate':'Mute this debate';muteButton.setAttribute('aria-pressed',String(muted));}muteButton.onclick=()=>{if(!id)return;muted=!muted;try{if(muted)localStorage.setItem(muteKey(),'true');else localStorage.removeItem(muteKey());}catch{}renderMute();};
  let id=null,generation=0,busy=false,posting=false,latest=0,earliest=0,pending=null;
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  function stop(){initialized=false;id=null;generation++;latest=0;earliest=0;pending=null;list.replaceChildren();$('#debate-online').textContent='';$('#debate-status').textContent='';$('#debate-form').reset();panel.hidden=true;}
  function votes(article,message){
 const signature=JSON.stringify([message.upvotes,message.downvotes,message.myVote,message.mine]);let bar=article.querySelector('.debate-votes');if(bar?.dataset.signature===signature)return;if(!bar){bar=node('div','');bar.className='debate-votes';article.append(bar);}bar.dataset.signature=signature;bar.replaceChildren();
 for(const [value,label,count] of [[1,'Helpful',message.upvotes],[-1,'Not Helpful',message.downvotes]]){const b=node('button',(value===1?'👍 ':'👎 ')+(count||0));b.type='button';b.className='text-button';b.setAttribute('aria-label',label);b.setAttribute('aria-pressed',String(message.myVote===value));b.disabled=!!message.mine;
 b.onclick=async()=>{b.disabled=true;const current=generation,q=id;try{await api('/api/questions/'+q+'/debate/'+message.id+'/vote',{value:message.myVote===value?0:value});if(current===generation){const result=await api('/api/questions/'+q+'/debate?before='+(message.id+1));if(current===generation)render(result,true);}}catch(error){await failure(error,current);}finally{b.disabled=!!message.mine;}};bar.append(b);}
 }
 function render(result,older=false){
    $('#debate-form').hidden=result.canPost===false;for(const m of result.ratings||[]){const a=list.querySelector(`[data-message-id="${m.id}"]`);if(a)votes(a,m);}
    const bottom=list.scrollHeight-list.scrollTop-list.clientHeight<60,height=list.scrollHeight;
    const fragment=document.createDocumentFragment();
    for(const message of result.messages){const existing=list.querySelector(`[data-message-id="${message.id}"]`);if(existing){votes(existing,message);continue;}const article=node('article','');article.dataset.messageId=message.id;article.className='debate-message'+(message.mine?' mine':'');const time=new Intl.DateTimeFormat('en-GB',{dateStyle:'short',timeStyle:'short'}).format(new Date(message.createdAt));article.append(node('strong',message.mine?'You':message.author),node('p',message.body),node('small',time));votes(article,message);fragment.append(article);latest=Math.max(latest,message.id);earliest=earliest?Math.min(earliest,message.id):message.id;}
    if(older)list.prepend(fragment);else list.append(fragment);
    if(older)list.scrollTop+=list.scrollHeight-height;else if(bottom)list.scrollTop=list.scrollHeight;
    $('#debate-online').textContent=result.online.length?`${result.online.length} online · ${result.online.join(', ')}`:'No one else is here yet.';
    if(older||!$('#debate-earlier').dataset.loaded){$('#debate-earlier').hidden=!result.hasEarlier;$('#debate-earlier').dataset.loaded='1';}
  }
  async function failure(error,current){if(current!==generation)return;$('#debate-status').textContent=error.message;if([401,403,404].includes(error.httpStatus)){stop();if(error.httpStatus===401)await onExpired();}}
  async function refresh(older=false){
    if(!id||busy||document.hidden)return;busy=true;const current=generation,q=id;
    try{const ids=[...list.querySelectorAll('[data-message-id]')].slice(-200).map(n=>n.dataset.messageId).join(',');const query=(older?`before=${earliest}`:`presence=1${latest?'&after='+latest:''}`)+'&ratings='+ids;const result=await api('/api/questions/'+q+'/debate?'+query);if(current!==generation)return;if(!older&&initialized&&!muted&&result.messages.some(m=>!m.mine&&m.id>latest))onMessage();render(result,older);initialized=true;$('#debate-status').textContent='';}
    catch(error){await failure(error,current);}finally{busy=false;}
  }
  $('#debate-earlier').addEventListener('click',()=>refresh(true));
  $('#debate-form').addEventListener('submit',async event=>{
    event.preventDefault();if(!id||posting)return;const body=$('#debate-body').value.trim();if(!body)return;const current=generation,q=id;
    if(!pending||pending.body!==body)pending={body,clientId:crypto.randomUUID()};posting=true;$('#debate-send').disabled=true;
    try{await api('/api/questions/'+q+'/debate',pending);if(current!==generation)return;pending=null;$('#debate-body').value='';await refresh();}
    catch(error){await failure(error,current);}finally{posting=false;$('#debate-send').disabled=false;}
  });
  setInterval(()=>refresh(),2000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  return {stop,start(question){if(id===question)return;stop();id=question;try{muted=localStorage.getItem(muteKey())==='true';}catch{muted=false;}renderMute();panel.hidden=false;delete $('#debate-earlier').dataset.loaded;$('#debate-earlier').hidden=true;refresh();}};
}
