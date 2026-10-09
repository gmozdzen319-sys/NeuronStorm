const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const encode=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
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

export function createPasskeyUI({api,onExternal,onAccount}){
  const $=s=>document.querySelector(s),dialog=$('#auth-dialog');let busy=false,legal=null,epoch=0,account=null,transfer=null,receiveAddress=null,sending=false;
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
  async function setAccount(next,force=false){
    if(!force&&account?.id===next?.id&&account?.method===next?.method)return;
    const revision=++epoch;account=next?.method==='passkey'?next:null;
    transfer=null;receiveAddress=null;$('#pk-wallet-address').textContent='';$('#pk-quai-balance').textContent='Not available';$('#pk-receive').disabled=true;$('#pk-send').disabled=true;
    $('#pk-transfers').replaceChildren();
    $('#pk-receive-panel').hidden=true;$('#pk-receive-address').textContent='';$('#pk-receive-qr').removeAttribute('src');$('#pk-send-form').hidden=true;$('#pk-recipient').value='';$('#pk-amount').value='';$('#pk-send-review').hidden=true;$('#pk-send-status').textContent='';
    preview=null;$('#pk-id').textContent='';$('#pk-token-address').value='';$('#pk-token-preview').textContent='';$('#pk-token-submit').textContent='Review token';
    $('#passkey-home').hidden=!account;$('#pk-tokens').replaceChildren();$('#pk-devices').replaceChildren();$('#pk-status').textContent='';$('#pk-token-form').hidden=true;
    if(!account)return;
    $('#pk-id').textContent=account.id;$('#pk-status').textContent='Loading your account…';
    try{const state=await api('/api/passkey/wallet');if(revision!==epoch)return;
      $('#pk-status').textContent=state.reason;
      $('#pk-wallet-title').textContent=state.status==='active'?'Your personal wallet':'Wallet setup';
      $('#pk-wallet-address').textContent=state.address||'';$('#pk-quai-balance').textContent=state.quaiBalance??'Not available';$('#pk-receive').disabled=!state.receiveAvailable;$('#pk-send').disabled=!state.sendAvailable;
      const states={awaiting_confirmation:'Awaiting confirmation',verifying:'Checking confirmation',authorized:'Awaiting submission',submitting:'Submitted · awaiting verification',confirmed:'Confirmed',failed:'Failed',stopped:'Stopped'};
      for(const transfer of state.transfers||[]){const item=document.createElement('p');item.className='address';item.textContent=(states[transfer.phase]||'Needs review')+(transfer.tx_hash?' · '+transfer.tx_hash:'');$('#pk-transfers').append(item);}
      for(const token of state.tokens){const item=document.createElement('div');item.className='pk-token';const title=document.createElement('strong'),detail=document.createElement('p');title.textContent=token.symbol+' · '+token.name;detail.textContent=token.contract;detail.className='address';item.append(title,detail);$('#pk-tokens').append(item);}
    }catch(error){if(revision===epoch)$('#pk-status').textContent=error.message;}
  }
  let preview=null;
  $('#pk-refresh').addEventListener('click',()=>{if(!sending)setAccount(account,true);});
  $('#pk-receive').addEventListener('click',async()=>{const revision=epoch;$('#pk-receive').disabled=true;
    try{const r=await api('/api/passkey/wallet/receive');if(revision!==epoch)return;receiveAddress=r.address;$('#pk-receive-address').textContent=r.address;$('#pk-receive-qr').src=r.qr;$('#pk-receive-panel').hidden=false;}
    catch(error){if(revision===epoch)$('#pk-status').textContent=error.message;}finally{if(revision===epoch)$('#pk-receive').disabled=false;}
  });
  $('#pk-copy').addEventListener('click',async()=>{if(!receiveAddress)return;try{await navigator.clipboard.writeText(receiveAddress);$('#pk-status').textContent='Address copied.';}catch{$('#pk-status').textContent='Select and copy the address above.';}});
  $('#pk-send').addEventListener('click',()=>{$('#pk-send-form').hidden=false;$('#pk-recipient').focus();});
  for(const id of ['#pk-recipient','#pk-amount'])$(id).addEventListener('input',()=>{transfer=null;$('#pk-send-review').hidden=true;});
  $('#pk-send-form').addEventListener('submit',async event=>{event.preventDefault();if(sending)return;const revision=epoch;sending=true;$('#pk-review-button').disabled=true;$('#pk-send-status').textContent='Preparing…';
    try{const r=await api('/api/passkey/wallet/send/prepare',{recipient:$('#pk-recipient').value.trim(),amount:$('#pk-amount').value.trim()});if(revision!==epoch)return;transfer=r;
      $('#pk-review-text').textContent=`Send ${r.review.amount} QUAI\nFrom: ${r.review.wallet}\nTo: ${r.review.recipient}\n${r.review.network}\nMaximum network fee: ${r.review.maximumFee} QUAI · paid by ${r.review.feePaidBy}`;
      $('#pk-send-review').hidden=false;$('#pk-confirm').disabled=false;$('#pk-send-status').textContent='Awaiting confirmation. Review the recipient and amount carefully.';
    }catch(error){if(revision===epoch)$('#pk-send-status').textContent=error.message;}finally{sending=false;if(revision===epoch)$('#pk-review-button').disabled=false;}
  });
  $('#pk-confirm').addEventListener('click',async()=>{if(!transfer||sending)return;const request=transfer,revision=epoch;transfer=null;sending=true;$('#pk-confirm').disabled=true;$('#pk-review-button').disabled=true;
    try{$('#pk-send-status').textContent='Awaiting confirmation on your device…';const response=await deviceResponse('login',request.options);if(revision!==epoch)return;
      $('#pk-send-status').textContent='Submitting…';const result=await api('/api/passkey/wallet/send/confirm',{id:request.id,response});if(revision!==epoch)return;
      $('#pk-send-status').textContent=result.status==='confirmed'?'Confirmed. Transaction: '+result.transactionHash:result.status==='failed'?'Failed. No automatic retry will be sent.':'Stopped or still being checked. Do not send again.';
    }catch(error){if(revision===epoch){$('#pk-send-status').textContent=error.name==='NotAllowedError'?'Confirmation cancelled or expired. No automatic retry will be sent.':error.message;
      // Read-only status lookup after an uncertain HTTP response; never repeat POST.
      try{const s=await api('/api/passkey/wallet/send/'+request.id);if(revision===epoch&&s.transactionHash)$('#pk-send-status').textContent=(s.status==='confirmed'?'Confirmed. ':'Check this transaction before sending again. ')+s.transactionHash;}catch{}
    }}finally{sending=false;if(revision===epoch)$('#pk-review-button').disabled=false;}
  });
  $('#pk-add-token').addEventListener('click',()=>{$('#pk-token-form').hidden=false;$('#pk-token-address').focus();});
  $('#pk-token-address').addEventListener('input',()=>{preview=null;$('#pk-token-submit').textContent='Review token';$('#pk-token-preview').textContent='';});
  $('#pk-token-form').addEventListener('submit',async event=>{
    event.preventDefault();const revision=epoch;$('#pk-token-submit').disabled=true;
    try{
      if(!preview){const result=await api('/api/passkey/wallet/token-preview',{contract:$('#pk-token-address').value.trim()});if(revision!==epoch)return;preview=result;
        $('#pk-token-preview').textContent=result.name+' ('+result.symbol+') · '+result.decimals+' decimals · '+result.contract+'\nToken names and symbols do not establish trust. Verify the contract independently.';$('#pk-token-submit').textContent='Add token';
      }else{await api('/api/passkey/wallet/tokens',preview);if(revision!==epoch)return;preview=null;$('#pk-token-submit').textContent='Review token';await setAccount(account,true);}
    }catch(error){if(revision===epoch)$('#pk-token-preview').textContent=error.message;}finally{$('#pk-token-submit').disabled=false;}
  });
  $('#pk-manage').addEventListener('click',async()=>{
    const revision=epoch;$('#pk-devices').replaceChildren();
    try{const {devices}=await api('/api/passkey/devices');if(revision!==epoch)return;
      for(const d of devices){const item=document.createElement('p');item.textContent=d.label+(d.backed_up?' · Synced passkey':' · Device passkey')+' · Last used '+new Date(d.last_used||d.created_at).toLocaleString();$('#pk-devices').append(item);}
      const note=document.createElement('p');note.className='field-hint';note.textContent='A synced passkey may exist on more than one device. This list shows credentials, not physical devices. Adding or removing a wallet key is unavailable until wallet activation. Account recovery beyond an authorized passkey is not available.';$('#pk-devices').append(note);
    }catch(error){if(revision===epoch)$('#pk-devices').textContent=error.message;}
  });
  $('#wallet-button').addEventListener('click',event=>{if(account){event.stopImmediatePropagation();$('#passkey-home').hidden=false;$('#pk-title').focus();}},true);
  return {open,setAccount};
}
