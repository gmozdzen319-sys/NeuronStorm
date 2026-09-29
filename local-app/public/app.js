import { connectWallet, signIn, walletError } from './wallet.js';
import { createConversations } from './conversations.js';
const $ = selector => document.querySelector(selector);
const login = $('#login'), logout = $('#logout'), status = $('#status'), form = $('#profile-form');
let busy = false, generation = 0, connectedAddress = null;
let currentAccount = null, profile = null, catalog = { work: [], hobbies: [] }, selected = { work: [], hobbies: [] };
let profileRevision = 0, saving = false, loading = false;
const key = name => name.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
function resetConnection() { connectedAddress = null; login.textContent = 'Sign in with Pelagus'; }
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Unable to reach the server.'), { httpStatus: response.status });
  return result;
}
function notice(message = '', error = false) { status.textContent = message; status.classList.toggle('error', error); }
function profileNotice(message = '', type = '') { const target=$('#profile-status'); target.textContent=message; target.className=type; }
function showProfile() {
  conversations.openProfile();
  $('#profile-eyebrow').textContent='YOUR CORNER OF NEURON STORM';
  $('#profile-title').textContent='My Profile';
  $('#profile-intro').textContent='Your experience, your interests, your next conversation.';
  form.hidden=true; $('#profile-view').hidden=false;
  $('#saved-nickname').textContent=profile.nickname;$('#saved-points').textContent='★ '+(profile.points||0)+(profile.points===1?' star':' stars');
  $('#saved-name').textContent=[profile.firstName,profile.lastName].filter(Boolean).join(' ');
  for(const kind of ['work','hobbies']) {
    const list=$('#saved-'+kind);list.replaceChildren();
    for(const {name} of profile[kind]) {const li=document.createElement('li');li.textContent=name;list.append(li);}
    $('#saved-'+kind+'-empty').hidden=!!profile[kind].length;
  }
}
function renderSelected(kind) {
  const list=$('#'+kind+'-selected');list.replaceChildren();
  for(const name of selected[kind]) {
    const li=document.createElement('li'), label=document.createElement('span'), button=document.createElement('button');
    label.textContent=name;button.type='button';button.textContent='×';button.setAttribute('aria-label','Remove '+name);
    button.addEventListener('click',()=>{selected[kind]=selected[kind].filter(item=>key(item)!==key(name));renderSelected(kind);$('#'+kind+'-input').focus();});
    li.append(label,button);list.append(li);
  }
  $('#'+kind+'-empty').hidden=!!selected[kind].length;
}
function fillOptions() {
  for(const kind of ['work','hobbies']) {
    const list=$('#'+kind+'-options');list.replaceChildren();
    for(const {name} of catalog[kind]){const option=document.createElement('option');option.value=name;list.append(option);}
  }
}
function showEditor() {
  $('#profile-eyebrow').textContent=profile?'KEEP YOUR PROFILE UP TO DATE':'MAKE YOURSELF AT HOME';
  $('#profile-title').textContent=profile?'Edit your profile':'Create your profile';
  $('#profile-intro').textContent='A little about you and the topics you care about.';
  $('#profile-view').hidden=true;form.hidden=false;
  $('#cancel-edit').hidden=!profile;
  $('#save-profile').textContent=profile?'Save changes':'Save profile';
  $('#nickname').value=profile?.nickname||'';$('#first-name').value=profile?.firstName||'';$('#last-name').value=profile?.lastName||'';
  $('#nickname').removeAttribute('aria-invalid');
  for(const kind of ['work','hobbies']) {selected[kind]=(profile?.[kind]||[]).map(item=>item.name);$('#'+kind+'-input').value='';renderSelected(kind);}
  fillOptions();
}
async function loadProfile() {
  if (!currentAccount || loading) return;
  const revision=++profileRevision;loading=true;
  form.hidden=true;$('#profile-view').hidden=true;$('#retry-profile').hidden=true;
  profileNotice('Loading your profile…');
  try {
    const [saved,topics]=await Promise.all([api('/api/profile'),api('/api/categories')]);
    if(revision!==profileRevision)return;
    profile=saved.profile;catalog=topics.categories;profileNotice();
    if(profile)conversations.setIdentity(currentAccount,profile,true);else showEditor();
  } catch(error) {
    if(revision!==profileRevision)return;
    if(error.httpStatus===401){await renderSession(null);notice('Your session has expired. Please sign in again.',true);}
    else {profileNotice('Unable to load your profile. Please try again.','error');$('#retry-profile').hidden=false;}
  } finally {if(revision===profileRevision)loading=false;}
}
async function renderSession(account) {
  const changed=currentAccount?.address?.toLowerCase()!==account?.address?.toLowerCase();
  currentAccount=account;
  login.hidden=!!account;logout.hidden=!account;if(changed||!account)$('#landing').hidden=!!account;if(changed||!account)$('#profile-area').hidden=!account;
  $('#address').textContent=account?.address||'';$('#role').textContent=account?.role==='admin'?'Administrator':'';
  if(!account){conversations.clear();profileRevision++;loading=false;profile=null;selected={work:[],hobbies:[]};form.reset();form.hidden=true;$('#profile-view').hidden=true;for(const kind of ['work','hobbies']){$('#saved-'+kind).replaceChildren();$('#'+kind+'-selected').replaceChildren();}$('#saved-nickname').textContent='';$('#saved-name').textContent='';profileNotice();return;}
  if(changed) {await loadProfile();if(!profile)$('#profile-title').focus();}
}
function addTopic(kind) {
  const input=$('#'+kind+'-input'), name=input.value.trim().replace(/\s+/gu,' ');
  if(!name){profileNotice('Enter a topic or choose one from the suggestions.','error');input.focus();return false;}
  if(name.length>60){profileNotice('Topic names must be 60 characters or fewer.','error');input.focus();return false;}
  const canonical=catalog[kind].find(item=>key(item.name)===key(name))?.name||name;
  if(selected[kind].some(item=>key(item)===key(canonical))){input.value='';profileNotice('That topic is already selected.');return true;}
  if(selected[kind].length>=20){profileNotice('You can choose up to 20 topics in each group.','error');return false;}
  selected[kind].push(canonical);input.value='';renderSelected(kind);profileNotice();input.focus();return true;
}
for(const kind of ['work','hobbies']) {
  $('#'+kind+'-add').addEventListener('click',()=>addTopic(kind));
  $('#'+kind+'-input').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();addTopic(kind);}});
}
$('#edit-profile').addEventListener('click',async()=>{
  profileNotice();showEditor();$('#nickname').focus();
  const revision=profileRevision;
  try{const result=await api('/api/categories');if(revision===profileRevision){catalog=result.categories;fillOptions();}}catch{profileNotice('Suggestions could not be refreshed. You can still type a topic.','error');}
});
$('#cancel-edit').addEventListener('click',()=>{profileNotice();showProfile();});
$('#retry-profile').addEventListener('click',loadProfile);
form.addEventListener('submit',async event=>{
  event.preventDefault();if(saving)return;
  profileNotice();
  const nickname=$('#nickname').value.trim();
  $('#nickname').setAttribute('aria-invalid',String(!nickname));
  if(!nickname){profileNotice('Please enter a nickname.','error');$('#nickname').focus();return;}
  for(const kind of ['work','hobbies'])if($('#'+kind+'-input').value.trim()&&!addTopic(kind))return;
  if(!selected.work.length&&!selected.hobbies.length){profileNotice('Choose at least one topic across Work & Education or Hobbies & Interests.','error');$('#work-input').focus();return;}
  const data={nickname,firstName:$('#first-name').value,lastName:$('#last-name').value,work:[...selected.work],hobbies:[...selected.hobbies]};
  const revision=profileRevision;
  saving=true;form.querySelectorAll('input,button').forEach(el=>el.disabled=true);$('#save-profile').textContent='Saving…';
  try {
    const result=await api('/api/profile',data);
    if(revision!==profileRevision)return;
    profile=result.profile;conversations.setIdentity(currentAccount,profile);showProfile();profileNotice('Your profile has been saved.','success');$('#profile-title').focus();
  } catch(error) {
    if(revision!==profileRevision)return;
    profileNotice(error.message||'Unable to save your profile. Your changes are still in the form.','error');
  } finally {
    saving=false;form.querySelectorAll('input,button').forEach(el=>el.disabled=false);$('#save-profile').textContent=profile?'Save changes':'Save profile';
  }
});
login.addEventListener('click',async()=>{
  if(busy)return;busy=true;login.disabled=true;
  const attempt=++generation;
  try {
    if(!connectedAddress){notice('Confirm the connection in Pelagus…');connectedAddress=await connectWallet(window.pelagus);login.textContent='Sign message & continue';notice('Wallet connected. You are not signed in yet. Click “Sign message & continue” to confirm your account with a one-time signature.');return;}
    const result=await signIn(window.pelagus,connectedAddress,api,notice);
    if(attempt!==generation){await api('/api/logout',{});return;}
    resetConnection();notice();await renderSession(result.account);
  }catch(error){resetConnection();notice(walletError(error),true);}
  finally{busy=false;login.disabled=false;}
});
logout.addEventListener('click',async()=>{
  logout.disabled=true;generation++;
  try{await api('/api/logout',{});resetConnection();await renderSession(null);notice('You have signed out.');}
  catch{notice('Unable to sign out. Check your connection and try again.',true);}
  finally{logout.disabled=false;}
});
async function walletChanged(){
  if(busy)return;resetConnection();generation++;
  try{await api('/api/logout',{});await renderSession(null);notice('Your wallet connection has changed. Please sign in again.');}
  catch{await renderSession(null);notice('Unable to end the session. Start the local server and click Sign out.',true);logout.hidden=false;}
}
window.pelagus?.on?.('accountsChanged',walletChanged);window.pelagus?.on?.('disconnect',walletChanged);window.pelagus?.on?.('chainChanged',walletChanged);
async function refresh(){
  if(busy||saving||loading)return;
  try{const result=await api('/api/session');const expired=currentAccount&&!result.account;await renderSession(result.account);if(expired)notice('Your session has expired. Please sign in again.',true);}
  catch{notice('Unable to reach the local server. Start Neuron Storm and refresh this page.',true);}
  finally{login.disabled=false;}
}
const conversations=createConversations({api,onProfile:async()=>{if(profile){profileNotice();showProfile();await refreshPoints();}},onExpired:async()=>{await renderSession(null);notice('Your session has expired. Please sign in again.',true);}});
await refresh();window.addEventListener('focus',refresh);setInterval(refresh,60000);

async function refreshPoints(){
  if(!currentAccount||!profile||$('#profile-area').hidden||$('#profile-view').hidden)return;
  const current=profileRevision;
  try{const result=await api('/api/profile');if(current!==profileRevision||!result.profile)return;profile.points=result.profile.points;$('#saved-points').textContent='★ '+profile.points+(profile.points===1?' star':' stars');}catch(error){if(error.httpStatus===401)await refresh();}
}
setInterval(()=>{if(!document.hidden)refreshPoints();},5000);
