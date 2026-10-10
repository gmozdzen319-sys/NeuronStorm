// Operator audit: no signer, grants, approval updates or broadcasting.
import assert from 'node:assert/strict';
import {openDatabase} from '../db/database.mjs';
import {createWalletChain} from './chain.mjs';
import {createNativePreflight} from './preflight.mjs';
import {quoteProvisioning} from './provisioning-quote.mjs';
import {createNetworkVerification} from './network-verification.mjs';
import {validateAutoQuote} from './auto-activation.mjs';
const db=await openDatabase(process.env.DATABASE_URL);
try{
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
}finally{await db.close();}
