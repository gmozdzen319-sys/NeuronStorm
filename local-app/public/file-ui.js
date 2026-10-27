import {renderVerification} from './verification-ui.js';
export async function selectedFile(input,avatar=false){
 const file=input?.files?.[0];if(!file)return null;
 const limit=(avatar?1:10)*1024*1024,extension=file.name.split('.').at(-1).toLowerCase();
 if(file.size>limit)throw Error(`Choose a file no larger than ${avatar?1:10} MB.`);
 if(!(avatar?['jpg','jpeg','png','webp']:['jpg','jpeg','png','webp','gif','pdf','txt','csv','docx','xlsx']).includes(extension))throw Error('Choose one of the supported file types.');
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Unable to read this file.'));reader.readAsDataURL(file);});
 return {name:file.name,data};
}
export function appendAttachments(host,files){
 if(!files?.length)return;
 for(const file of files){const link=document.createElement('a');link.className='content-attachment';link.href='/api/files/'+encodeURIComponent(file.id);link.download=file.name;link.textContent='Download '+file.name.split('.').at(-1).toUpperCase()+' attachment · '+Math.max(1,Math.ceil(file.size/1024))+' KB';host.append(link);}
}
export function appendAvatar(host,file,large=false){
 if(!file){const placeholder=document.createElement('span');placeholder.className='profile-avatar avatar-placeholder'+(large?' profile-avatar--large':'');placeholder.setAttribute('aria-hidden','true');host.prepend(placeholder);return;}const image=document.createElement('img');image.src='/api/files/'+encodeURIComponent(file.id);image.alt='';image.className='profile-avatar'+(large?' profile-avatar--large':'');image.width=image.height=large?96:32;image.loading='lazy';host.prepend(image);
}

let profileApi,profileDialog,profileContent,profileRequest=0;
export function configurePublicProfiles(api){profileApi=api;}
export function closePublicProfile(){profileRequest++;profileDialog?.close();profileContent?.replaceChildren();}
export function memberProfileButton(name,avatar,questionId,kind='',id=''){
 const button=document.createElement('button');button.type='button';button.className='member-profile-link';button.setAttribute('aria-label','View profile: '+name);
 const label=document.createElement('strong');label.textContent=name;button.append(label);appendAvatar(button,avatar);
 button.onclick=async()=>{
  if(!profileApi)return;
  if(!profileDialog){profileDialog=document.createElement('dialog');profileDialog.className='member-profile-dialog';profileDialog.setAttribute('aria-label','Member profile');const close=document.createElement('button');close.type='button';close.className='text-button';close.textContent='Close ×';close.onclick=closePublicProfile;profileContent=document.createElement('div');profileContent.setAttribute('aria-live','polite');profileDialog.append(close,profileContent);document.body.append(profileDialog);profileDialog.addEventListener('cancel',closePublicProfile);}
  const request=++profileRequest;profileContent.textContent='Loading profile…';if(!profileDialog.open)profileDialog.showModal();
  try{const {profile:p}=await profileApi('/api/questions/'+encodeURIComponent(questionId)+'/member-profile'+(kind?'?'+kind+'='+encodeURIComponent(id):''));if(request!==profileRequest||!profileDialog.open)return;
   const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};profileContent.replaceChildren();appendAvatar(profileContent,p.avatar,true);profileContent.append(node('h2',p.nickname));
   for(const [heading,items] of [['Work & Education',p.work],['Hobbies & Interests',p.hobbies]]){profileContent.append(node('h3',heading),node('p',items.map(t=>t.name).join(' · ')||'Not added'));}
   profileContent.append(node('p',p.points+' Reputation · '+p.activityPoints+' daily activity points'),node('h3','Verification'));const fields=node('div','');fields.className='verification-fields';renderVerification(fields,p.verification);profileContent.append(fields);
  }catch(error){if(request===profileRequest&&profileDialog.open)profileContent.textContent=error.message||'Profile could not be loaded.';}
 };return button;
}
