import QRCode from 'qrcode';
import {NS_TOKEN} from '../neuron-token.mjs';
import {ZERO_TOKEN} from './fee-operation.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
// Existing v2 state/history remains visible. Merely enabling configuration does
// not assign a new address. Only an independently confirmed v3 becomes Receive.
export function withFeeWallet(db,legacy,fee,{readBalance,now=Date.now}){
 if(!fee)return legacy;
 const owner=a=>{if(a?.method!=='passkey')throw fail(401,'Sign in with your passkey.');};
 const service={...legacy};
 service.state=async account=>{
  owner(account);const previous=await legacy.state(account),row=await fee.registry.load(db,account.id);
  if(!row)return previous;
  try{
   if(row.revoked_at!==null)throw Error('Credential revoked');
   const view=await fee.chain.snapshot(row.plan);
   if(!view.deployed)return {...previous,feeUpgradePending:true};
   const pending=await db.prepare("SELECT id FROM passkey_native_operations WHERE account_id=$1 AND (phase IN ('verifying','authorized','submitting') OR (phase='awaiting_confirmation' AND expires_at>$2)) LIMIT 1").get(account.id,now());
   const available=!pending&&await fee.send.available();
   return {...previous,status:'active',generation:3,address:row.plan.address,quaiBalance:view.quaiBalance,receiveAvailable:true,sendAvailable:available,quotedFees:true,
    sendTokens:[{contract:ZERO_TOKEN,symbol:'QUAI'},{contract:NS_TOKEN.address,symbol:NS_TOKEN.symbol},...previous.tokens],
    legacyWallets:[{address:previous.address,quaiBalance:previous.quaiBalance,receiveAvailable:previous.receiveAvailable}].filter(w=>w.address),
    reason:available?'Your wallet is ready. Each send requires your passkey and pays a quoted network fee plus 5%.':'Your wallet can receive funds. Sending is temporarily unavailable.'};
  }catch{return {...previous,sendAvailable:false,feeUpgradePending:true,reason:'We could not safely verify the updated wallet. Your existing wallet is shown. No transaction was sent.'};}
 };
 service.receive=async account=>{const state=await service.state(account);if(state.generation!==3)return legacy.receive(account);return {address:state.address,quaiBalance:state.quaiBalance,receiveCompatible:true,network:'Quai Mainnet · Cyprus-1',qr:await QRCode.toDataURL(state.address,{errorCorrectionLevel:'M',width:232,margin:4})};};
 service.tokenBalances=async account=>{
  const state=await service.state(account);if(state.generation!==3)return legacy.tokenBalances(account);
  const assets=await Promise.all([{contract:NS_TOKEN.address,decimals:NS_TOKEN.decimals},...state.tokens].map(async token=>{try{return {...token,balance:await readBalance(token,state.address)};}catch{return {...token,balance:null};}}));
  return {nsBalance:assets[0].balance,tokens:assets.slice(1)};
 };
 const route=async(account,id)=>{owner(account);const row=await db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1 AND account_id=$2').get(id,account.id);if(!row)throw fail(404,'Transfer not found.');return JSON.parse(row.plan).operation.action===6?fee.send:legacy.send;};
 service.send={
  prepare:async(account,input)=>{const state=await service.state(account);if(!state.sendAvailable)throw fail(423,'Sending is temporarily unavailable.');return state.generation===3?fee.send.prepare(account,{...input,token:input.token??ZERO_TOKEN}):legacy.send.prepare(account,input);},
  confirm:async(account,input)=>(await route(account,input.id)).confirm(account,input),
  status:async(account,id)=>(await route(account,id)).status(account,id)
 };
 return service;
}
