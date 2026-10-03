import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {isIP} from 'node:net';
import {requireProfile} from './threads.mjs';

const databases=new Map();
export function ipNumber(input){
  if(typeof input!=='string'||input.includes('%'))return null;
  let ip=input.toLowerCase().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/,'$1'),version=isIP(ip);
  if(!version)return null;
  if(version===4)return {version,value:ip.split('.').reduce((n,v)=>(n<<8n)+BigInt(v),0n)};
  if(ip.includes('.')){const i=ip.lastIndexOf(':'),v=ipNumber(ip.slice(i+1));if(!v)return null;ip=ip.slice(0,i+1)+(v.value>>16n).toString(16)+':'+(v.value&65535n).toString(16);}
  const sides=ip.split('::'),left=sides[0]?sides[0].split(':'):[],right=sides[1]?sides[1].split(':'):[];
  const parts=sides.length===2?[...left,...Array(8-left.length-right.length).fill('0'),...right]:left;
  return {version,value:parts.reduce((n,v)=>(n<<16n)+BigInt('0x'+v),0n)};
}
export function publicIp(input){
  const parsed=ipNumber(input);if(!parsed)return false;const {version,value}=parsed;
  if(version===6)return value>>125n===1n&&value>>96n!==0x20010db8n;
  const n=Number(value),a=n>>>24,b=n>>>16&255,c=n>>>8&255;
  return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19))||(a===192&&b===0)||(a===198&&b===51&&c===100)||(a===203&&b===0&&c===113));
}
export function clientIp(req,trustProxy=false){
  // Render documents the first X-Forwarded-For value as the client. This is
  // only an approximate visual hint, never an authentication/security signal.
  const forwarded=trustProxy&&typeof req.headers['x-forwarded-for']==='string'?req.headers['x-forwarded-for'].split(',')[0].trim():null;
  const ip=forwarded||req.socket.remoteAddress;return publicIp(ip)?ip:null;
}
export function lookupCountry(ip){
  if(!publicIp(ip))return null;const {version,value}=ipNumber(ip),width=version===4?4:16,size=width*2+2;
  try{
    if(!databases.has(version))databases.set(version,gunzipSync(readFileSync(new URL('./geo-data/country-v'+version+'.bin.gz',import.meta.url))));
    const data=databases.get(version),number=offset=>version===4?BigInt(data.readUInt32BE(offset)):(data.readBigUInt64BE(offset)<<64n)+data.readBigUInt64BE(offset+8);
    let low=0,high=data.length/size-1;
    while(low<=high){const mid=Math.floor((low+high)/2),offset=mid*size,start=number(offset),end=number(offset+width);if(value<start)high=mid-1;else if(value>end)low=mid+1;else return data.toString('ascii',offset+2*width,offset+size);}
  }catch{return null;}return null;
}
export function initGlobe(db){db.exec(`CREATE TABLE IF NOT EXISTS globe_preferences(address TEXT PRIMARY KEY REFERENCES accounts(address),enabled INTEGER NOT NULL CHECK(enabled IN(0,1)));CREATE TABLE IF NOT EXISTS globe_presence(address TEXT PRIMARY KEY REFERENCES accounts(address),country TEXT NOT NULL,seen INTEGER NOT NULL);`);}
export function globeData(db,account,ip,input,now,lookup=lookupCountry){
  requireProfile(db,account);const address=account.address.toLowerCase();
  if(input?.enabled!==undefined){if(typeof input.enabled!=='boolean')throw Object.assign(Error('Choose whether to share your approximate country.'),{status:400});db.prepare('INSERT INTO globe_preferences VALUES(?,?) ON CONFLICT(address) DO UPDATE SET enabled=excluded.enabled').run(address,input.enabled?1:0);}
  const enabled=db.prepare('SELECT enabled FROM globe_preferences WHERE address=?').get(address)?.enabled===1;
  let country;try{country=ip&&lookup(ip);}catch{country=null;}if(!/^[A-Z]{2}$/.test(country||''))country=null;
  db.prepare('DELETE FROM globe_presence WHERE seen<=?').run(now-65000);
  if(input){if(enabled&&country&&input.active===true)db.prepare('INSERT INTO globe_presence VALUES(?,?,?) ON CONFLICT(address) DO UPDATE SET country=excluded.country,seen=excluded.seen').run(address,country,now);else db.prepare('DELETE FROM globe_presence WHERE address=?').run(address);}
  const countries=db.prepare('SELECT country,count(*) AS count FROM globe_presence WHERE seen>? GROUP BY country ORDER BY country').all(now-65000);
  return {enabled,viewerCountry:country,countries,sharingOnline:countries.reduce((n,c)=>n+c.count,0),updatedAt:now,accuracy:'country',approximate:true};
}
