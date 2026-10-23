import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {PDFDocument,PDFName,PDFString} from 'pdf-lib';
import {crc32} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {validateUpload,fileMetadata,readFileForAccount} from '../content-files.mjs';
import {createApp} from './database.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
import {prepareAction,submitAction} from '../actions.mjs';
import {readCategories} from '../profiles.mjs';
import {readThread} from '../threads.mjs';
import {library} from '../member-tools.mjs';
import {expireQuestions,QUESTION_LIFETIME,acceptedAnswers} from '../lifecycle.mjs';
const upload=(name,bytes)=>({name,data:Buffer.from(bytes).toString('base64')});
// Small valid ZIP fixtures. No extraction or file system writes.
function zip(entries){let offset=0;const local=[],central=[];for(const [name,value]of Object.entries(entries)){
 const n=Buffer.from(name),b=Buffer.from(value),h=Buffer.alloc(30),c=Buffer.alloc(46),crc=crc32(b);
 h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
 local.push(h,n,b);central.push(c,n);offset+=h.length+n.length+b.length;
 }const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
const office=ext=>({'[Content_Types].xml':`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${ext==='docx'?'word/document.xml':'xl/workbook.xml'}" ContentType="application/vnd.openxmlformats-officedocument.${ext==='docx'?'wordprocessingml.document':'spreadsheetml.sheet'}.main+xml"/></Types>`,'_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',[ext==='docx'?'word/document.xml':'xl/workbook.xml']:ext==='docx'?'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'});
test('Real type validation, 256 square avatar, allowed attachment formats and safe generated names',async()=>{
 for(const ext of ['jpg','png','webp','gif']){
  const bytes=await sharp({create:{width:400,height:200,channels:3,background:'#55c9f4'}}).toFormat(ext==='jpg'?'jpeg':ext).toBuffer();
  const f=await validateUpload(upload('picture.'+ext,bytes));assert.equal(f.ext,ext);assert.match(f.name,/^[a-f0-9-]{36}\./);
  if(ext!=='gif'){const a=await validateUpload(upload('picture.'+ext,bytes),true);const meta=await sharp(a.bytes).metadata();assert.equal(meta.width,256);assert.equal(meta.height,256);assert.equal(meta.format,'webp');assert(!meta.exif);}
 }
 for(const ext of ['docx','xlsx'])assert.equal((await validateUpload(upload('document.'+ext,zip(office(ext))))).ext,ext);
 const pdf=await PDFDocument.create();pdf.addPage();assert.equal((await validateUpload(upload('paper.pdf',await pdf.save()))).mime,'application/pdf');
 for(const [name,text]of [['note.txt','A normal note.'],['table.csv','name,value\nSample,12']])assert((await validateUpload(upload(name,text))).bytes.length);
});
test('Reject forged types, unsafe formats, malformed documents, ZIPs, active content and oversize uploads',async()=>{
 for(const [name,data]of [['image.png','not an image'],['note.txt',Buffer.from([0x4d,0x5a,0,1])],['page.txt','<script>alert(1)</script>'],['script.js','alert(1)'],['archive.zip',zip(office('docx'))],['fake.docx',zip({'notes.txt':'hello'})],['evil.csv','name,value\nTest,=cmd()'],['broken.pdf','%PDF-1.7\ninvalid']])await assert.rejects(validateUpload(upload(name,data)),e=>e.status===400);
 for(const extra of [{'word/vbaProject.bin':'macro'},{'word/_rels/document.xml.rels':'<Relationships><Relationship TargetMode="&#69;xternal" Target="http://example.com"/></Relationships>'},{'../escape.xml':'<x/>'}])await assert.rejects(validateUpload(upload('bad.docx',zip({...office('docx'),...extra}))));
 const doc=await PDFDocument.create();doc.addPage();doc.catalog.set(PDFName.of('OpenAction'),doc.context.obj({S:'JavaScript',JS:PDFString.of('app.alert(1)')}));await assert.rejects(validateUpload(upload('active.pdf',await doc.save())));
 await assert.rejects(validateUpload(upload('large.txt',Buffer.alloc(5*1024*1024+1,65))));await assert.rejects(validateUpload(upload('large.png',Buffer.alloc(1024*1024+1)),true));
 assert.equal((await validateUpload(upload('limit.txt',Buffer.alloc(5*1024*1024,65)))).bytes.length,5*1024*1024);
});
async function fixture(t){const key='files-'+randomUUID();let app=await createApp({database:key});t.after(()=>app.db.close());const db=app.db,now=Date.now();const accounts=[1,2,3].map(n=>({address:'0x'+String(n).padStart(40,'0'),role:'member',method:'passkey'}));
 for(const [i,a]of accounts.entries()){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(a.address,now);await saveProfile(db,a.address,{nickname:'Member '+i,work:[i===2?'Other':'Files'],hobbies:[]},now);}
 const category=(await readCategories(db)).work.find(c=>c.name==='Files').id;
 const post=async(a,path,payload,time=now)=>{const c=await prepareAction(db,a,'session',path,payload,'https://example.com',time);const result=await submitAction(db,a,'session',path,{actionId:c.id,response:{}},time+1,async()=>{});return {c,result};};
 return {db,accounts,now,category,post,async restart(){await app.db.close();app=await createApp({database:key});return app.db;}};
}
test('Attachment signed binding, access control, snapshots, expiration, restart and final reference cleanup',async t=>{
 const f=await fixture(t),{db,accounts:[a,b,other],now,category,post}=f;
 const {c,result:q}=await post(a,'/api/questions',{body:'Question',categoryIds:[category],attachment:upload('note.txt','Question attachment')});
 assert.match(c.message,/SHA-256: [a-f0-9]{64}/);const questionFile=(await fileMetadata(db,'question',q.id))[0];assert(questionFile);
 const repeated=await post(a,'/api/questions',{body:'Question',categoryIds:[category],attachment:upload('note.txt','Question attachment')});assert.equal(repeated.result.id,q.id);
 await assert.rejects(readFileForAccount(db,null,questionFile.id),e=>e.status===401);await assert.rejects(readFileForAccount(db,other,questionFile.id),e=>e.status===404);
 assert.equal((await readFileForAccount(db,b,questionFile.id)).bytes.toString(),'Question attachment');
 await post(b,'/api/questions/'+q.id+'/replies',{body:'Answer',attachment:upload('answer.txt','Answer attachment')});const thread=await readThread(db,a,q.id),reply=thread.replies[0];assert.equal(reply.attachments.length,1);
 await library(db,a,{action:'save',replyId:reply.id,version:1});assert.equal((await library(db,a,null)).items[0].attachments.length,2);
 // Cleanup of the existing signed-message staging never deletes published files.
 await db.prepare('DELETE FROM signed_actions').run();assert(await readFileForAccount(db,b,questionFile.id));
 await expireQuestions(db,now+QUESTION_LIFETIME+1);await assert.rejects(readFileForAccount(db,b,questionFile.id),e=>e.status===404);assert(await readFileForAccount(db,a,questionFile.id));
 assert.equal((await acceptedAnswers(db,new URLSearchParams())).answers[0].attachments.length,2);
 const reopened=await f.restart();assert(await readFileForAccount(reopened,a,questionFile.id));
 await library(reopened,a,{action:'remove',replyId:reply.id});await assert.rejects(readFileForAccount(reopened,a,questionFile.id));assert(await readFileForAccount(reopened,{...a,role:'admin'},questionFile.id));
 // Simulate final deletion of every owning copy, not the normal soft-delete path.
 await reopened.prepare('DELETE FROM content_file_links WHERE file_id=$1').run(questionFile.id);assert.equal(await reopened.prepare('SELECT id FROM content_files WHERE id=$1').get(questionFile.id),undefined);
});
test('Abandoned staging is removed by signed-action expiry and avatar replacement is atomic',async t=>{
 const {db,accounts:[a],category,now}=await fixture(t);
 const c=await prepareAction(db,a,'session','/api/questions',{body:'Unsent',categoryIds:[category],attachment:upload('draft.txt','Draft')},'https://example.com',now);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM content_files').get()).n,1);await db.prepare('DELETE FROM signed_actions WHERE id=$1').run(c.id);assert.equal((await db.prepare('SELECT count(*) AS n FROM content_files').get()).n,0);
 const bytes=await sharp({create:{width:40,height:80,channels:3,background:'red'}}).png().toBuffer();const input={nickname:'Picture',work:['Files'],hobbies:[],avatar:upload('avatar.png',bytes)};
 const first=await saveProfile(db,a.address,input,now);assert(first.avatar);await saveProfile(db,a.address,input,now+1);assert.equal((await db.prepare('SELECT count(*) AS n FROM content_files').get()).n,1);
 await assert.rejects(saveProfile(db,a.address,{...input,nickname:'Invalid',avatar:upload('bad.png','bad')},now+2));assert.equal((await readProfile(db,a.address)).nickname,'Picture');assert.equal((await db.prepare('SELECT count(*) AS n FROM content_files').get()).n,1);
});
