import {Worker} from 'node:worker_threads';
import {randomUUID,createHash} from 'node:crypto';
const fail=(status,message)=>Object.assign(Error(message),{status});
let active=0;
export async function validateUpload(input,avatar=false){
 if(active>=2)throw fail(503,'File processing is busy. Please try again shortly.');active++;
 try{return await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./file-validation-worker.mjs',import.meta.url),{workerData:{input,avatar},resourceLimits:{maxOldGenerationSizeMb:128}});
  const timer=setTimeout(()=>{worker.terminate();reject(fail(400,'File processing timed out. Please choose a simpler file.'));},15000);
  const done=()=>{clearTimeout(timer);worker.terminate();};
  worker.once('message',message=>{done();if(message.error)reject(fail(400,message.error));else{const bytes=Buffer.from(message.result.bytes),id=randomUUID();resolve({...message.result,bytes,id,name:id+'.'+message.result.ext,digest:createHash('sha256').update(bytes).digest('hex')});}});
  worker.once('error',()=>{done();reject(fail(400,'Unable to process this file.'));});
  worker.once('exit',code=>{if(code!==0){clearTimeout(timer);reject(fail(400,'Unable to process this file.'));}});
 });}finally{active--;}
}
export async function storeFile(db,owner,file,now){await db.prepare('INSERT INTO content_files(id,owner,name,mime,digest,bytes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)').run(file.id,owner.toLowerCase(),file.name,file.mime,file.digest,file.bytes,now);}
export async function linkAttachment(db,owner,fileId,kind,id){
 if(!fileId)return;if(!['question_id','reply_id'].includes(kind))throw Error('Invalid attachment parent');
 const f=await db.prepare('SELECT id FROM content_files WHERE id=$1 AND owner=$2').get(fileId,owner.toLowerCase());if(!f)throw fail(400,'Attachment unavailable.');
 await db.prepare(`INSERT INTO content_file_links(file_id,${kind}) VALUES($1,$2)`).run(fileId,id);
 await db.prepare(`INSERT INTO content_file_links(file_id,archive_id) SELECT $1,id FROM conversation_archive WHERE ${kind==='question_id'?'question_id=$2 AND reply_id IS NULL':'reply_id=$2'} ON CONFLICT DO NOTHING`).run(fileId,id);
}
export async function fileMetadata(db,kind,id,owner){
 const fields={question:'question_id',reply:'reply_id',archive:'archive_id',accepted:'accepted_id',avatar:'avatar_owner',saved:'saved_reply'};
 if(!fields[kind])throw Error('Invalid file lookup');
 return db.prepare(`SELECT f.id,f.name,f.mime,octet_length(f.bytes) AS size FROM content_file_links l JOIN content_files f ON f.id=l.file_id WHERE l.${fields[kind]}=$1 ${kind==='saved'?'AND l.saved_owner=$2':''} ORDER BY f.id`).all(...(kind==='saved'?[id,owner]:[id]));
}
export async function readFileForAccount(db,account,id){
 if(!account)throw fail(401,'Please sign in to open this file.');
 const links=await db.prepare('SELECT * FROM content_file_links WHERE file_id=$1').all(id),owner=account.address.toLowerCase();let authorized=false,avatar=false;
 for(const link of links){
  if(link.avatar_owner){authorized=true;avatar=true;break;}
  if(link.saved_owner===owner){authorized=true;break;}
  if(account.role==='admin'&&(link.archive_id||link.accepted_id||link.question_id||link.reply_id)){authorized=true;break;}
  if(link.question_id||link.reply_id){const q=await db.prepare(`SELECT q.id FROM questions q ${link.reply_id?'JOIN replies r ON r.question_id=q.id':''} WHERE ${link.reply_id?'r.id=$1 AND r.deleted_at IS NULL':'q.id=$1'} AND q.deleted_at IS NULL AND q.closed_at IS NULL AND EXISTS(SELECT 1 FROM question_participants p WHERE p.question_id=q.id AND p.address=$2)`).get(link.reply_id||link.question_id,owner);if(q){authorized=true;break;}}
 }
 if(!authorized)throw fail(404,'This file is not available.');const file=await db.prepare('SELECT name,mime,bytes FROM content_files WHERE id=$1').get(id);if(!file)throw fail(404,'This file is not available.');return {...file,avatar};
}
