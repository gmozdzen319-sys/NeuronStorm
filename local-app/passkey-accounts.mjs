import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server';
import {assignCloneWallet} from './wallet-infrastructure.mjs';

const secret=()=>randomBytes(32).toString('base64url');
export const passkeyHash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const unavailable=()=>fail(503,'Passkey registration is not available yet. Please use Pelagus or BillPay.');

// Explicit, pinned deployment configuration. Never derive the RP from request headers.
export function passkeyConfiguration(origin, env=process.env){
  if(env.NS_PASSKEY_ENABLED!=='true')return {enabled:false};
  const url=new URL(origin);
  if(env.NS_PASSKEY_ORIGIN!==origin || env.NS_PASSKEY_RP_ID!==url.hostname ||
    (url.protocol!=='https:' && url.hostname!=='localhost'))throw Error('Invalid pinned Passkey origin/RP configuration');
  return {enabled:true,origin,rpID:url.hostname};
}

// Extra JSON guard: JSON.parse alone silently accepts duplicate keys. This scans
// the original signed UTF-8 bytes, rejecting duplicate decoded keys at every level.
export function strictClientData(encoded){
  if(typeof encoded!=='string'||encoded.length>16384||!/^[A-Za-z0-9_-]+$/.test(encoded))throw fail(400,'Invalid device response.');
  const bytes=Buffer.from(encoded,'base64url');
  if(bytes.toString('base64url')!==encoded)throw fail(400,'Invalid device response.');
  let source;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw fail(400,'Invalid device response.');}
  let i=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(source[i]||'!'))i++;};
  const string=()=>{const start=i++;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]==='"')return JSON.parse(source.slice(start,i));}throw Error();};
  const value=(depth=0)=>{if(depth>12)throw Error();ws();const c=source[i];
    if(c==='"')return string();
    if(c==='{'||c==='['){i++;const keys=new Set(),close=c==='{'?'}':']';ws();if(source[i]===close){i++;return;}
      while(i<source.length){if(c==='{'){ws();if(source[i]!=='"')throw Error();const key=string();if(keys.has(key))throw Error();keys.add(key);ws();if(source[i++]!==':')throw Error();}
        value(depth+1);ws();if(source[i]===close){i++;return;}if(source[i++]!==',')throw Error();}throw Error();}
    const m=source.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);if(!m)throw Error();i+=m[0].length;
  };
  try{value();ws();if(i!==source.length)throw Error();const result=JSON.parse(source);
    if(!result||Array.isArray(result)||typeof result!=='object'||(result.crossOrigin!==undefined&&result.crossOrigin!==false)||'topOrigin' in result)throw Error();
    return result;
  }catch{throw fail(400,'Invalid device response.');}
}

export function createPasskeyAccounts(db,{config,legal,now=Date.now}){
  function enabled(){if(!config.enabled)throw unavailable();}
  async function session(raw){
    if(!config.enabled||typeof raw!=='string'||!/^[\w-]{43}$/.test(raw))return null;
    const row=await db.prepare(`SELECT a.id,a.user_handle FROM passkey_sessions s
      JOIN passkey_accounts a ON a.id=s.account_id JOIN passkey_credentials c ON c.id=s.credential_id
      WHERE s.token_hash=$1 AND s.expires>$2 AND c.revoked_at IS NULL AND c.account_id=a.id
      AND a.rp_id=$3 AND a.origin=$4`).get(passkeyHash(raw),now(),config.rpID,config.origin);
    return row?{id:row.id,method:'passkey',role:'member',address:null,walletStatus:'awaiting_review'}:null;
  }
  async function options(purpose,browser,input={}){
    enabled();if(!['register','login'].includes(purpose))throw fail(400,'Invalid request.');
    if(purpose==='register'&&legal.published&&(input.termsAccepted!==true||input.termsHash!==legal.hash))throw fail(400,'Accept the current Terms of Use before creating an account.');
    const handle=purpose==='register'?secret():null;
    const options=purpose==='register'?await generateRegistrationOptions({rpName:'Neuron Storm',rpID:config.rpID,
      userID:Buffer.from(handle,'base64url'),userName:'Neuron Storm '+handle.slice(0,8),attestationType:'none',supportedAlgorithmIDs:[-7],
      authenticatorSelection:{residentKey:'required',userVerification:'required'},timeout:120000}):
      await generateAuthenticationOptions({rpID:config.rpID,userVerification:'required',timeout:120000});
    const id=secret();
    await db.transaction(async()=>{
      await db.prepare('DELETE FROM passkey_challenges WHERE expires<=$1 OR browser_hash=$2').run(now(),passkeyHash(browser));
      await db.prepare('DELETE FROM passkey_sessions WHERE expires<=$1').run(now());
      await db.prepare('INSERT INTO passkey_challenges VALUES($1,$2,$3,$4,$5,$6,$7)').run(id,passkeyHash(browser),purpose,options.challenge,handle,legal.published?legal.hash:null,now()+120000);
    });
    return {id,options};
  }
  async function verify(purpose,browser,input){
    enabled();
    // Consume even on invalid responses; one challenge cannot create two sessions.
    const challenge=await db.prepare('DELETE FROM passkey_challenges WHERE id=$1 AND browser_hash=$2 AND purpose=$3 AND expires>$4 RETURNING *').get(input.id,passkeyHash(browser),purpose,now());
    if(!challenge)throw fail(401,'This request expired or was already used. Start again.');
    if(legal.published&&challenge.legal_hash!==legal.hash)throw fail(409,'The Terms of Use changed. Please start again.');
    strictClientData(input.response?.response?.clientDataJSON);
    const expected={response:input.response,expectedChallenge:challenge.challenge,expectedOrigin:config.origin,expectedRPID:config.rpID,requireUserVerification:true};
    let owner,credentialID;
    const raw=secret();
    try{
      await db.transaction(async()=>{
        if(purpose==='register'){
          const verified=await verifyRegistrationResponse({...expected,supportedAlgorithmIDs:[-7],requireUserPresence:true});
          if(!verified.verified)throw Error();
          const info=verified.registrationInfo,c=info.credential;owner=randomUUID();credentialID=c.id;
          await db.prepare('INSERT INTO passkey_accounts VALUES($1,$2,$3,$4,$5,$6)').run(owner,challenge.user_handle,now(),challenge.legal_hash,config.rpID,config.origin);
          await db.prepare('INSERT INTO passkey_credentials VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL)').run(c.id,owner,Buffer.from(c.publicKey).toString('base64url'),c.counter,'My passkey',info.credentialBackedUp,now(),now());
          await db.prepare('INSERT INTO passkey_wallets(account_id) VALUES($1)').run(owner);
          await assignCloneWallet(db,owner,now);
        }else{
          credentialID=input.response.id;
          const c=await db.prepare(`SELECT c.*,a.user_handle,a.rp_id,a.origin FROM passkey_credentials c JOIN passkey_accounts a ON a.id=c.account_id WHERE c.id=$1 AND c.revoked_at IS NULL FOR UPDATE OF c`).get(credentialID);
          if(!c||c.rp_id!==config.rpID||c.origin!==config.origin||input.response.response.userHandle!==c.user_handle)throw Error();
          const checked=await verifyAuthenticationResponse({...expected,credential:{id:c.id,publicKey:Buffer.from(c.public_key,'base64url'),counter:c.counter}});
          if(!checked.verified)throw Error();owner=c.account_id;
          await db.prepare('UPDATE passkey_credentials SET counter=$1,last_used=$2,backed_up=$3 WHERE id=$4').run(checked.authenticationInfo.newCounter,now(),checked.authenticationInfo.credentialBackedUp,c.id);
        }
        await db.prepare('INSERT INTO passkey_sessions VALUES($1,$2,$3,$4)').run(passkeyHash(raw),owner,credentialID,now()+28800000);
      });
    }catch{throw fail(401,'The passkey could not be verified. Please start again.');}
    return {raw,account:{id:owner,method:'passkey',role:'member',address:null,walletStatus:'awaiting_review'}};
  }
  async function logout(raw){if(raw)await db.prepare('DELETE FROM passkey_sessions WHERE token_hash=$1').run(passkeyHash(raw));}
  async function devices(account){
    if(!account)throw fail(401,'Please sign in.');
    return db.prepare('SELECT label,backed_up,created_at,last_used FROM passkey_credentials WHERE account_id=$1 AND revoked_at IS NULL ORDER BY created_at').all(account.id);
  }
  return {session,options,verify,logout,devices};
}
