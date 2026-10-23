export async function selectedFile(input,avatar=false){
 const file=input?.files?.[0];if(!file)return null;
 const limit=(avatar?1:5)*1024*1024,extension=file.name.split('.').at(-1).toLowerCase();
 if(file.size>limit)throw Error(`Choose a file no larger than ${avatar?1:5} MB.`);
 if(!(avatar?['jpg','jpeg','png','webp']:['jpg','jpeg','png','webp','gif','pdf','txt','csv','docx','xlsx']).includes(extension))throw Error('Choose one of the supported file types.');
 const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Unable to read this file.'));reader.readAsDataURL(file);});
 return {name:file.name,data};
}
export function appendAttachments(host,files){
 if(!files?.length)return;
 for(const file of files){const link=document.createElement('a');link.className='content-attachment';link.href='/api/files/'+encodeURIComponent(file.id);link.download=file.name;link.textContent='Download '+file.name.split('.').at(-1).toUpperCase()+' attachment · '+Math.max(1,Math.ceil(file.size/1024))+' KB';host.append(link);}
}
export function appendAvatar(host,file,large=false){
 if(!file)return;const image=document.createElement('img');image.src='/api/files/'+encodeURIComponent(file.id);image.alt='';image.className='profile-avatar'+(large?' profile-avatar--large':'');image.width=image.height=large?96:32;image.loading='lazy';host.prepend(image);
}
