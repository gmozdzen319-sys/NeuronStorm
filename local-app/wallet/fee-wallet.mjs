import {setupProgress} from './setup-progress.mjs';
import {currentAccountWallet,usesCurrentWallet} from '../current-wallet.mjs';
import QRCode from 'qrcode';
import {NS_TOKEN} from '../neuron-token.mjs';
import {ZERO_TOKEN} from './fee-operation.mjs';
import {expireFeeSends} from './send-expiry.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
// Existing v2 state/history remains visible. Merely enabling configuration does
// not assign a new address. Only an independently confirmed v3 becomes Receive.
export function withFeeWallet(db,legacy,fee,{readBalance,now=Date.now}){
 if(!fee){
  const blocked=async account=>await usesCurrentWallet(db,account?.id);
  return {...legacy,
   state:async account=>{const state=await legacy.state(account);return await blocked(account)?{...state,address:null,receiveAvailable:false,sendAvailable:false,status:'activating',setupProgress:setupProgress(),reason:'Your wallet is being prepared.'}:state;},
   receive:async account=>{if(await blocked(account))throw fail(423,'Your wallet is being prepared.');return legacy.receive(account);},
   send:{...legacy.send,prepare:async(account,input)=>{if(await blocked(account))throw fail(423,'Your wallet is being prepared.');return legacy.send.prepare(account,input);}}
  };
 }
 const owner=a=>{if(a?.method!=='passkey')throw fail(401,'Sign in with your passkey.');};
 const service={...legacy};
 service.state=async account=>{
  owner(account);await expireFeeSends(db,{now:now(),accountId:account.id});const previous=await legacy.state(account),row=await fee.registry.load(db,account.id);
  if(!row){if(await usesCurrentWallet(db,account.id))return {...previous,generation:3,address:null,receiveAvailable:false,sendAvailable:false,status:'activating',setupProgress:setupProgress(),reason:'Your wallet is being prepared.'};return previous;}
  const signup=await db.prepare('SELECT account_id FROM passkey_fee_signup_queue WHERE account_id=$1').get(account.id)||await usesCurrentWallet(db,account.id);
  const pendingSignup=async(verificationUnavailable=false)=>{
   const job=await db.prepare('SELECT phase FROM passkey_fee_auto_activations WHERE account_id=$1').get(account.id);
   // Optional presentation read must not change activation or wallet availability.
   let approval;try{approval=await db.prepare('SELECT phase FROM passkey_fee_approvals WHERE account_id=$1').get(account.id);}catch{}
   const stopped=job&&['stopped','ambiguous'].includes(job.phase);
   return {...previous,setupProgress:setupProgress({job:job?.phase,approval:approval?.phase,verificationUnavailable}),generation:3,status:stopped?'activation_waiting':'activating',address:null,quaiBalance:null,receiveAvailable:false,sendAvailable:false,feeUpgradePending:true,
    reason:stopped?'Wallet activation is safely paused and needs review. No automatic retry will be made.':'Your wallet is being prepared. Neuron Storm covers activation fees up to 40 QUAI. Your receiving address will appear after confirmation. Do not send funds yet.'};
  };
  try{
   if(row.revoked_at!==null)throw Error('Credential revoked');
   const view=await fee.chain.snapshot(row.plan);
   if(!view.deployed)return signup?pendingSignup():{...previous,feeUpgradePending:true};
   if(signup){const approval=await db.prepare('SELECT phase FROM passkey_fee_approvals WHERE account_id=$1').get(account.id);if(approval?.phase!=='confirmed')return pendingSignup();}
   const canonical=await currentAccountWallet(db,account.id,{row,view});
   const pending=await db.prepare("SELECT id FROM passkey_native_operations WHERE account_id=$1 AND (phase IN ('verifying','authorized','submitting') OR (phase='awaiting_confirmation' AND expires_at>$2)) LIMIT 1").get(account.id,now());
   const available=!pending&&await fee.send.available();
   const blockedReason=pending?'Another transfer is awaiting confirmation or being checked. Wait for its result before preparing another.':!available&&fee.send.unavailableReason?await fee.send.unavailableReason():'Your wallet can receive funds. Sending is temporarily unavailable.';
   return {...previous,setupProgress:setupProgress({ready:true}),status:'active',generation:3,address:canonical??row.plan.address,quaiBalance:view.quaiBalance,receiveAvailable:true,sendAvailable:available,quotedFees:true,
    sendTokens:[{contract:ZERO_TOKEN,symbol:'QUAI'},{contract:NS_TOKEN.address,symbol:NS_TOKEN.symbol},...previous.tokens],
    legacyWallets:[{address:previous.address,quaiBalance:previous.quaiBalance,receiveAvailable:previous.receiveAvailable}].filter(w=>w.address),
    reason:available?'Your wallet is ready. Each send requires your passkey and pays a quoted network fee plus 5%.':blockedReason};
  }catch{if(signup||await usesCurrentWallet(db,account.id))return {...await pendingSignup(true),reason:'We could not safely verify your wallet. Please check again later. No transaction was sent.'};return {...previous,sendAvailable:false,feeUpgradePending:true,reason:'We could not safely verify the updated wallet. Your existing wallet is shown. No transaction was sent.'};}
 };
 service.receive=async account=>{const state=await service.state(account);if(state.generation!==3)return legacy.receive(account);if(!state.receiveAvailable||!state.address)throw fail(423,state.reason);return {address:state.address,quaiBalance:state.quaiBalance,receiveCompatible:true,network:'Quai Mainnet · Cyprus-1',qr:await QRCode.toDataURL(state.address,{errorCorrectionLevel:'M',width:232,margin:4})};};
 service.tokenBalances=async account=>{
  const state=await service.state(account);if(state.generation!==3)return legacy.tokenBalances(account);
  if(!state.receiveAvailable||!state.address)return {nsBalance:null,tokens:state.tokens.map(token=>({...token,balance:null}))};
  const assets=await Promise.all([{contract:NS_TOKEN.address,decimals:NS_TOKEN.decimals},...state.tokens].map(async token=>{try{return {...token,balance:await readBalance(token,state.address)};}catch{return {...token,balance:null};}}));
  return {nsBalance:assets[0].balance,tokens:assets.slice(1)};
 };
 const route=async(account,id)=>{owner(account);const row=await db.prepare('SELECT plan FROM passkey_native_operations WHERE id=$1 AND account_id=$2').get(id,account.id);if(!row)throw fail(404,'Transfer not found.');return JSON.parse(row.plan).operation.action===6?fee.send:legacy.send;};
 service.send={
  prepare:async(account,input)=>{const state=await service.state(account);if(!state.sendAvailable)throw fail(423,state.reason||'Sending is temporarily unavailable.');return state.generation===3?fee.send.prepare(account,{...input,token:input.token??ZERO_TOKEN}):legacy.send.prepare(account,input);},
  confirm:async(account,input)=>(await route(account,input.id)).confirm(account,input),
  status:async(account,id)=>(await route(account,id)).status(account,id)
 };
 return service;
}
