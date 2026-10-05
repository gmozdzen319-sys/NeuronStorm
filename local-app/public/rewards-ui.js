import {points,renderRanking,roundOptions} from './reputation-ui.js';
import {getWalletProvider,isBlip,walletName,blipLink} from './wallet-provider.js';
const TREASURY='0x001d5bE0940145De0c2c1D851b99f33968DED764';
export function createRewardsUI(api,getAccount,onChanged){
  const $=s=>document.querySelector(s),dialog=$('#payment-dialog');let selection=null,pending=null,owner=null,busy=false,memberPage=1,memberPages=1;
  const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const message=text=>$('#payment-status').textContent=text;
  function store(value,address=owner){try{if(value)localStorage.setItem('ns-payment:'+address,JSON.stringify(value));else localStorage.removeItem('ns-payment:'+address);}catch{}if(owner===address){pending=value;$('#pending-payment').hidden=!pending;}}
  function setAccount(account){const next=account?.address.toLowerCase()||null;if(owner===next)return;owner=next;pending=null;rankRequest++;$('#ranking-list').replaceChildren();$('#ranking-me').textContent='';dialog.close();$('#member-wallet-list').replaceChildren();try{pending=owner?JSON.parse(localStorage.getItem('ns-payment:'+owner)||'null'):null;}catch{}$('#pending-payment').hidden=!pending;$('#payment-hash').value=pending?.txHash||'';}
  function showPayment(){document.activeElement?.blur();if(!dialog.open)dialog.showModal();$('#payment-title').focus({preventScroll:true});dialog.scrollTop=0;}
  function restore(){if(!pending)return;$('#payment-discard').hidden=false;selection=null;$('#payment-title').textContent='Pending NS payment';$('#payment-explanation').textContent='Check your existing transaction. Do not pay again. If your wallet did not return a hash, copy it from the wallet activity.';$('#payment-recipient').textContent=pending.recipient||'';for(const id of ['#tip-amount','#tip-amount-label','#edit-answer','#edit-answer-label'])$(id).hidden=true;$('#payment-send').hidden=true;$('#payment-check').hidden=false;$('#payment-hash-label').hidden=false;$('#payment-hash').hidden=false;$('#payment-hash').value=pending.txHash||'';message('');showPayment();}
  function open(action,reply){
    if(pending){restore();return;}$('#payment-discard').hidden=true;selection={action,reply};$('#payment-title').textContent=action==='tip'?'Tip '+reply.author:action==='edit'?'Edit answer · 1 NS':'Delete answer · 1 NS';
    $('#payment-explanation').textContent=action==='tip'?'Send NS directly to this answer’s author.':action==='edit'?'Send 1 NS to the reward pool to update this answer. All existing ratings on this answer will be cleared.':'Send 1 NS to the reward pool to delete this answer. Its stars will no longer count. You will not be able to post another answer to this question.';
    $('#tip-amount').value='1';$('#edit-answer').value=reply.body;for(const id of ['#tip-amount','#tip-amount-label'])$(id).hidden=action!=='tip';for(const id of ['#edit-answer','#edit-answer-label'])$(id).hidden=action!=='edit';
    $('#payment-recipient').textContent=action==='tip'?'Recipient: '+reply.author:'Reward pool: '+TREASURY;$('#payment-send').hidden=false;$('#payment-check').hidden=true;$('#payment-hash').hidden=true;$('#payment-hash-label').hidden=true;message('');showPayment();
  }
  async function check(){
    if(!pending||busy)return;const address=owner,record={...pending,txHash:$('#payment-hash').value.trim()||pending.txHash};if(!/^0x[0-9a-f]{64}$/i.test(record.txHash||'')){message('Copy the transaction hash from your wallet to check this payment.');return;}
    store(record);busy=true;$('#payment-check').disabled=true;message('Checking Quai Network…');
    try{await api('/api/payments/confirm',{id:record.id,txHash:record.txHash});store(null,address);if(owner===address){message('Payment confirmed.');dialog.close();await onChanged();}}
    catch(error){if(owner===address)message(error.message);}finally{busy=false;$('#payment-check').disabled=false;}
  }
  $('#payment-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||pending||!selection)return;busy=true;$('#payment-send').disabled=true;const address=owner;
    try{
      const provider=getWalletProvider();if(!provider?.request)throw Error('Open this page with your wallet installed.');
      const accounts=await provider.request({method:'quai_accounts',params:[]});if(accounts?.[0]?.toLowerCase()!==address)throw Error('Select your signed-in account in your wallet.');
      if(BigInt(await provider.request({method:'quai_chainId',params:[]}))!==9n)throw Error('Select Quai Mainnet in your wallet.');
      const intent=await api('/api/payments/prepare',{replyId:selection.reply.id,action:selection.action,amount:$('#tip-amount').value.trim(),body:$('#edit-answer').value});
      if(owner!==address)throw Error('Your session changed. Sign in again.');
      const current=await provider.request({method:'quai_accounts',params:[]});if(current?.[0]?.toLowerCase()!==address)throw Error('Your your wallet account changed.');
      const record={id:intent.id,recipient:intent.recipient,txHash:null};store(record,address);restore();message('Approve the NS transfer in your wallet.');
      const txHash=await provider.request({method:'quai_sendTransaction',params:[intent.transaction]});
      if(typeof txHash!=='string'||!/^0x[0-9a-f]{64}$/i.test(txHash))throw Error('Check your wallet activity and enter the transaction hash. Do not pay again.');
      store({...record,txHash},address);if(owner===address){$('#payment-hash').value=txHash;message('Transfer submitted. Check payment after 3 network confirmations.');}
    }catch(error){if(owner===address)message(error.message||'The wallet request did not complete. Check your wallet activity.');}
    finally{busy=false;$('#payment-send').disabled=false;}
  });
  setInterval(()=>{if(pending?.txHash&&!document.hidden)check();},8000);
  $('#payment-check').addEventListener('click',check);$('#payment-close').addEventListener('click',()=>{if(!busy)dialog.close();});dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});$('#pending-payment').addEventListener('click',restore);
  $('#payment-discard').addEventListener('click',()=>{if(busy)return;if(confirm('Only discard if no transaction was sent. Keep any transaction hash before continuing.')){store(null);dialog.close();}});
  function decorate(article,reply){if(article.querySelector('.answer-actions')){updateTips(article,reply);return;}const bar=el('div','');bar.className='answer-actions';if(reply.canVote){const tip=el('button','Tip NS');tip.className='login';tip.type='button';tip.addEventListener('click',()=>open('tip',reply));bar.append(tip);}else for(const [action,label] of [['edit','Edit · 1 NS'],['delete','Delete · 1 NS']]){const button=el('button',label);button.className='text-button';button.type='button';button.addEventListener('click',()=>open(action,reply));bar.append(button);}if(reply.walletAddress){const wallet=el('code',reply.walletAddress);wallet.className='address admin-answer-wallet';bar.append(wallet);}article.append(bar);updateTips(article,reply);}
  function updateTips(article,reply){
    let badge=article.querySelector('.tip-total');
    if(!badge){badge=el('span','');badge.className='tip-total';badge.setAttribute('role','status');badge.setAttribute('aria-live','polite');article.querySelector('.answer-actions').append(badge);}
    const previous=badge.dataset.units,current=reply.tipUnits||'0';
    if(previous===current)return;
    badge.textContent=(reply.tipTotal||'0')+' NS received';badge.title=(reply.tipCount||0)+' confirmed tips';badge.dataset.units=current;
    if(previous!==undefined&&BigInt(current)>BigInt(previous)){
      badge.classList.remove('tip-confirmed');void badge.offsetWidth;badge.classList.add('tip-confirmed');
      const spark=el('span','✓ Tip confirmed');spark.className='tip-celebration';badge.append(spark);setTimeout(()=>{spark.remove();badge.classList.remove('tip-confirmed');},2400);
    }
  }
  let rankRequest=0;
  async function loadRanking(){const current=++rankRequest;$('#ranking-status').textContent='Loading ranking…';try{
const result=await api('/api/ranking?category='+$('#ranking-category').value+'&limit='+$('#ranking-limit').value+($('#ranking-round').value?'&round='+$('#ranking-round').value:''));if(current!==rankRequest)return;
const picker=$('#ranking-category'),chosen=picker.value;picker.replaceChildren(new Option('All fields','0'));for(const c of result.categories)picker.append(new Option(c.name+' · '+c.kind,c.id));picker.value=chosen;
roundOptions($('#ranking-round'),result.rounds,result.weekStart);$('#ranking-period').textContent=new Date(result.weekStart).toISOString().slice(0,10)+' – '+new Date(result.weekEnd).toISOString().slice(0,10)+' · Monday 00:00 UTC · '+result.round.status;
$('#ranking-me').textContent=result.me?'Your overall Weekly Score: '+points(result.me.weekly.units)+' · Rank: '+(result.me.weeklyRank?'#'+result.me.weeklyRank:'—')+' · Total Reputation: '+points(result.me.units):'Sign in to see your weekly position.';
renderRanking(result,$('#ranking-list'));$('#ranking-status').textContent='';}catch(error){if(current===rankRequest)$('#ranking-status').textContent=error.message;}}
  let poolBusy=false;
  async function pool(){
    if(poolBusy)return;poolBusy=true;
    try{
      const data=await api('/api/rewards');
      for(const id of ['#reward-balance','#nav-reward-balance'])$(id).textContent=data.balance+' NS';
      const change=data.changePercent,label=change===null?'New funds · % unavailable':(Number(change)>0?'+':'')+change+'% this week';
      const note='Compared with the first recorded balance this week ('+new Date(data.baselineAt).toLocaleString('en-GB',{timeZone:'UTC'})+' UTC).'+(change===null?' Percentage growth cannot be calculated from a zero starting balance.':'');
      for(const id of ['#reward-change','#nav-reward-change']){const node=$(id);node.textContent=label;node.title=note;node.classList.toggle('pool-up',Number(change)>0);node.classList.toggle('pool-down',Number(change)<0);}
      $('#reward-growth-note').textContent=note;
      $('#reward-address').textContent=data.address;$('#reward-address').href='https://explorer.qu.ai/address/'+data.address;
    }catch{for(const id of ['#reward-balance','#nav-reward-balance'])$(id).textContent='Balance unavailable';for(const id of ['#reward-change','#nav-reward-change','#reward-growth-note'])$(id).textContent='';}
    finally{poolBusy=false;}
  }
  for(const selector of ['#ranking-category','#ranking-round','#ranking-limit'])$(selector).addEventListener('change',loadRanking);
  async function members(){if(getAccount()?.role!=='admin')return;const account=owner;try{const data=await api('/api/admin/members?page='+memberPage+'&search='+encodeURIComponent($('#member-search').value.trim()));if(owner!==account)return;memberPages=data.pages;$('#member-wallet-list').replaceChildren();for(const row of data.members){const card=el('div','');card.className='member-wallet';card.append(el('strong',row.nickname),el('code',row.address));$('#member-wallet-list').append(card);}$('#member-page').textContent=`Page ${memberPage} of ${memberPages}`;$('#member-prev').disabled=memberPage<=1;$('#member-next').disabled=memberPage>=memberPages;$('#member-status').textContent='';}catch(error){if(owner===account)$('#member-status').textContent=error.message;}}
  $('#admin-members').addEventListener('toggle',()=>{if($('#admin-members').open)members();});$('#member-search-form').addEventListener('submit',event=>{event.preventDefault();memberPage=1;members();});$('#member-prev').addEventListener('click',()=>{if(memberPage>1){memberPage--;members();}});$('#member-next').addEventListener('click',()=>{if(memberPage<memberPages){memberPage++;members();}});
  let presenceBusy=false;
  async function ping(){if(presenceBusy)return;presenceBusy=true;try{const data=await api('/api/presence',{active:!document.hidden});$('#online-total').textContent=data.online;$('#weekly-total').textContent=data.weeklyVisitors;}catch{$('#online-total').textContent='—';$('#weekly-total').textContent='—';}finally{presenceBusy=false;}}
  ping();setInterval(()=>{if(!document.hidden)ping();},25000);document.addEventListener('visibilitychange',ping);
  pool();document.addEventListener('visibilitychange',()=>{if(!document.hidden)pool();});
  setInterval(()=>{if(!document.hidden){pool();if(!$('#ranking-view').hidden)loadRanking();}},30000);
  return {setAccount,decorate,show(){loadRanking();pool();},clear(){setAccount(null);}};
}
