import {loadReputationAdmin,clearReputationAdmin} from './reputation-ui.js';
import {createQuestionTools} from './question-tools.js';
import {createMemberTools} from './member-tools.js';
import {createGlobe} from './globe.js';
import {createLifecycleUI} from './lifecycle-ui.js';
import {createRewardsUI} from './rewards-ui.js';
import {createNotificationSound} from './notification-sound.js';
import {createSignedSender} from './wallet.js';
import {createDebate} from './debate.js';
export function createConversations({api,onProfile,onExpired}) {
  const $=s=>document.querySelector(s), root=$('#conversations');
  let identity=null, view='inbox', threadId=null, backView='inbox', epoch=0, revision=0, timerBusy=false, signature='', sending=false;
  let adminPage=1,adminPages=1,adminSearch='',adminState='active',adminThread=false,moderated=null,pendingModeration=null,notificationPage=1,notificationPages=1,notificationThrough=0,notificationSignature='';
  let questionPreview=null,notificationReminderThrough=0,notificationRewardThrough=0;
  const questionTools=createQuestionTools({api,getAccount:()=>identity,onBlocked:async()=>{revision=0;debate.stop();await loadThread();}});
  const memberTools=createMemberTools({api,getAccount:()=>identity});
  const globe=createGlobe({api,getAccount:()=>identity});
  const sounds=createNotificationSound($('#notification-sound'));
  const signedSend=createSignedSender(api,()=>identity),debate=createDebate(api,onExpired,()=>identity,()=>sounds.notify());
  const lifecycle=createLifecycleUI({api,signedSend,getAccount:()=>identity,onClosed:async()=>{await showList('mine');status('#list-status','Best answer accepted. The conversation is closed and saved for administrator reward review.');await loadNotifications();}});
  const rewards=createRewardsUI(api,()=>identity,async()=>{await loadThread();status('#thread-status','NS payment confirmed.');});
  const date=value=>new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
  function status(id,text='',error=false){const el=$(id);el.textContent=text;el.classList.toggle('error',error);}
  function shell(next){
    debate.stop();epoch++;view=next;$('#blocked-view').hidden=next!=='blocked';$('#reports-view').hidden=next!=='reports';$('#library-view').hidden=next!=='library';$('#ranking-view').hidden=next!=='ranking';$('#wallet-view').hidden=next!=='wallet';$('#admin-view').hidden=next!=='admin';$('#notifications-view').hidden=next!=='notifications';signature='';revision=0;
    $('#landing').hidden=next!=='ask';root.hidden=next==='profile';$('#profile-area').hidden=next!=='profile';
    $('#questions-list-view').hidden=!['inbox','mine'].includes(next);$('#ask-view').hidden=next!=='ask';$('#thread-view').hidden=next!=='thread';
    document.querySelectorAll('[data-view]').forEach(button=>{if(button.dataset.view===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  }
  function clear(){
    clearReputationAdmin();
    questionTools.setAccount(null);memberTools.clear();questionPreview=null;$('#question-preview-dialog').close();globe.clear();debate.stop();sounds.setAccount(null);rewards.clear();lifecycle.clear();
    root.before($('#landing'));
    $('#landing').append($('.experience-path'),$('.how'));
    $('#moderation-dialog').close();$('#admin-nav').hidden=true;$('#notifications-button').hidden=true;$('#admin-list').replaceChildren();$('#notifications-list').replaceChildren();$('#admin-audit').replaceChildren();moderated=null;pendingModeration=null;notificationSignature='';
    $('#wallet-button').hidden=true;$('#wallet-assets').replaceChildren();$('#wallet-address').textContent='';$('#wallet-updated').textContent='';status('#wallet-status');
    identity=null;epoch++;threadId=null;root.hidden=true;$('#member-nav').hidden=true;$('#ask-question').hidden=true;$('#member-name').hidden=true;
    $('#questions-list').replaceChildren();$('#thread-replies').replaceChildren();$('#original-question').replaceChildren();$('#question-form').reset();$('#reply-form').reset();
    $('#landing').insertBefore($('.platform-stats'),$('.how'));loadStats();
  }
  async function failure(error,target){if(error.httpStatus===401){clear();await onExpired();return;}status(target,error.message||'Unable to load this conversation. Please try again.',true);}
  function questionRow(item){
    const button=node('button',undefined,'question-row'+(item.unread?' unread-pulse':''));button.type='button';
    const top=node('div',undefined,'question-meta');top.append(node('span',(item.categories||[{name:item.category}]).map(t=>t.name).join(' · ')),node('span',date(item.updatedAt)));
    if(item.replyCount===0){button.classList.add('awaiting-answer');if(item.waitingUrgent)button.classList.add('awaiting-urgent');top.append(node('span',item.waitingUrgent?'Needs an answer · less than 24h left':'Waiting for an answer','awaiting-badge'));}
    if(item.unread)top.append(node('span','Unread','unread'));
    const title=node('h2',item.title),excerpt=node('p',item.excerpt.split('\n').slice(1).join('\n').trim(),'question-excerpt'),bottom=node('div',undefined,'question-meta');
    bottom.append(node('span','By '+item.author),node('span',`${item.replyCount} ${item.replyCount===1?'reply':'replies'}`));button.append(top,title);if(excerpt.textContent)button.append(excerpt);button.append(bottom);const timer=node('span');lifecycle.clock(timer,item.expiresAt);button.append(timer);
    button.addEventListener('click',()=>openThread(item.id));return button;
  }
  async function loadList(background=false){
    if(!identity||!['inbox','mine'].includes(view))return;
    const current=epoch,currentView=view;
    if(!background)status('#list-status','Loading questions…');
    try{
      const result=await api('/api/questions?view='+currentView);if(current!==epoch)return;lifecycle.sync(result.serverTime);
      for(const q of result.questions)q.waitingUrgent=q.replyCount===0&&q.expiresAt-result.serverTime<=86400000;result.questions.sort((a,b)=>(a.replyCount===0?0:1)-(b.replyCount===0?0:1)||(a.replyCount===0&&b.replyCount===0?a.expiresAt-b.expiresAt:0));
      status('#list-status');$('#retry-questions').hidden=true;
      const topics=new Map();for(const q of result.questions)for(const t of q.categories)topics.set(String(t.id),t.name);const selectedTopic=$('#filter-topic').value;$('#filter-topic').replaceChildren(new Option('All topics',''),...[...topics].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=>new Option(name,id)));$('#filter-topic').value=topics.has(selectedTopic)?selectedTopic:'';
      const query=$('#filter-query').value.trim().toLowerCase(),topic=$('#filter-topic').value,state=$('#filter-state').value,sort=$('#filter-sort').value;result.questions=result.questions.filter(q=>(!query||((q.searchText||q.title+' '+q.excerpt)+' '+q.author).toLowerCase().includes(query))&&(!topic||q.categories.some(t=>String(t.id)===topic))&&(state!=='unanswered'||q.replyCount===0)&&(state!=='urgent'||q.expiresAt-result.serverTime<=86400000));if(sort==='deadline')result.questions.sort((a,b)=>a.expiresAt-b.expiresAt);if(sort==='newest')result.questions.sort((a,b)=>b.createdAt-a.createdAt);
      const next=JSON.stringify(result.questions);if(next===signature)return;signature=next;
      const list=$('#questions-list');list.replaceChildren();
      if(!result.questions.length){list.append(node('div',(query||topic||state!=='all')?'No questions match these filters.':currentView==='mine'?'You have not asked a question yet.':'No questions for you yet. Questions about your profile topics will appear here.','empty-state'));return;}
      result.questions.forEach(q=>list.append(questionRow(q)));
    }catch(error){if(current===epoch){await failure(error,'#list-status');$('#retry-questions').hidden=false;}}
  }
  $('#question-filters').onsubmit=e=>e.preventDefault();let filterTimer;$('#question-filters').addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>{signature='';loadList();},180);});
  async function showList(next='inbox'){
    if(!identity)return;shell(next);threadId=null;
    $('#list-title').textContent=next==='mine'?'My Questions':'Questions for You';
    $('#list-description').textContent=next==='mine'?'Questions you started, with every reply in one place.':identity.role==='admin'?'Administrator access: you can see every conversation here.':'Questions sent to people who share your topics.';
    await loadList();if(view===next)$('#list-title').focus();
  }
  const pulseObserver=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const card=entry.target;pulseObserver.unobserve(card);setTimeout(()=>{card.classList.remove('unread-pulse');card.querySelector('.message-new')?.remove();},7000);}},{threshold:.35});
  function renderMessage(message,question=false){
    const article=node('article',undefined,question?'':'reply');
    article.append(node('span',question?'Question':'Answer','message-kind'));if(message.unread){article.classList.add('unread-pulse');article.append(node('span','New','message-new'));pulseObserver.observe(article);}
    const meta=node('div',undefined,'message-meta');meta.append(node('strong',message.author),node('time',date(message.createdAt)));meta.lastChild.dateTime=new Date(message.createdAt).toISOString();
    if(message.editedAt)meta.append(node('span','Edited '+date(message.editedAt)));article.append(meta,node('p',message.body,'message-body'));return article;
  }
  function renderVotes(article,reply){
    let bar=article.querySelector('.reply-votes');
    if(!bar){bar=node('div',undefined,'reply-votes');article.append(bar);for(const value of [1,-1]){const button=node('button');button.type='button';button.dataset.vote=value;button.className='vote-button';button.addEventListener('click',async()=>{
      if(sending)return;const current=epoch,id=threadId;const chosen=Number(button.dataset.current)===value?0:value;sending=true;bar.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await api('/api/questions/'+id+'/replies/'+reply.id+'/vote',{value:chosen});if(current===epoch){await loadThread();status('#reply-status','Your rating has been saved.');}}
      catch(error){if(current===epoch)await failure(error,'#reply-status');}
      finally{sending=false;if(current===epoch)bar.querySelectorAll('button').forEach(b=>b.disabled=!reply.canVote);}
    });bar.append(button);}}
    for(const button of bar.querySelectorAll('button')){const up=Number(button.dataset.vote)===1;button.textContent=(up?'👍 ':'👎 ')+(up?reply.upvotes:reply.downvotes);button.setAttribute('aria-label',(up?'Upvote':'Downvote')+' reply by '+reply.author);button.setAttribute('aria-pressed',String(reply.myVote===Number(button.dataset.vote)));button.dataset.current=reply.myVote;button.disabled=!reply.canVote;button.title=reply.canVote?'Click again to remove your rating':'You cannot rate your own reply.';}
  }
  async function loadThread(background=false){
    if(!identity||view!=='thread'||!threadId)return;
    const current=epoch,id=threadId;
    try{
      const result=await api((adminThread?'/api/admin/conversations/':'/api/questions/')+id);if(current!==epoch||id!==threadId)return;
      const thread=result.thread;lifecycle.sync(result.serverTime);lifecycle.clock($('#thread-clock'),thread.expiresAt);if(thread.deletedAt===null)debate.start(id);else debate.stop();status('#thread-status');moderated=adminThread?thread:null;$('#admin-thread-actions').hidden=!adminThread;$('#reply-form').hidden=thread.deletedAt!==null||!thread.canReply;$('#one-answer-note').hidden=thread.deletedAt!==null||thread.canReply;$('#one-answer-note').textContent=thread.contactBlocked?'Replies between these accounts are blocked. You can manage your blocks in My Profile.':'You have used your one answer. Continue the discussion in Debate. Editing or deleting an answer costs 1 NS.';if(adminThread){$('#admin-deleted-note').hidden=thread.deletedAt===null;$('#moderate-conversation').textContent=thread.deletedAt===null?'Delete conversation':'Restore conversation';$('#admin-audit').replaceChildren(...(result.audit.length?result.audit.map(item=>node('li',(item.action==='delete'?'Deleted':'Restored')+' · '+date(item.createdAt)+' · '+item.actor)):[node('li','No moderation actions yet.')]));}
      if(thread.revision!==revision){
        $('#thread-category').textContent=(thread.categories||[{name:thread.category}]).map(t=>t.name).join(' · ');
        $('#original-question').replaceChildren(renderMessage(thread,true));if(thread.deletedAt===null)$('#original-question').append(memberTools.reportButton(thread.id,0));const block=questionTools.blockButton(thread.id,0,thread);if(block)$('#original-question').append(block);
        $('#replies-title').textContent=`Replies (${thread.replies.length})`;
        const list=$('#thread-replies');
        list.replaceChildren();
        if(!thread.replies.length){list.replaceChildren(node('p','No replies yet. Start the conversation.','muted'));}
        else{
          if(!revision||!list.querySelector('[data-reply-id]'))list.replaceChildren();
          for(const reply of thread.replies)if(!list.querySelector(`[data-reply-id="${reply.id}"]`)){const el=renderMessage(reply);el.dataset.replyId=reply.id;list.append(el);}
        }
        revision=thread.revision;
      }
      for(const [replyIndex,reply] of thread.replies.entries()){const article=$('#thread-replies').querySelector(`[data-reply-id="${reply.id}"]`);if(article){article.querySelector('.message-body').textContent=reply.body;renderVotes(article,reply);rewards.decorate(article,reply);memberTools.decorate(article,reply,thread);const oldBlock=article.querySelector('.block-member');if(!oldBlock||oldBlock.dataset.blockId!==(reply.blockId||'')){oldBlock?.remove();const b=questionTools.blockButton(thread.id,reply.id,reply);if(b){b.dataset.blockId=reply.blockId||'';article.append(b);}}lifecycle.decorate(article,reply,thread);const replyList=$('#thread-replies');if(replyList.children[replyIndex]!==article)replyList.insertBefore(article,replyList.children[replyIndex]||null);if(thread.deletedAt!==null)article.querySelectorAll('button').forEach(b=>b.disabled=true);}}
      if(!document.hidden&&thread.deletedAt===null){await api('/api/questions/'+id+'/read',{revision:thread.revision});await loadNotifications();}
    }catch(error){if(current===epoch){await failure(error,'#thread-status');if(error.httpStatus===404){lifecycle.clock($('#thread-clock'),null);$('#one-answer-note').hidden=true;status('#thread-status','This conversation has closed or is no longer available.');debate.stop();revision=0;$('#replies-title').textContent='Replies';$('#thread-category').textContent='';$('#admin-thread-actions').hidden=true;moderated=null;$('#original-question').replaceChildren();$('#thread-replies').replaceChildren();$('#reply-form').hidden=true;}}}
  }
  async function openThread(id,fromAdmin=false){
    adminThread=fromAdmin;if(fromAdmin)backView='admin';
    if(!fromAdmin&&['mine','inbox','notifications'].includes(view))backView=view;
    shell('thread');globe.show();lifecycle.clock($('#thread-clock'),null);threadId=id;$('#admin-thread-actions').hidden=true;$('#reply-form').hidden=false;$('#reply-form').reset();status('#reply-status');status('#thread-status','Loading conversation…');$('#original-question').replaceChildren();$('#thread-replies').replaceChildren();
    $('#back-to-questions').textContent=backView==='admin'?'Back to Admin Dashboard':backView==='notifications'?'Back to Notifications':backView==='mine'?'Back to My Questions':'Back to Questions for You';
    await loadThread();if(view==='thread')$('#thread-title').focus();
  }
  async function loadStats(){
    const current=epoch;status('#stats-status','Loading statistics…');$('#stats-values').replaceChildren();
    try{const {stats}=await api('/api/stats');if(current!==epoch)return;for(const [key,label]of [['members','Members'],['topics','Topics'],['questions','Questions'],['replies','Replies']]){const card=node('div');card.append(node('dt',label),node('dd',new Intl.NumberFormat('en-GB').format(stats[key])));$('#stats-values').append(card);}status('#stats-status');}catch(error){if(current===epoch)await failure(error,'#stats-status');}
  }
  function updateChosen(kind){
    const checked=[...$('#question-'+kind).querySelectorAll('input:checked')];$('#picker-'+kind+'-label').textContent=checked.length?checked.length+(checked.length===1?' topic selected':' topics selected'):'Choose topics';const chips=$('#chosen-'+kind);chips.replaceChildren();
    for(const check of checked){const name=check.dataset.topicName||check.parentElement.textContent,li=node('li'),remove=node('button','×');remove.type='button';remove.setAttribute('aria-label','Remove '+name+' from question');remove.addEventListener('click',()=>{check.checked=false;updateChosen(kind);questionTools.saveDraft();});li.append(node('span',name),remove);chips.append(li);}
  }
  for(const kind of ['work','hobbies'])$('#search-'+kind).addEventListener('input',()=>{const query=$('#search-'+kind).value.normalize('NFKC').toLocaleLowerCase().trim();let matches=0;for(const label of $('#question-'+kind).querySelectorAll('label')){label.hidden=!label.textContent.normalize('NFKC').toLocaleLowerCase().includes(query);if(!label.hidden)matches++;}$('#search-'+kind+'-empty').hidden=matches>0;});
  async function ask(focusQuestion=false){
    if(!identity)return;shell('ask');$('#ask-view').prepend($('.experience-path'));$('#question-form').after($('#landing'));$('#ask-view').append($('.platform-stats'),$('.how'));loadStats();$('#question-form').reset();status('#question-status','Loading topics…');$('#send-question').disabled=true;
    const current=epoch;
    try{const result=await api('/api/categories?available=1');if(current!==epoch)return;
      for(const kind of ['work','hobbies']){const list=$('#question-'+kind);list.replaceChildren();for(const topic of result.categories[kind]){const label=node('label',undefined,'topic-choice'),check=node('input');check.type='checkbox';check.name='question-topic';check.value=topic.id;check.dataset.topicName=topic.name;label.append(check,node('span',topic.name),node('small',topic.memberCount+(topic.memberCount===1?' member':' members'),'topic-member-count'));check.addEventListener('change',()=>updateChosen(kind));list.append(label);}if(!result.categories[kind].length)list.append(node('p','No available topics yet.','muted'));$('#picker-'+kind).open=false;$('#search-'+kind).value='';$('#search-'+kind+'-empty').hidden=true;updateChosen(kind);}
      questionTools.restore(updateChosen);status('#question-status');$('#send-question').disabled=false;$(focusQuestion?'#ask-title':'#title').focus({preventScroll:true});if(focusQuestion)$('#ask-title').scrollIntoView({block:'start'});else window.scrollTo({top:0});
    }catch(error){if(current===epoch)await failure(error,'#question-status');}
  }
  $('#question-form').addEventListener('submit',async event=>{
    event.preventDefault();if(sending)return;const categoryIds=[...document.querySelectorAll('input[name="question-topic"]:checked')].map(el=>Number(el.value)),body=$('#question-body').value.trim();
    if(!categoryIds.length){status('#question-status','Choose at least one topic from Work & Education or Hobbies & Interests.',true);$('#picker-work').open=true;$('#search-work').focus();return;}if(!body){status('#question-status','Enter your question.',true);$('#question-body').focus();return;}
    const current=epoch;sending=true;$('#send-question').disabled=true;status('#question-status','Preparing your preview…');
    try{const result=await api('/api/questions/preview',{categoryIds,body});if(current!==epoch)return;questionPreview={payload:{categoryIds:result.categoryIds,body:result.body},epoch:current,owner:identity.address};$('#question-preview-body').textContent=result.body;$('#question-preview-topics').textContent=result.topics.join(' · ');$('#question-preview-count').textContent=result.recipientCount+' unique '+(result.recipientCount===1?'recipient':'recipients');$('#question-preview-status').textContent='';status('#question-status');document.activeElement?.blur();$('#question-preview-dialog').showModal();$('#question-preview-dialog').scrollTop=0;}
    catch(error){if(current===epoch)await failure(error,'#question-status');}
    finally{sending=false;$('#send-question').disabled=false;}
  });
  $('#question-preview-cancel').onclick=()=>{if(!sending){questionPreview=null;$('#question-preview-dialog').close();}};
  $('#question-preview-dialog').addEventListener('cancel',event=>{if(sending)event.preventDefault();else questionPreview=null;});
  $('#question-preview-send').onclick=async()=>{
    if(sending||!questionPreview)return;const chosen=questionPreview;if(chosen.epoch!==epoch||chosen.owner!==identity?.address){$('#question-preview-dialog').close();return;}
    sending=true;$('#question-preview-send').disabled=true;$('#question-preview-cancel').disabled=true;
    try{const result=await signedSend('/api/questions',chosen.payload,text=>status('#question-preview-status',text));if(chosen.owner!==identity?.address||chosen.epoch!==epoch)return;questionTools.sent(chosen.payload);questionPreview=null;$('#question-preview-dialog').close();backView='mine';await openThread(result.id);status('#thread-status','Question sent to '+result.recipientCount+' members.');}
    catch(error){if(chosen.owner===identity?.address)status('#question-preview-status',error.message,true);}
    finally{sending=false;$('#question-preview-send').disabled=false;$('#question-preview-cancel').disabled=false;}
  };
  $('#reply-form').addEventListener('submit',async event=>{
    event.preventDefault();if(sending||!threadId)return;const body=$('#reply-body').value.trim();if(!body){status('#reply-status','Enter a reply.',true);$('#reply-body').focus();return;}
    const current=epoch,id=threadId;sending=true;$('#send-reply').disabled=true;status('#reply-status','Posting your reply…');
    try{await signedSend('/api/questions/'+id+'/replies',{body},text=>status('#reply-status',text));if(current!==epoch)return;$('#reply-body').value='';status('#reply-status','Your reply has been posted.');await loadThread();}
    catch(error){if(current===epoch)await failure(error,'#reply-status');}
    finally{sending=false;$('#send-reply').disabled=false;}
  });
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.view==='profile')onProfile();else if(button.dataset.view==='wallet')showWallet();else if(button.dataset.view==='admin')showAdmin();else if(button.dataset.view==='reports')showReports();else if(button.dataset.view==='blocked'){shell('blocked');questionTools.loadBlocks();$('#blocked-title').focus();}else if(button.dataset.view==='library'){shell('library');memberTools.loadLibrary();$('#library-title').focus();}else if(button.dataset.view==='ranking'){shell('ranking');rewards.show();$('#ranking-title').focus();}else if(button.dataset.view==='ask')ask();else showList(button.dataset.view);}));
  $('.brand').addEventListener('click',event=>{if(identity){event.preventDefault();ask();}});
  $('#ask-question').addEventListener('click',()=>ask(true));$('#cancel-question').addEventListener('click',()=>showList());$('#back-to-questions').addEventListener('click',()=>backView==='admin'?showAdmin():backView==='notifications'?showNotifications():showList(backView));$('#retry-questions').addEventListener('click',()=>loadList());
  setInterval(async()=>{if(timerBusy||sending||!identity)return;timerBusy=true;try{if(document.hidden){await loadNotifications();return;}if(view==='thread')await loadThread(true);else if(view==='admin')await loadAdmin(true);else if(view==='reports')await memberTools.loadReports();else await loadList(true);await loadNotifications();}finally{timerBusy=false;}},5000);

  async function loadAdmin(background=false){
    if(identity?.role!=='admin'||view!=='admin')return;const current=epoch;
    if(!background)loadReputationAdmin(api);lifecycle.loadAccepted();if(!background)status('#admin-status','Loading conversations…');
    try{const result=await api('/api/admin/conversations?state='+adminState+'&page='+adminPage+'&search='+encodeURIComponent(adminSearch));if(current!==epoch)return;adminPage=result.page;adminPages=result.pages;status('#admin-status');const next=JSON.stringify(result);if(signature===next)return;signature=next;
      $('#admin-stats').replaceChildren();for(const [key,label]of [['members','Members'],['active','Active conversations'],['deleted','Deleted conversations'],['replies','Active replies']]){const card=node('div');card.append(node('dt',label),node('dd',result.stats[key]));$('#admin-stats').append(card);}
      $('#admin-list').replaceChildren();for(const item of result.questions){const button=node('button',undefined,'question-row');button.type='button';button.append(node('h2',item.title),node('p',item.excerpt.split('\n').slice(1).join('\n').trim()),node('p','By '+item.author+' · '+date(item.createdAt)+' · '+item.replyCount+(item.replyCount===1?' reply':' replies'),'muted'),node('p',item.categories.map(t=>t.name).join(' · '),'question-meta'));if(item.deletedAt!==null)button.append(node('p','Deleted '+date(item.deletedAt),'muted'));button.addEventListener('click',()=>openThread(item.id,true));$('#admin-list').append(button);}if(!result.questions.length)$('#admin-list').append(node('p','No conversations found.','empty-state'));
      $('#admin-page').textContent='Page '+adminPage+' of '+adminPages+' · '+result.total+' conversations';$('#admin-prev').disabled=adminPage<=1;$('#admin-next').disabled=adminPage>=adminPages;
    }catch(error){if(current===epoch)await failure(error,'#admin-status');}
  }
  async function showReports(){if(identity?.role!=='admin')return;shell('reports');threadId=null;$('#reports-title').focus();await memberTools.loadReports();}
  async function showAdmin(){if(identity?.role!=='admin')return;shell('admin');threadId=null;await loadAdmin();if(view==='admin')$('#admin-title').focus();}
  $('#admin-search-form').addEventListener('submit',event=>{event.preventDefault();adminSearch=$('#admin-search').value.trim();adminState=$('#admin-state').value;adminPage=1;signature='';loadAdmin();});
  $('#admin-state').addEventListener('change',()=>{adminState=$('#admin-state').value;adminPage=1;signature='';loadAdmin();});
  $('#admin-prev').addEventListener('click',()=>{if(adminPage>1){adminPage--;loadAdmin();}});$('#admin-next').addEventListener('click',()=>{if(adminPage<adminPages){adminPage++;loadAdmin();}});
  $('#moderate-conversation').addEventListener('click',()=>{
    if(!moderated||identity?.role!=='admin')return;const removing=moderated.deletedAt===null;pendingModeration={id:moderated.id,action:removing?'delete':'restore'};$('#moderation-form').reset();status('#moderation-status');$('#moderation-title').textContent=removing?'Delete conversation?':'Restore conversation?';$('#moderation-target').textContent='“'+moderated.body.slice(0,220)+'” — '+moderated.author+' · '+date(moderated.createdAt);$('#moderation-impact').textContent=removing?'This hides the question, all '+moderated.replies.length+(moderated.replies.length===1?' reply':' replies')+', ratings and related notifications from members. Replies cannot be added. Stars from these replies will be excluded. You can restore the conversation from Deleted conversations; this does not permanently erase it.':'This restores access for the original participants, along with replies, ratings and stars. Earlier notifications remain read. No new notification is sent.';$('#moderation-submit').textContent=removing?'Delete conversation':'Restore conversation';$('#moderation-dialog').showModal();
  });
  $('#moderation-cancel').addEventListener('click',()=>$('#moderation-dialog').close());
  $('#moderation-form').addEventListener('submit',async event=>{
    event.preventDefault();if(sending||!pendingModeration||!$('#moderation-confirm').checked)return;const {id,action}=pendingModeration,current=epoch;sending=true;$('#moderation-submit').disabled=true;
    try{await api('/api/admin/conversations/'+id+'/'+action,{confirmation:id});$('#moderation-dialog').close();if(current===epoch){await showAdmin();status('#admin-status',action==='delete'?'Conversation moved to Deleted conversations.':'Conversation restored.');await loadNotifications();}}
    catch(error){if(current===epoch)await failure(error,'#moderation-status');}finally{sending=false;$('#moderation-submit').disabled=false;}
  });
  async function loadNotifications(){
    if(!identity)return;const owner=identity.address,current=epoch;
    try{const result=await api('/api/notifications?page='+notificationPage);if(identity?.address!==owner)return;sounds.update(result.sequence);$('#notification-count').textContent=result.unread;$('#notifications-button').classList.toggle('unread-pulse',result.unread>0);$('#notifications-button').setAttribute('aria-label','Notifications, '+result.unread+' unread');if(view!=='notifications'||current!==epoch)return;status('#notifications-status');notificationThrough=result.throughId;notificationReminderThrough=result.throughReminderId;notificationRewardThrough=result.throughRewardId;notificationPage=result.page;notificationPages=result.pages;$('#notifications-read-all').disabled=!result.unread;
      const next=JSON.stringify(result);if(next===notificationSignature)return;notificationSignature=next;$('#notifications-list').replaceChildren();for(const item of result.notifications){const row=node('div',undefined,'notification-row'+(item.readAt===null?' unread-row':'')),open=node('button');open.type='button';open.append(node('strong',item.kind==='reward'?'You received '+item.amount+' NS for your answer':item.kind==='deadline'?'Your question closes within 24 hours — choose your best answer':item.actor+(item.kind==='question'?' asked a question':' replied')),node('span',item.title),node('span',date(item.createdAt)+(item.readAt===null?' · Unread':'')));if(item.kind==='reward'){open.addEventListener('click',async()=>{try{await api('/api/notifications/read',{id:item.id});await loadNotifications();}catch(error){await failure(error,'#notifications-status');}});const proof=node('a','View confirmed reward');proof.href='https://explorer.qu.ai/tx/'+item.txHash;proof.target='_blank';proof.rel='noopener noreferrer';row.append(proof);}else open.addEventListener('click',()=>openThread(item.questionId));row.append(open);if(item.readAt===null){const read=node('button','Mark as read','text-button');read.type='button';read.addEventListener('click',async()=>{try{await api('/api/notifications/read',{id:item.id});await loadNotifications();}catch(error){await failure(error,'#notifications-status');}});row.append(read);}$('#notifications-list').append(row);}if(!result.notifications.length)$('#notifications-list').append(node('p','No notifications yet.','empty-state'));$('#notifications-page').textContent='Page '+result.page+' of '+result.pages;$('#notifications-prev').disabled=result.page<=1;$('#notifications-next').disabled=result.page>=result.pages;
    }catch(error){if(identity?.address===owner){if(error.httpStatus===401)await failure(error,'#notifications-status');else if(view==='notifications')status('#notifications-status','Notifications could not be refreshed. Please try again.',true);}}
  }
  async function showNotifications(){if(!identity)return;shell('notifications');notificationSignature='';await loadNotifications();if(view==='notifications')$('#notifications-title').focus();}
  $('#notifications-button').addEventListener('click',showNotifications);
  $('#notifications-read-all').addEventListener('click',async()=>{try{await api('/api/notifications/read-all',{throughId:notificationThrough,throughRewardId:notificationRewardThrough,throughReminderId:notificationReminderThrough});await loadNotifications();}catch(error){await failure(error,'#notifications-status');}});
  $('#notifications-prev').addEventListener('click',()=>{if(notificationPage>1){notificationPage--;loadNotifications();}});$('#notifications-next').addEventListener('click',()=>{if(notificationPage<notificationPages){notificationPage++;loadNotifications();}});

  async function showWallet(){if(!identity)return;shell('wallet');threadId=null;$('#wallet-title').focus();await loadWallet();}
  async function loadWallet(){
    if(!identity||view!=='wallet')return;const current=epoch,owner=identity.address;
    $('#wallet-address').textContent=owner;$('#wallet-assets').replaceChildren();$('#wallet-updated').textContent='';$('#wallet-refresh').disabled=true;status('#wallet-status','Loading your balances…');
    try{const result=await api('/api/wallet');if(current!==epoch||identity?.address!==owner)return;
      for(const asset of result.assets){const card=node('article',undefined,'wallet-asset'),heading=node('div');heading.append(node('h2',asset.name),node('span',asset.symbol+' · '+asset.type,'muted'));card.append(heading,node('strong',asset.balance+(asset.rawUnits?' raw units':''),'wallet-balance'));if(asset.contract)card.append(node('p',asset.contract,'address'));$('#wallet-assets').append(card);}
      status('#wallet-status',result.warning||'',!!result.warning);$('#wallet-updated').textContent='Last checked: '+date(result.updatedAt);
    }catch(error){if(current===epoch)await failure(error,'#wallet-status');}finally{if(current===epoch)$('#wallet-refresh').disabled=false;}
  }
  $('#wallet-refresh').addEventListener('click',loadWallet);$('#wallet-profile').addEventListener('click',onProfile);
  return {clear,setAccount(account){if(identity?.address!==account?.address){lifecycle.clear();memberTools.clear();questionPreview=null;$('#question-preview-dialog').close();}identity=account;questionTools.setAccount(account);sounds.setAccount(account);rewards.setAccount(account);$('#wallet-button').hidden=!account;},openProfile(){if(identity)shell('profile');},setIdentity(account,profile,openInbox=false){identity=account;questionTools.setAccount(account);globe.setAccount(account);sounds.setAccount(account);rewards.setAccount(account);$('#admin-nav').hidden=account.role!=='admin';$('#notifications-button').hidden=false;loadNotifications();$('#member-nav').hidden=false;$('#ask-question').hidden=false;$('#member-name').hidden=false;$('#member-name').textContent=profile.nickname;if(openInbox){if(account.role==='admin')showAdmin();else ask();}}};
}
