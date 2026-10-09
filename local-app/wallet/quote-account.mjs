// Operator entry point: records an UNAPPROVED quote, never signs or broadcasts.
import {openDatabase} from '../db/database.mjs';
import {createWalletChain} from './chain.mjs';
import {createNativePreflight} from './preflight.mjs';
import {createCloneProvisioner} from './provisioner.mjs';
const accountId=process.argv[2];
if(!/^[a-f0-9-]{36}$/.test(accountId||''))throw Error('Provide the Neuron Storm Passkey account ID.');
if(!process.env.NS_WALLET_RELAYER_ADDRESS)throw Error('Configure the intended relayer address. No test default is used.');
const preflight=createNativePreflight({binary:process.env.NS_WALLET_NATIVE_VERIFIER,binaryHash:process.env.NS_WALLET_NATIVE_VERIFIER_SHA256});
const db=await openDatabase(process.env.DATABASE_URL);
try{
 const provisioner=createCloneProvisioner(db,{chain:createWalletChain(),relayer:process.env.NS_WALLET_RELAYER_ADDRESS,preflight});
 const q=await provisioner.quote(accountId);
 console.log(JSON.stringify({accountId,address:q.address,factory:q.factory,chainId:q.chainId,commitment:q.commitment,gasUsed:q.gasUsed,gasEstimate:q.gasEstimate,gasLimit:q.gasLimit,gasPriceWei:q.gasPriceWei,expectedCostQuai:q.expectedCostQuai,maximumCostQuai:q.maximumCostQuai,balanceQuai:q.balanceQuai,shortfallQuai:q.shortfallQuai,approvalRequired:true,broadcastAllowed:false},null,2));
}finally{await db.close();}
