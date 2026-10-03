export function countdown(expiresAt,now){
  const seconds=Math.max(0,Math.ceil((expiresAt-now)/1000)),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60),remaining=seconds%60;
  return {text:seconds?`${days}d ${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(remaining).padStart(2,'0')} left`:'Time ended · closing',tone:seconds<=21600?'critical':seconds<=86400?'urgent':seconds<=259200?'warning':'healthy'};
}
export function createLifecycleUI({api,signedSend,getAccount,onClosed}){
  const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  let offset=0,selection=null,busy=false,page=1,pages=1,request=0,acceptedSignature='';
  function paint(clock){const value=countdown(Number(clock.dataset.deadline),Date.now()+offset);clock.textContent='◷ '+value.text;clock.className='question-clock clock-'+value.tone;clock.setAttribute('aria-label','Question deadline: '+value.text);}
  function tick(){for(const clock of document.querySelectorAll('[data-deadline]'))paint(clock);}
  function sync(time){if(Number.isFinite(time)){offset=time-Date.now();tick();}}
  function clock(node,expiresAt){node.hidden=!Number.isFinite(expiresAt);if(node.hidden){delete node.dataset.deadline;return;}node.dataset.deadline=expiresAt;node.title='Closes '+new Date(expiresAt).toLocaleString('en-GB');paint(node);}
  setInterval(()=>{if(!document.hidden)tick();},1000);
  function decorate(article,reply,thread){
    let button=article.querySelector('.accept-answer');
    if(!thread.canAccept||!reply.canVote||thread.deletedAt!==null){button?.remove();return;}
    if(!button){button=el('button','✓ Best answer · Accept');button.type='button';button.className='accept-answer';article.querySelector('.answer-actions').append(button);
      button.addEventListener('click',()=>{if(busy)return;selection={questionId:thread.id,replyId:reply.id,version:Number(button.dataset.version),owner:getAccount()?.address};$('#accept-preview').textContent=article.querySelector('.message-body').textContent;$('#accept-status').textContent='';$('#accept-dialog').showModal();});}
    button.dataset.version=reply.version;button.disabled=Date.now()+offset>=thread.expiresAt;
  }
  $('#accept-cancel').addEventListener('click',()=>{if(!busy)$('#accept-dialog').close();});
  $('#accept-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#accept-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!selection)return;const chosen={...selection};busy=true;$('#accept-submit').disabled=true;$('#accept-cancel').disabled=true;
    try{await signedSend('/api/questions/'+chosen.questionId+'/accept',{replyId:chosen.replyId,version:chosen.version},text=>{if(getAccount()?.address===chosen.owner)$('#accept-status').textContent=text;});if(getAccount()?.address===chosen.owner){$('#accept-dialog').close();selection=null;await onClosed();}}
    catch(error){if(getAccount()?.address===chosen.owner)$('#accept-status').textContent=error.message;}
    finally{busy=false;$('#accept-submit').disabled=false;$('#accept-cancel').disabled=false;}
  });
  async function loadAccepted(){
    if(getAccount()?.role!=='admin')return;const owner=getAccount().address,current=++request;
    try{const result=await api('/api/admin/accepted?page='+page);if(current!==request||getAccount()?.address!==owner)return;page=result.page;pages=result.pages;$('#accepted-page').textContent=`${page} / ${pages} · ${result.total} closed`;
      $('#accepted-prev').disabled=page<=1;$('#accepted-next').disabled=page>=pages;$('#accepted-status').textContent='';
      const signature=JSON.stringify(result);if(signature===acceptedSignature)return;acceptedSignature=signature;
      const list=$('#accepted-list');list.replaceChildren();
      for(const row of result.answers){const card=el('article','');card.className='accepted-card';const summary=el('div',(row.selection==='author'?'✓ Accepted by author':row.selection==='automatic'?'◷ Auto-selected':'◷ Expired without an eligible answer')+' · '+new Date(row.closedAt).toLocaleString('en-GB'));summary.className='accepted-meta';card.append(summary);
        const details=el('details',''),title=el('summary',row.question);details.append(title,el('p','Question by '+row.askedBy+': '+row.question),el('p',row.answer?'Answer by '+row.answeredBy+': '+row.answer:'No answer selected.'));card.append(details);
        if(row.answer){const answer=el('p',row.answer);answer.className='accepted-excerpt';card.append(answer,el('small',row.answeredBy+' · '+row.upvotes+' upvotes'));const wallet=el('code',row.walletAddress);wallet.className='accepted-wallet';card.append(wallet);
          if(row.rewardTx){card.append(el('p','Reward confirmed ✓'));}
          else{const form=el('form',''),hash=el('input',''),check=el('button','Verify reward & notify'),note=el('p','');hash.placeholder='Reward transaction hash (0x…)';hash.setAttribute('aria-label','Reward transaction hash for '+row.answeredBy);hash.required=true;hash.maxLength=66;check.type='submit';check.className='login';form.append(el('p','After sending NS manually from the reward pool, paste the transaction hash. No transfer is sent by this form.'),hash,check,note);form.onsubmit=async event=>{event.preventDefault();check.disabled=true;try{const result=await api('/api/admin/rewards/confirm',{questionId:row.questionId,txHash:hash.value.trim()});note.textContent='Confirmed: '+result.amount+' NS. Recipient notified.';acceptedSignature='';await loadAccepted();}catch(error){note.textContent=error.message;check.disabled=false;}};card.append(form);}
        }list.append(card);}
      if(!result.answers.length)list.append(el('p','No accepted answers yet.'));
    }catch(error){if(current===request&&getAccount()?.address===owner)$('#accepted-status').textContent=error.message;}
  }
  $('#accepted-prev').addEventListener('click',()=>{if(page>1){page--;loadAccepted();}});$('#accepted-next').addEventListener('click',()=>{if(page<pages){page++;loadAccepted();}});
  function clear(){request++;selection=null;page=1;acceptedSignature='';$('#accept-dialog').close();$('#accepted-list').replaceChildren();$('#accept-preview').textContent='';clock($('#thread-clock'),null);}
  return {sync,clock,decorate,loadAccepted,clear};
}
