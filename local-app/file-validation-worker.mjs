import {parentPort,workerData} from 'node:worker_threads';
import sharp from 'sharp';
import {fileTypeFromBuffer} from 'file-type';
import yauzl from 'yauzl';
import {PDFDocument,PDFDict,PDFName} from 'pdf-lib';
import {XMLValidator,XMLParser} from 'fast-xml-parser';
sharp.cache(false);sharp.concurrency(1);
const invalid=()=>{throw Error('This file is invalid, unsupported or contains unsafe active content.');};
const utf8=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
async function office(bytes,ext){
 const zip=await new Promise((yes,no)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?no(e):yes(z)));
 let total=0,count=0;const entries=new Map();
 await new Promise((resolve,reject)=>{
  zip.on('error',reject);zip.on('end',resolve);
  zip.on('entry',entry=>{(async()=>{
   if(++count>512||entry.generalPurposeBitFlag&1||((entry.externalFileAttributes>>>16)&0xf000)===0xa000||(total+=entry.uncompressedSize)>20*1024*1024||entry.uncompressedSize>8*1024*1024||entries.has(entry.fileName))invalid();
   const name=entry.fileName;
   if(name.endsWith('/')){zip.readEntry();return;}
   if(!/^(\[Content_Types\]\.xml|(?:_rels|docProps|word|xl)\/[a-zA-Z0-9_./ -]+)$/.test(name)||/\.\.|(?:vba|macros|activeX|embeddings|externalLinks)/i.test(name)||! /\.(xml|rels|png|jpe?g|webp|gif)$/i.test(name))invalid();
   const stream=await new Promise((yes,no)=>zip.openReadStream(entry,(e,s)=>e?no(e):yes(s)));const chunks=[];let size=0;
   for await(const chunk of stream){if((size+=chunk.length)>8*1024*1024)invalid();chunks.push(chunk);}const data=Buffer.concat(chunks);
   if(/\.(xml|rels)$/.test(name)){
    const xml=utf8(data);if(/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|TargetMode\s*=\s*["']External|\bDDE(?:AUTO)?\b/i.test(xml)||XMLValidator.validate(xml)!==true)invalid();
    const parsed=new XMLParser({ignoreAttributes:false}).parse(xml);
    const inspect=value=>{if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){if(key==='@_TargetMode'&&String(item).toLowerCase()!=='internal')invalid();inspect(item);}};inspect(parsed);
    entries.set(name,xml);
   }else{const type=await fileTypeFromBuffer(data);if(!['png','jpg','webp','gif'].includes(type?.ext))invalid();entries.set(name,'image');}
   zip.readEntry();
  })().catch(e=>{zip.close();reject(e);});});zip.readEntry();
 });
 const main=ext==='docx'?'word/document.xml':'xl/workbook.xml';
 if(!entries.has('[Content_Types].xml')||!entries.has('_rels/.rels')||!entries.has(main))invalid();
 if(!entries.get('[Content_Types].xml').includes(ext==='docx'?'wordprocessingml.document.main+xml':'spreadsheetml.sheet.main+xml'))invalid();
 if(ext==='docx'&&!/<w:document\b/.test(entries.get(main)))invalid();
 if(ext==='xlsx'&&!/<(?:\w+:)?workbook\b/.test(entries.get(main)))invalid();
 return bytes;
}
async function validate(){
 const {input,avatar}=workerData;
 if(!input||typeof input.name!=='string'||input.name.length>255||typeof input.data!=='string'||input.data.length>Math.ceil((avatar?1048576:5242880)/3)*4||/[^A-Za-z0-9+/=]/.test(input.data))invalid();
 let bytes=Buffer.from(input.data,'base64');if(bytes.toString('base64')!==input.data||!bytes.length||bytes.length>(avatar?1048576:5242880))invalid();
 let ext=input.name.split('.').at(-1).toLowerCase();if(ext==='jpeg')ext='jpg';
 if(!(avatar?['jpg','png','webp']:['jpg','png','webp','gif','pdf','txt','csv','docx','xlsx']).includes(ext))invalid();
 const detected=await fileTypeFromBuffer(bytes);let mime;
 if(['jpg','png','webp','gif'].includes(ext)){
  if(detected?.ext!==ext)invalid();
  const image=sharp(bytes,{failOn:'warning',limitInputPixels:16000000,animated:!avatar});const meta=await image.metadata();
  if((meta.pages||1)>100||meta.width*meta.height>16000000)invalid();
  bytes=avatar?await image.rotate().resize(256,256,{fit:'cover',position:'centre'}).webp({quality:80}).toBuffer():await image.toFormat(ext==='jpg'?'jpeg':ext).toBuffer();
  if(avatar)ext='webp';mime='image/'+(ext==='jpg'?'jpeg':ext);
 }else if(ext==='pdf'){
  if(detected?.ext!=='pdf')invalid();const doc=await PDFDocument.load(bytes,{ignoreEncryption:false,throwOnInvalidObject:true});
  if(doc.getPageCount()>500)invalid();
  const inspect=(object,seen=new Set())=>{if(!object||seen.has(object))return;seen.add(object);if(object instanceof PDFDict){for(const [key,value]of object.entries()){if(['/JS','/JavaScript','/Launch','/EmbeddedFiles','/EmbeddedFile','/Filespec','/RichMedia','/XFA','/AA','/OpenAction'].includes(key.toString())||value instanceof PDFName&&['/JavaScript','/Launch','/EmbeddedFile','/Filespec'].includes(value.toString()))invalid();inspect(value,seen);}}else if(object.dict)inspect(object.dict,seen);else if(typeof object.asArray==='function')for(const value of object.asArray())inspect(value,seen);};
  for(const [,object]of doc.context.enumerateIndirectObjects())inspect(object);
  bytes=Buffer.from(await doc.save());mime='application/pdf';
 }else if(ext==='docx'||ext==='xlsx'){
  if(!['zip',ext].includes(detected?.ext))invalid();bytes=await office(bytes,ext);mime=ext==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 }else{
  if(detected)invalid();const text=utf8(bytes);
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)||/^\s*(?:#!|<\?php|<!doctype\s+html|<html|<script|<svg|@echo\s+off)/i.test(text))invalid();
  if(ext==='csv'&&/(?:^|[,;\t\r\n])\s*"?[=+@]/.test(text))invalid();mime=ext==='csv'?'text/csv':'text/plain';
 }
 if(bytes.length>5242880)invalid();return {bytes,ext,mime};
}
try{parentPort.postMessage({result:await validate()});}catch{parentPort.postMessage({error:'This file is invalid, unsupported, too complex or contains unsafe active content.'});}
