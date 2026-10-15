// Operator-only approved 2200 QUAI cumulative budget for 31 days. No signing.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {keccak256} from 'quais';
import {openDatabase} from '../db/database.mjs';
import {createFeeAssignments} from './fee-assignment.mjs';
import {createWalletChain} from './chain.mjs';
import {installProductionFeeGrant,PRODUCTION_FEE_GRANT} from './production-fee-grant.mjs';
assert.deepEqual(process.argv.slice(2),['--approved-2200-quai-31-days-20261016']);
for(const key of ['NS_FEE_SEND_ENABLED','NS_WALLET_SEND_ENABLED','NS_WALLET_PROVISION_ENABLED'])assert.notEqual(process.env[key],'true');
const relayer='0x001893151cDcc11372f6dd067e3424f47ad8534a';assert.equal(process.env.NS_WALLET_RELAYER_ADDRESS.toLowerCase(),relayer.toLowerCase());
const registry=createFeeAssignments(JSON.parse(await readFile(process.env.NS_FEE_WALLET_MANIFEST,'utf8'))),infra=registry.infrastructure;
const {rpc}=createWalletChain({infrastructure:infra});assert.equal(BigInt(await rpc('quai_chainId',[])),9n);
for(const [address,hash] of [[infra.factory,infra.factoryHash],[infra.implementation,infra.implementationHash]])assert.equal(keccak256(await rpc('quai_getCode',[address,'latest'])),hash);
const balance=BigInt(await rpc('quai_getBalance',[relayer,'latest']));assert(balance>10n**19n,'Relayer safety margin unavailable');
// This is a cumulative spending ceiling, not permission to ignore actual balance.
// Every Send still reserves its full gas limit and preserves the balance margin.
const db=await openDatabase(process.env.DATABASE_URL);
try{const grant=await installProductionFeeGrant(db,relayer);console.log(JSON.stringify({productionFeeGrant:PRODUCTION_FEE_GRANT,budgetQuai:'2200',expiresAt:new Date(Number(grant.expires_at)).toISOString(),reservedWei:grant.reserved_wei,relayerBalanceWei:String(balance),broadcasts:0}));}finally{await db.close();}
