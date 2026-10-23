export function verificationIndicator(field){
 const box=document.createElement('span');box.className='verification-indicator'+(field.verified?' is-verified':'');
 const label=document.createElement('span');label.textContent=field.name+' — '+field.percent+'%'+(field.verified?' VERIFIED':'');box.append(label);
 if(field.verified){const badge=document.createElement('span');badge.className='verification-badge';badge.textContent='✓';badge.setAttribute('aria-label','Community verified');box.append(badge);}
 else{const bar=document.createElement('progress');bar.max=100;bar.value=field.percent;bar.setAttribute('aria-label',field.name+' community verification');box.append(bar);}
 return box;
}
export function renderVerification(host,fields){host.replaceChildren();for(const field of fields||[])host.append(verificationIndicator(field));}
export function adminVerification(api,memberId){
 const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');summary.textContent='Community verification';details.append(summary,body);let loaded=false;
 details.addEventListener('toggle',async()=>{if(!details.open||loaded)return;loaded=true;body.textContent='Loading verification…';try{
  const result=await api('/api/admin/verification?member='+encodeURIComponent(memberId));body.replaceChildren();
  const date=n=>n?new Date(n).toLocaleString('en-GB'):'Not achieved';
  for(const field of result.fields){const row=document.createElement('section');row.className='verification-admin-field';row.append(verificationIndicator(field));const info=document.createElement('p');info.className='field-hint';info.textContent=`${field.active?'Active':'Removed from profile'} · ${field.net} net points · ${field.positive} positive / ${field.negative} negative votes. ${field.dateSource==='migration_observation'?'First observed (original date unknown)':'Originally added'}: ${date(field.firstSeen)}. Voting eligibility: ${field.waiting?'Waiting until '+date(field.waitingUntil):'Ready'}. First achieved: ${date(field.achievedAt)}.`;row.append(info);body.append(row);}
  if(!result.fields.length)body.textContent='No profile topics registered.';
  const history=document.createElement('div');body.append(history);
  const appendEvents=data=>{for(const event of data.events){const p=document.createElement('p');p.className='field-hint';p.textContent=`${date(event.occurredAt)} · ${event.name} · ${event.previousValue} → ${event.value} · ${event.counted?'Counted':'Not counted'} · ${event.reason} · Debate contribution ${event.messageId}`;history.append(p);}if(data.nextBefore){const button=document.createElement('button');button.type='button';button.className='login';button.textContent='Earlier history';button.onclick=async()=>{button.disabled=true;try{const page=await api('/api/admin/verification?member='+encodeURIComponent(memberId)+'&before='+data.nextBefore);button.remove();appendEvents(page);}catch(e){button.disabled=false;button.textContent='Retry history';}};history.append(button);}};appendEvents(result);
 }catch(error){loaded=false;body.textContent=error.message;}});return details;
}
