// Operator audit: no signer, grants, approval updates or broadcasting.
import assert from 'node:assert/strict';
import {openDatabase} from '../db/database.mjs';
import {createWalletChain} from './chain.mjs';
import {createNativePreflight} from './preflight.mjs';
import {quoteProvisioning} from './provisioning-quote.mjs';
import {createNetworkVerification} from './network-verification.mjs';
import {validateAutoQuote} from './auto-activation.mjs';
import {diagnoseProvisioning} from './provisioning-diagnosis.mjs';
const db=await openDatabase(process.env.DATABASE_URL);
try{
 if(process.argv[2]==='--preflight-diagnose'){
  const chain=createWalletChain(),relayer=process.env.NS_WALLET_RELAYER_ADDRESS;
  const preflight=createNativePreflight({binary:process.env.NS_WALLET_NATIVE_VERIFIER,binaryHash:process.env.NS_WALLET_NATIVE_VERIFIER_SHA256});
  const verifyNetwork=createNetworkVerification(process.env);
  const rows=await db.prepare("SELECT account_id FROM passkey_auto_activations WHERE phase='stopped' ORDER BY created_at LIMIT 10").all();
  for(const {account_id:accountId} of rows)console.log(JSON.stringify({activationPreflight:{accountId,...await diagnoseProvisioning(db,{accountId,relayer,chain,preflight,verifyNetwork})},broadcasts:0}));
 }else if(process.argv[2]==='--diagnose'){
  // Historical evidence only. No credentials, signer, grants or state changes.
  const rows=await db.prepare(`SELECT w.account_id,w.address,j.phase,p.quote,p.commitment,p.expires_at
   FROM passkey_clone_wallets w JOIN passkey_auto_activations j ON j.account_id=w.account_id
   LEFT JOIN passkey_clone_approvals p ON p.account_id=w.account_id ORDER BY w.created_at`).all();
  for(const row of rows){
   const history=await db.prepare(`SELECT recorded_at,evidence::jsonb->>'phase' AS phase,
    evidence::jsonb->>'approved' AS approved,evidence::jsonb->>'tx_hash' AS tx_hash
    FROM passkey_clone_approval_history WHERE account_id=$1 ORDER BY id`).all(row.account_id);
   let savedQuoteValid=false;
   if(row.quote){const quote=JSON.parse(row.quote);try{validateAutoQuote(quote,{accountId:row.account_id,address:row.address,relayer:process.env.NS_WALLET_RELAYER_ADDRESS,now:Date.parse(quote.quotedAt)});savedQuoteValid=true;}catch{}}
   console.log(JSON.stringify({activationDiagnosis:{accountId:row.account_id,phase:row.phase,savedQuoteValid,history},broadcasts:0}));
  }
 }else if(process.argv[2]==='--status'){
  const rows=await db.prepare(`SELECT w.account_id,w.address,j.phase AS automatic_phase,p.phase AS approval_phase,
   p.tx_hash,p.quote::jsonb->>'maximumCostQuai' AS maximum_cost_quai,
   p.receipt::jsonb->>'feeQuai' AS fee_quai,g.enabled AS grant_enabled,g.reserved_wei
   FROM passkey_clone_wallets w LEFT JOIN passkey_auto_activations j ON j.account_id=w.account_id
   LEFT JOIN passkey_clone_approvals p ON p.account_id=w.account_id
   LEFT JOIN passkey_relayer_grants g ON g.id=j.grant_id ORDER BY w.created_at LIMIT 20`).all();
  for(const row of rows)console.log(JSON.stringify({activationStatus:row,broadcasts:0}));
 }else{
 assert.notEqual(process.env.NS_WALLET_AUTO_ACTIVATE,'true','Audit before enabling automatic spending');
 const chain=createWalletChain(),relayer=process.env.NS_WALLET_RELAYER_ADDRESS;
 const preflight=createNativePreflight({binary:process.env.NS_WALLET_NATIVE_VERIFIER,binaryHash:process.env.NS_WALLET_NATIVE_VERIFIER_SHA256});
 const rows=await db.prepare(`SELECT w.account_id,w.address,p.phase,p.approved,p.tx_hash FROM passkey_clone_wallets w
 LEFT JOIN passkey_clone_approvals p ON p.account_id=w.account_id ORDER BY w.created_at LIMIT 20`).all();
 for(const row of rows){
  if(row.phase&&row.phase!=='quoted'||row.approved||row.tx_hash){console.log(JSON.stringify({activationAudit:'EXCLUDED_PREVIOUS_ATTEMPT',accountId:row.account_id,address:row.address,phase:row.phase,broadcasts:0}));continue;}
  if(await db.prepare('SELECT account_id FROM passkey_auto_activations WHERE account_id=$1').get(row.account_id))continue;
  const history=await db.prepare("SELECT id FROM passkey_clone_approval_history WHERE account_id=$1 AND ((evidence::jsonb->>'phase')<>'quoted' OR (evidence::jsonb->>'approved')='true' OR (evidence::jsonb->>'tx_hash') IS NOT NULL) LIMIT 1").get(row.account_id);
  if(history){console.log(JSON.stringify({activationAudit:'EXCLUDED_HISTORY',accountId:row.account_id,broadcasts:0}));continue;}
  try{
   const quote=await quoteProvisioning(db,{accountId:row.account_id,relayer,chain,preflight});
   validateAutoQuote(quote,{accountId:row.account_id,address:row.address,relayer});
   assert(await createNetworkVerification(process.env)({rpc:chain.rpc,block:quote.native.block,relayer,wallet:row.address,accounts:quote.native.accounts}));
   console.log(JSON.stringify({activationAudit:'READY_FOR_AUTOMATIC_POLICY',accountId:row.account_id,address:row.address,maximumCostQuai:quote.maximumCostQuai,expectedCostQuai:quote.expectedCostQuai,gasLimit:quote.gasLimit,gasPriceWei:quote.gasPriceWei,balanceQuai:quote.balanceQuai,broadcasts:0}));
  }catch{console.log(JSON.stringify({activationAudit:'WAITING_SAFETY_CHECK',accountId:row.account_id,address:row.address,broadcasts:0}));}
 }
 }
}finally{await db.close();}
