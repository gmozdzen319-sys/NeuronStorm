const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const encode=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export function confirmationErrorText(submitted,error){
  return submitted?'Checking transaction status… Do not send again.':error.name==='NotAllowedError'?'Confirmation cancelled or expired. No automatic retry will be sent.':error.message;
}
export function sendStatusText(status,createdAt=Date.now(),time=Date.now()){
 const old=time-Number(createdAt)>300000;
 return ({awaiting_confirmation:'Awaiting your Passkey confirmation',verifying:old?'Confirmation needs review. Status checks continue; do not send again.':'Checking confirmation',authorized:old?'Submission needs review. Status checks continue; do not send again.':'Awaiting submission',submitting:old?'Transaction outcome is not yet verified. Background checks continue; do not send again.':'Submitted · awaiting verification',confirmed:'Confirmed',failed:'Failed · No automatic retry',stopped:'Stopped before submission · No transaction sent'})[status]||'Needs review · Do not send again';
}
export function transferReviewText(review){
  const base=`Send ${review.amount} ${review.symbol||'QUAI'}\nFrom: ${review.wallet}\nTo: ${review.recipient}\n${review.network}`;
  if(review.totalFee===undefined)return `${base}\nMaximum network fee: ${review.maximumFee} QUAI · paid by ${review.feePaidBy}`;
  const units=value=>{if(typeof value!=='string'||!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value))throw Error('Unable to verify the fee quote.');const [a,b='']=value.split('.');return BigInt(a)*10n**18n+BigInt(b.padEnd(18,'0'));};
  const fee=units(review.networkFee),service=units(review.serviceFee),total=units(review.totalFee);
  if(fee<=0n||service!==(fee+19n)/20n||total!==fee+service||review.feeCurrency!=='QUAI'||review.feePaidBy!=='Your wallet')throw Error('Unable to verify the fee quote.');
  return `${base}\nToken contract: ${review.token}\nQuoted network fee: ${review.networkFee} QUAI\nService fee (5%): ${review.serviceFee} QUAI\nTotal fee from your wallet: ${review.totalFee} QUAI\nThe recipient receives the full amount. The network fee is a fixed quote; actual network usage may differ.`;
}
export async function deviceResponse(kind,options){
  if(!globalThis.isSecureContext||!navigator.credentials||!globalThis.PublicKeyCredential)throw Error('This browser cannot use passkeys. Choose Pelagus or BillPay.');
  const publicKey={...options,challenge:decode(options.challenge)};
  if(kind==='register'){
    publicKey.user={...options.user,id:decode(options.user.id)};
    publicKey.excludeCredentials=(options.excludeCredentials||[]).map(c=>({...c,id:decode(c.id)}));
  }else publicKey.allowCredentials=(options.allowCredentials||[]).map(c=>({...c,id:decode(c.id)}));
  const credential=await navigator.credentials[kind==='register'?'create':'get']({publicKey});
  if(!credential)throw Error('No passkey was selected.');
  const r=credential.response;
  const response={clientDataJSON:encode(r.clientDataJSON)};
  if(kind==='register'){response.attestationObject=encode(r.attestationObject);response.transports=r.getTransports?.()||[];}
  else{response.authenticatorData=encode(r.authenticatorData);response.signature=encode(r.signature);response.userHandle=r.userHandle?encode(r.userHandle):null;}
  return {id:credential.id,rawId:encode(credential.rawId),type:credential.type,response,clientExtensionResults:credential.getClientExtensionResults()};
}

export function createPasskeyUI({api,onExternal,onAccount,onSetupReady=()=>{}}){
  const $=s=>document.querySelector(s),dialog=$('#auth-dialog');let busy=false,legal=null,epoch=0,account=null,transfer=null,receiveAddress=null,sending=false;
  let progressStop=null,sendProgressActive=false,paymentIntent=null;
  function paintProgress(kind,percent,text){
    // Both setup displays observe the same result and existing polling lifecycle.
    for(const prefix of kind==='setup'?['pk-progress-','profile-progress-']:['pk-progress-']){
      const box=$('#'+prefix+kind);if(!box)continue;box.hidden=false;
      $('#'+prefix+kind+'-bar').value=percent;
      $('#'+prefix+kind+'-percent').textContent=percent+'%';
      $('#'+prefix+kind+'-message').textContent=text;
    }
  }
  function progressState(state){
    if(sendProgressActive||state==='awaiting_confirmation')return;
    const stages={verifying:[10,'Verifying signature'],authorized:[20,'Preparing transaction'],submitting:[85,'Waiting for verified network confirmation'],confirmed:[100,'Confirmed']};
    if(stages[state])paintProgress('send',...stages[state]);
    else if(['failed','stopped'].includes(state)&&!$('#pk-progress-send').hidden)$('#pk-progress-send-message').textContent=sendStatusText(state);
  }
  function trackProgress(kind,revision){
    progressStop?.();const id=crypto.randomUUID();let active=true,timer;
    sendProgressActive=kind==='send';paintProgress(kind,0,kind==='prepare'?'Preparing your review':'Verifying signature');
    $('#pk-progress-'+kind).scrollIntoView?.({block:'nearest',behavior:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    const stop=()=>{active=false;clearTimeout(timer);if(progressStop===stop)sendProgressActive=false;};progressStop=stop;
    async function poll(){
      let timeout;
      try{const result=await Promise.race([api('/api/passkey/wallet/send/progress/'+id),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Progress unavailable')),10000);})]);
        if(!active||revision!==epoch)return;
        if(result.progress?.kind===kind)paintProgress(kind,result.progress.percent,result.progress.message);
        else $('#pk-progress-'+kind+'-message').textContent='Waiting for an update. The transfer status below remains authoritative.';
      }catch{if(active&&revision===epoch)$('#pk-progress-'+kind+'-message').textContent='Progress updates are temporarily unavailable. Waiting for the transfer result.';}
      finally{clearTimeout(timeout);}
      if(active&&revision===epoch)timer=setTimeout(poll,2000);
    }
    timer=setTimeout(poll,500);return {id,stop};
  }
  const message=text=>{$('#auth-status').textContent=text;};
  async function open(){
    $('#passkey-options').hidden=true;message('');dialog.showModal();
    $('#auth-passkey').disabled=true;$('#auth-availability').textContent='Checking availability…';
    try{const [config,terms]=await Promise.all([api('/api/passkey/config'),api('/api/legal')]);legal=terms;
      $('#auth-passkey').disabled=!config.enabled;$('#auth-availability').textContent=config.enabled?'Use your fingerprint, face or device PIN.':'Passkey is being prepared. Pelagus and BillPay are available now.';
      $('#passkey-terms').hidden=!terms.published;$('#passkey-agree').checked=false;
    }catch{message('Unable to check passkey availability. You can still use your connected wallet.');}
  }
  $('#auth-close').addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  $('#auth-pelagus').addEventListener('click',()=>{dialog.close();onExternal('pelagus');});
  $('#auth-billpay').addEventListener('click',()=>{dialog.close();onExternal('billpay');});
  $('#auth-passkey').addEventListener('click',()=>{$('#passkey-options').hidden=false;$('#passkey-signin').focus();});
  async function authenticate(kind){
    if(busy)return;
    if(kind==='register'&&legal?.published&&!$('#passkey-agree').checked){message('Read and accept the Terms of Use first.');$('#passkey-agree').focus();return;}
    busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      message('Confirm on your device…');
      const request=await api('/api/passkey/'+kind+'/options',{termsAccepted:$('#passkey-agree').checked,termsHash:legal?.hash});
      const response=await deviceResponse(kind,request.options);
      const result=await api('/api/passkey/'+kind+'/verify',{id:request.id,response});
      dialog.close();await onAccount(result.account);
    }catch(error){message(error.name==='NotAllowedError'?'Passkey confirmation was cancelled or timed out. Nothing was sent.':error.message||'Unable to sign in. Please try again.');}
    finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  $('#passkey-signin').addEventListener('click',()=>authenticate('login'));
  $('#passkey-signup').addEventListener('click',()=>authenticate('register'));
  let activationTimer,sendTimer,sendWatch=0,tokenRevision=0,feeMode=false,baseAssets=[];
  const terminal=s=>['confirmed','failed','stopped'].includes(s);
  function watchTransfers(rows,revision,activeId=null){
    clearTimeout(sendTimer);
    const watch=++sendWatch,current=()=>revision===epoch&&watch===sendWatch;
    const render=()=>{
      if(!current())return;
      $('#pk-transfers').replaceChildren();
      for(const row of rows){const item=document.createElement('p');item.className='address';item.textContent=(row.statusUnavailable?'Status temporarily unavailable. Checks will continue; do not send again.':sendStatusText(row.phase,row.created_at))+(row.tx_hash?' · '+row.tx_hash:'');$('#pk-transfers').append(item);}
    };
    render();
    async function poll(){
      if(!current())return;
      for(const row of rows.filter(r=>!terminal(r.phase))){
        let timeout;
        try{
          const s=await Promise.race([api('/api/passkey/wallet/send/'+row.id),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Status unavailable')),15000);})]);
          if(!current())return;
          row.phase=s.status;row.tx_hash=s.transactionHash;row.statusUnavailable=false;
          progressState(s.status);
          if(row.id===activeId){$('#pk-send-status').textContent=sendStatusText(s.status,row.created_at)+(s.transactionHash?' · '+s.transactionHash:'');if(terminal(s.status)){$('#pk-confirm').disabled=true;transfer=null;}}
        }catch{if(current()){
          if(row.id===activeId)$('#pk-send-status').textContent='Unable to verify status right now. Checks will continue. Do not send again.';
          row.statusUnavailable=true;
        }}
        finally{clearTimeout(timeout);}
      }
      render();
      if(current()&&rows.some(r=>!terminal(r.phase)))sendTimer=setTimeout(poll,rows.some(r=>Date.now()-Number(r.created_at)>300000)?60000:10000);
      else if(current()){
        // Refresh availability from the server; never infer permission to send
        // from a terminal label or locally release a pending operation.
        try{const state=await api('/api/passkey/wallet');if(current()){$('#pk-send').disabled=!state.sendAvailable;$('#pk-quai-balance').textContent=state.quaiBalance??'Not available';$('#pk-status').textContent=state.reason;}}
        catch{if(current())$('#pk-status').textContent='Transfer status updated. Refresh Wallet to check your latest balance and sending availability.';}
      }
    }
    if(rows.some(r=>!terminal(r.phase)))sendTimer=setTimeout(poll,10000);
  }
  function renderSendAssets(tokens){
    if(!feeMode)return;const select=$('#pk-send-token'),chosen=select.value,assets=new Map();
    for(const token of [...baseAssets,...tokens])assets.set(token.contract.toLowerCase(),token);
    select.replaceChildren();for(const token of assets.values()){const option=document.createElement('option');option.value=token.contract;option.textContent=token.symbol+(token.contract==='0x'+'0'.repeat(40)?'':' · '+token.contract);select.append(option);}
    if([...select.options].some(o=>o.value===chosen))select.value=chosen;
  }
  function renderTokens(tokens){
    renderSendAssets(tokens);
    $('#pk-tokens').replaceChildren();
    for(const token of tokens){
      const item=document.createElement('div');item.className='pk-token';
      const title=document.createElement('strong'),detail=document.createElement('p'),balance=document.createElement('p');
      title.textContent=token.symbol+' · '+token.name;detail.textContent=token.contract;detail.className='address';
      balance.textContent=token.balance===undefined?'Loading balance…':token.balance===null?'Balance unavailable':token.balance+' '+token.symbol;
      item.append(title,balance,detail);$('#pk-tokens').append(item);
    }
  }
  async function loadTokens(revision){
    const request=++tokenRevision;
    try{
      const saved=await api('/api/passkey/wallet/tokens');if(revision!==epoch||request!==tokenRevision)return;renderTokens(saved.tokens);

      try{const balances=await api('/api/passkey/wallet/token-balances');if(revision===epoch&&request===tokenRevision){renderTokens(balances.tokens);$('#pk-ns-balance').textContent=balances.nsBalance??'Not available';}}
      catch{if(revision===epoch&&request===tokenRevision){renderTokens(saved.tokens.map(t=>({...t,balance:null})));$('#pk-ns-balance').textContent='Not available';}}
    }catch{if(revision===epoch&&request===tokenRevision){$('#pk-token-preview').textContent='Unable to load saved tokens. Please refresh.';$('#pk-ns-balance').textContent='Not available';}}
  }
  async function setAccount(next,force=false){
    if(!force&&account?.id===next?.id&&account?.method===next?.method)return;
    clearTimeout(activationTimer);
    clearTimeout(sendTimer);
    progressStop?.();$('#pk-progress-prepare').hidden=true;$('#pk-progress-send').hidden=true;
    const revision=++epoch;account=next?.method==='passkey'?next:null;onSetupReady(false);
    if(!force||!account)$('#pk-progress-setup').hidden=true;
    paymentIntent=null;$('#pk-recipient').readOnly=false;$('#pk-amount').readOnly=false;$('#pk-send-token').disabled=false;
    feeMode=false;baseAssets=[];$('#pk-send-token').replaceChildren();$('#pk-send-token-field').hidden=true;$('#pk-send-title').textContent='Send QUAI';$('#pk-amount-label').textContent='Amount in QUAI';$('#pk-legacy-wallets').replaceChildren();
    $('#pk-ns-balance').textContent=account?'Loading…':'Not available';
    transfer=null;receiveAddress=null;$('#pk-wallet-address').textContent='';$('#pk-quai-balance').textContent='Not available';$('#pk-receive').disabled=true;$('#pk-send').disabled=true;
    $('#pk-transfers').replaceChildren();
    $('#pk-receive-panel').hidden=true;$('#pk-receive-address').textContent='';$('#pk-receive-qr').removeAttribute('src');$('#pk-send-form').hidden=true;$('#pk-recipient').value='';$('#pk-amount').value='';$('#pk-send-review').hidden=true;$('#pk-send-status').textContent='';
    preview=null;$('#pk-id').textContent='';$('#pk-token-address').value='';$('#pk-token-preview').textContent='';$('#pk-token-submit').textContent='Review token';
    if(!force||!account)$('#passkey-home').hidden=true;$('#pk-tokens').replaceChildren();$('#pk-devices').replaceChildren();$('#pk-status').textContent='';$('#pk-token-form').hidden=true;
    if(!account)return;
    void loadTokens(revision);
    $('#pk-id').textContent=account.id;$('#pk-status').textContent='Loading your account…';
    if($('#pk-progress-setup').hidden)paintProgress('setup',0,'Checking wallet setup status');
    try{const state=await api('/api/passkey/wallet');if(revision!==epoch)return;
      $('#pk-status').textContent=state.reason;
      onSetupReady(state.status==='active'&&state.receiveAvailable===true&&!!state.address&&state.setupProgress?.percent===100);
      if(state.setupProgress){
        const ready=state.status==='active'&&state.receiveAvailable&&state.address;
        const percent=Math.max(0,Math.min(ready?100:90,Number(state.setupProgress.percent)||0));
        paintProgress('setup',percent,state.setupProgress.message);
      }else $('#pk-progress-setup').hidden=true;
      if(state.status==='activating')activationTimer=setTimeout(()=>{if(revision===epoch&&!sending)setAccount(account,true);},15000);
      $('#pk-wallet-title').textContent=state.status==='active'?'Your personal wallet':'Wallet setup';
      $('#pk-wallet-address').textContent=state.address||'';$('#pk-quai-balance').textContent=state.quaiBalance??'Not available';$('#pk-receive').disabled=!state.receiveAvailable;$('#pk-send').disabled=!state.sendAvailable;
      feeMode=state.quotedFees===true;baseAssets=state.sendTokens||[];$('#pk-send-token-field').hidden=!feeMode;
      if(feeMode){$('#pk-send-title').textContent='Send';$('#pk-amount-label').textContent='Amount';renderSendAssets(state.tokens||[]);}
      for(const old of state.legacyWallets||[]){const item=document.createElement('section');item.className='pk-summary';const title=document.createElement('h3'),address=document.createElement('p'),balance=document.createElement('p');title.textContent='Previous wallet';address.className='address';address.textContent=old.address;balance.textContent=(old.quaiBalance??'Balance unavailable')+(old.quaiBalance===null?'':' QUAI')+' · Funds have not been moved.';item.append(title,address,balance);$('#pk-legacy-wallets').append(item);}
      watchTransfers(state.transfers||[],revision);
      const pending=(state.transfers||[]).find(t=>!terminal(t.phase));if(pending)progressState(pending.phase);
    }catch(error){if(revision===epoch){$('#pk-status').textContent=error.message;paintProgress('setup',0,'Wallet status is temporarily unavailable. Please refresh to check again.');}}
  }
  let preview=null;
  $('#pk-refresh').addEventListener('click',()=>{if(!sending)setAccount(account,true);});
  $('#pk-receive').addEventListener('click',async()=>{const revision=epoch;$('#pk-receive').disabled=true;
    try{const r=await api('/api/passkey/wallet/receive');if(revision!==epoch)return;receiveAddress=r.address;$('#pk-receive-compatibility').hidden=r.receiveCompatible===true;$('#pk-receive-address').textContent=r.address;$('#pk-receive-qr').src=r.qr;$('#pk-receive-panel').hidden=false;}
    catch(error){if(revision===epoch)$('#pk-status').textContent=error.message;}finally{if(revision===epoch)$('#pk-receive').disabled=false;}
  });
  $('#pk-copy').addEventListener('click',async()=>{if(!receiveAddress)return;try{await navigator.clipboard.writeText(receiveAddress);$('#pk-status').textContent='Address copied.';}catch{$('#pk-status').textContent='Select and copy the address above.';}});
  $('#pk-send').addEventListener('click',()=>{
    if(paymentIntent&&!sending){paymentIntent=null;transfer=null;$('#pk-send-review').hidden=true;$('#pk-recipient').readOnly=false;$('#pk-amount').readOnly=false;$('#pk-send-token').disabled=false;$('#pk-recipient').value='';$('#pk-amount').value='';}
    $('#pk-send-form').hidden=false;$('#pk-recipient').focus();
  });
  for(const id of ['#pk-recipient','#pk-amount','#pk-send-token'])$(id).addEventListener('input',()=>{transfer=null;$('#pk-send-review').hidden=true;});
  $('#pk-send-form').addEventListener('submit',async event=>{event.preventDefault();if(sending)return;const revision=epoch;transfer=null;$('#pk-send-review').hidden=true;sending=true;$('#pk-review-button').disabled=true;$('#pk-send-status').textContent='Preparing…';
    $('#pk-progress-send').hidden=true;const progress=trackProgress('prepare',revision);
    try{const r=await api('/api/passkey/wallet/send/prepare',{progressId:progress.id,...(paymentIntent?{paymentIntent:paymentIntent.id}:{}),recipient:$('#pk-recipient').value.trim(),amount:$('#pk-amount').value.trim(),...(feeMode?{token:$('#pk-send-token').value}:{})});if(revision!==epoch)return;const reviewText=transferReviewText(r.review);transfer=r;
      progress.stop();paintProgress('prepare',100,'Ready · Confirm with your Passkey');
      $('#pk-review-text').textContent=reviewText;
      $('#pk-send-review').hidden=false;$('#pk-confirm').disabled=false;$('#pk-send-status').textContent='Awaiting confirmation. Review the recipient and amount carefully.';
      watchTransfers([{id:r.id,phase:'awaiting_confirmation',created_at:Date.now()}],revision,r.id);
    }catch(error){if(revision===epoch){$('#pk-send-status').textContent=error.message;$('#pk-progress-prepare-message').textContent='Preparation could not complete. See the message below.';}}finally{progress.stop();sending=false;if(revision===epoch)$('#pk-review-button').disabled=false;}
  });
  $('#pk-confirm').addEventListener('click',async()=>{if(!transfer||sending)return;const request=transfer,revision=epoch;transfer=null;sending=true;$('#pk-confirm').disabled=true;$('#pk-review-button').disabled=true;
    let confirmationSubmitted=false,progress;
    try{$('#pk-send-status').textContent='Awaiting confirmation on your device…';const response=await deviceResponse('login',request.options);if(revision!==epoch)return;
      confirmationSubmitted=true;
      progress=trackProgress('send',revision);
      $('#pk-send-status').textContent='Submitting…';const result=await api('/api/passkey/wallet/send/confirm',{id:request.id,response,progressId:progress.id});if(revision!==epoch)return;
      progress.stop();progressState(result.status);
      $('#pk-send-status').textContent=result.status==='confirmed'?'Confirmed. Transaction: '+result.transactionHash:result.status==='failed'?'Failed. No automatic retry will be sent.':result.status==='submitting'?'Checking transaction status… Do not send again.':'Stopped. No automatic retry will be sent.';
    }catch(error){if(revision===epoch){$('#pk-send-status').textContent=confirmationErrorText(confirmationSubmitted,error);
      // Read-only status lookup after an uncertain HTTP response; never repeat POST.
      try{const s=await api('/api/passkey/wallet/send/'+request.id);if(revision===epoch&&s.transactionHash)$('#pk-send-status').textContent=(s.status==='confirmed'?'Confirmed. ':'Check this transaction before sending again. ')+s.transactionHash;}catch{}
    }}finally{progress?.stop();sending=false;if(revision===epoch)$('#pk-review-button').disabled=false;}
  });
  $('#pk-add-token').addEventListener('click',()=>{$('#pk-token-form').hidden=false;$('#pk-token-address').focus();});
  $('#pk-token-address').addEventListener('input',()=>{preview=null;$('#pk-token-submit').textContent='Review token';$('#pk-token-preview').textContent='';});
  $('#pk-token-form').addEventListener('submit',async event=>{
    event.preventDefault();const revision=epoch;$('#pk-token-submit').disabled=true;
    try{
      if(!preview){const result=await api('/api/passkey/wallet/token-preview',{contract:$('#pk-token-address').value.trim()});if(revision!==epoch)return;preview=result;
        $('#pk-token-preview').textContent=result.name+' ('+result.symbol+') · '+result.decimals+' decimals · '+result.contract+'\nToken names and symbols do not establish trust. Verify the contract independently.';$('#pk-token-submit').textContent='Add token';
      }else{await api('/api/passkey/wallet/tokens',preview);if(revision!==epoch)return;preview=null;$('#pk-token-submit').textContent='Review token';$('#pk-token-preview').textContent='Token added. Updating balance…';$('#pk-token-address').value='';void loadTokens(revision);}
    }catch(error){if(revision===epoch)$('#pk-token-preview').textContent=error.message;}finally{$('#pk-token-submit').disabled=false;}
  });
  $('#pk-manage').addEventListener('click',async()=>{
    const revision=epoch;$('#pk-devices').replaceChildren();
    try{const {devices}=await api('/api/passkey/devices');if(revision!==epoch)return;
      for(const d of devices){const item=document.createElement('p');item.textContent=d.label+(d.backed_up?' · Synced passkey':' · Device passkey')+' · Last used '+new Date(d.last_used||d.created_at).toLocaleString();$('#pk-devices').append(item);}
      const note=document.createElement('p');note.className='field-hint';note.textContent='A synced passkey may exist on more than one device. This list shows credentials, not physical devices. Adding or removing a wallet key is unavailable until wallet activation. Account recovery beyond an authorized passkey is not available.';$('#pk-devices').append(note);
    }catch(error){if(revision===epoch)$('#pk-devices').textContent=error.message;}
  });
  $('#wallet-button').addEventListener('click',event=>{if(account){event.stopImmediatePropagation();$('#landing').hidden=true;$('#profile-area').hidden=true;$('#conversations').hidden=true;$('#passkey-home').hidden=false;$('#pk-title').focus();}},true);
  async function openPayment(intent){
    if(!account)throw Error('Sign in with your passkey.');
    const owner=account.id;await setAccount(account,true);if(account?.id!==owner)throw Error('Your session changed.');
    if($('#pk-send').disabled)throw Error('Sending is currently unavailable. Check Wallet before continuing.');
    paymentIntent=intent;$('#landing').hidden=true;$('#profile-area').hidden=true;$('#conversations').hidden=true;$('#passkey-home').hidden=false;
    $('#pk-send-form').hidden=false;$('#pk-recipient').value=intent.recipient;$('#pk-recipient').readOnly=true;
    const units=BigInt(intent.units);$('#pk-amount').value=(units/10n**18n).toString()+'.'+(units%10n**18n).toString().padStart(18,'0');$('#pk-amount').readOnly=true;
    const tokenOption=[...$('#pk-send-token').options].find(o=>o.value.toLowerCase()===intent.transaction.to.toLowerCase());
    if(!tokenOption)throw Error('NS transfers are currently unavailable. Check Wallet before continuing.');
    $('#pk-send-token').value=tokenOption.value;$('#pk-send-token').disabled=true;
    $('#pk-send-form').requestSubmit();
  }
  return {open,setAccount,openPayment};
}
