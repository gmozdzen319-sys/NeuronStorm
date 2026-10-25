import {readFileForAccount} from './content-files.mjs';
import {verificationFields,settleVerification} from './verification.mjs';
import {configuredLiveTalk} from './live-talk-provider.mjs';
import {createLiveTalk} from './live-talk.mjs';
import {createTokenNotices} from './token-notices.mjs';
import {createWalletRPC as notificationRPC} from './wallet/chain.mjs';
import {currentWalletForIdentity} from './current-wallet.mjs';
import {createSendProgress} from './wallet/send-progress.mjs';
import {loadLegal,initLegal,legalPage} from './legal.mjs';
import {createPasskeyAccounts,passkeyConfiguration} from './passkey-accounts.mjs';
import {createPasskeyWallet,createTokenBalanceReader} from './passkey-wallet.mjs';
import {configuredFeeWallet} from './wallet/configured-fee.mjs';
import {withFeeWallet} from './wallet/fee-wallet.mjs';
import {createWalletChain} from './wallet/chain.mjs';
import {configuredExecutor} from './wallet/configured-executor.mjs';
import {configuredAutoActivation} from './wallet/auto-activation.mjs';
import {configuredFeeAutoActivation,feeSignupEnrollment} from './wallet/fee-auto-activation.mjs';
import {blocks,remindDeadlines} from './contact-preferences.mjs';
import {library,reportContent,adminReports} from './member-tools.mjs';
import {createRewardConfirmation} from './reward-confirmation.mjs';
import {archiveText} from './archive.mjs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {globeData,clientIp,lookupCountry} from './geography.mjs';
import {conversationGlobe} from './conversation-globe.mjs';
import {expireQuestions,acceptedAnswers} from './lifecycle.mjs';
import {createPayments,REWARD_ADDRESS} from './payments.mjs';
import {presence,rewardGrowth} from './community.mjs';
import {prepareAction,submitAction} from './actions.mjs';
import {debate,voteOnDebate} from './debate.mjs';
import {reputationRanking,reputationAdmin,reputation,rounds} from './reputation.mjs';
import {createMarketReader} from './token-market.mjs';
import {NS_TOKEN,createNeuronReader} from './neuron-token.mjs';
import {listNotifications,readNotifications} from './notifications.mjs';
import {requireAdmin,adminList,adminThread,moderateThread,adminMembers} from './admin.mjs';
import http from 'node:http';
import {openDatabase} from './db/database.mjs';
import {WALLET_GENERATION} from './wallet-infrastructure.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, verifyMessage, isQuaiAddress } from 'quais';
import { readProfile, readCategories, saveProfile } from './profiles.mjs';
import { listQuestions, readThread, previewQuestion, markThreadRead, voteOnReply } from './threads.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export const ADMIN = '0x00198C77e2cce7C839A34aF8C54Eb82106862640'.toLowerCase();
const token = () => randomBytes(32).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=')));
const failure = (status, message) => Object.assign(new Error(message), { status });

export async function createApp({ database = process.env.DATABASE_URL, databasePoolSize=5, origin = 'http://localhost:3000', now = Date.now, tokenFetch = fetch, marketFetch = fetch, paymentFetch = fetch, geoLookup=lookupCountry, trustProxy=process.env.RENDER==='true', legal=loadLegal() } = {}) {
  const runningVersion=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  const liveTalkProvider=configuredLiveTalk();
  const sendProgress=createSendProgress();
  const db = await openDatabase(database,{max:databasePoolSize,walletGeneration:WALLET_GENERATION});
  const liveTalk=createLiveTalk(db,liveTalkProvider,now);
  try{await initLegal(db,legal);}catch(error){await db.close();throw error;}
  let passkeyConfig;
  try{passkeyConfig=passkeyConfiguration(origin);}catch(error){await db.close();throw error;}
  const walletChain=createWalletChain();
  let walletExecutor,autoActivation,feeWallet,feeAutoActivation;
  try{walletExecutor=await configuredExecutor(db,walletChain);autoActivation=configuredAutoActivation(db,walletChain);feeWallet=await configuredFeeWallet(db);feeAutoActivation=configuredFeeAutoActivation(db,feeWallet);if(feeAutoActivation)autoActivation=feeAutoActivation;}catch{await db.close();throw new Error('Invalid wallet execution configuration');}
  db.verifyCurrentWallet=async id=>{if(!feeWallet)return null;const row=await feeWallet.registry.load(db,id);if(!row)return null;return {row,view:await feeWallet.chain.snapshot(row.plan)};};
  const passkeys=createPasskeyAccounts(db,{config:passkeyConfig,legal,now,onRegistered:feeAutoActivation?feeSignupEnrollment(feeWallet.registry,now):null});
  const passkeyWallet=withFeeWallet(db,createPasskeyWallet(db,{chain:walletChain,executor:walletExecutor,autoActivation:!!autoActivation&&!feeAutoActivation,now}),feeWallet,{readBalance:createTokenBalanceReader(),now});
  let maintenance;
  const maintain=()=>maintenance??=(async()=>{await expireQuestions(db,now());await remindDeadlines(db,now());await db.prepare('DELETE FROM content_file_links WHERE action_id IN (SELECT id FROM signed_actions WHERE expires<$1 AND (completed IS NULL OR completed<$2))').run(now(),now()-86400000);})().finally(()=>{maintenance=null;});
  const confirmReward=createRewardConfirmation(db,paymentFetch);
  const payments=createPayments(db,paymentFetch,now);
  const tokenNotices=process.env.RENDER==='true'?createTokenNotices(db,notificationRPC(),now):null;
  const readMarket=createMarketReader(marketFetch);
  const readNeuron=createNeuronReader(tokenFetch);
  const limits = new Map();
  const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;
  async function externalAccount(req) {
    const session = cookies(req).ns_session;
    if (!session || !/^[a-f0-9]{64}$/.test(session)) return null;
    const row = (await db.prepare("SELECT address FROM sessions WHERE token_hash=$1 AND expires>$2").get(hash(session), now()));
    return row ? { address: getAddress(row.address), role: row.address === ADMIN ? 'admin' : 'member' } : null;
  }
  async function account(req){const current=await externalAccount(req)||await passkeys.session(cookies(req).ns_passkey_session);return current?.address?current:null;}
  async function actionSession(req){return hash((await account(req))?.method==='passkey'?cookies(req).ns_passkey_session:cookies(req).ns_session||'');}
  async function body(req,maxBytes=32768) {
    if (req.headers['content-type'] !== 'application/json') throw failure(415, 'JSON format is required.');
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (Buffer.byteLength(data) > maxBytes) throw failure(413, 'The request is too large.');
    }
    try {
      const value = JSON.parse(data);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch { throw failure(400, 'Invalid data.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    if(liveTalkProvider)res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://*.livekit.cloud wss://*.livekit.cloud; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`);
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) throw failure(403, 'Open the website at ' + origin);
      const path = new URL(req.url, origin).pathname;
      if(req.method==='GET'&&path==='/healthz'){await db.query('SELECT 1');return json(200,{ok:true});}
      if (req.method === 'POST') {
        if (req.headers.origin !== origin) throw failure(403, 'This request origin is not allowed.');
        const isDebate=/^\/api\/questions\/[a-f0-9-]{36}\/debate$/.test(path);
        const ip = ((await account(req))?.address.toLowerCase()||req.socket.remoteAddress)+(isDebate?':debate':':actions');
        const entry = limits.get(ip);
        const counter = !entry || entry.until <= now() ? { count: 0, until: now() + 60000 } : entry;
        limits.set(ip, counter);
        if (++counter.count > (isDebate?120:60)) throw failure(429, 'Too many attempts. Please try again in a minute.');
        (await db.prepare("DELETE FROM challenges WHERE expires<=$1").run(now()));
        (await db.prepare("DELETE FROM sessions WHERE expires<=$1").run(now()));
      }
      const fileRoute=path.match(/^\/api\/files\/([a-f0-9-]{36})$/);
      if(fileRoute&&req.method==='GET'){
        const file=await readFileForAccount(db,await account(req),fileRoute[1]);
        res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox; frame-ancestors 'none'");
        res.writeHead(200,{'Content-Type':file.avatar?file.mime:'application/octet-stream','Content-Disposition':(file.avatar?'inline':'attachment')+'; filename="'+file.name+'"','Content-Length':file.bytes.length});res.end(file.bytes);return;
      }
      if(req.method==='GET'&&path==='/api/legal')return json(200,{published:legal.published,version:legal.version,hash:legal.hash});
      if(req.method==='GET'&&path==='/api/passkey/config')return json(200,{enabled:passkeyConfig.enabled,walletEnabled:true});
      const passkeyRoute=path.match(/^\/api\/passkey\/(register|login)\/(options|verify)$/);
      if(passkeyRoute&&req.method==='POST'){
        const input=await body(req),[_,purpose,step]=passkeyRoute;
        if(await account(req))throw failure(409,'Sign out before choosing a different account.');
        let browser=cookies(req).ns_passkey_challenge;
        if(step==='options'){
          if(await passkeys.session(cookies(req).ns_passkey_session))throw failure(409,'You are already signed in.');
          if(!browser||!/^[a-f0-9]{64}$/.test(browser))browser=token();
          const result=await passkeys.options(purpose,browser,input);
          res.setHeader('Set-Cookie',cookie('ns_passkey_challenge',browser,120));return json(200,result);
        }
        const result=await passkeys.verify(purpose,browser||'',input);
        await passkeys.logout(cookies(req).ns_passkey_session);
        res.setHeader('Set-Cookie',[cookie('ns_passkey_session',result.raw,28800),cookie('ns_passkey_challenge','',0)]);
        return json(200,{account:result.account});
      }
      if(path.startsWith('/api/passkey/wallet')||path==='/api/passkey/devices'){
        const current=await passkeys.session(cookies(req).ns_passkey_session);
        if(path==='/api/passkey/devices'&&req.method==='GET')return json(200,{devices:await passkeys.devices(current)});
        if(path==='/api/passkey/wallet'&&req.method==='GET')return json(200,await passkeyWallet.state(current));
        if(path==='/api/passkey/wallet/token-preview'&&req.method==='POST')return json(200,await passkeyWallet.preview(current,await body(req)));
        if(path==='/api/passkey/wallet/tokens'&&req.method==='GET')return json(200,await passkeyWallet.tokens(current));
        if(path==='/api/passkey/wallet/token-balances'&&req.method==='GET')return json(200,await passkeyWallet.tokenBalances(current));
        if(path==='/api/passkey/wallet/tokens'&&req.method==='POST')return json(200,await passkeyWallet.add(current,await body(req)));
        if(path==='/api/passkey/wallet/receive'&&req.method==='GET')return json(200,await passkeyWallet.receive(current));
        const progressPath=path.match(/^\/api\/passkey\/wallet\/send\/progress\/([a-f0-9-]{36})$/i);
        if(progressPath&&req.method==='GET'){
          if(!current?.id)throw failure(401,'Sign in with your passkey.');
          return json(200,{progress:sendProgress.read(current,progressPath[1])});
        }
        if(path==='/api/passkey/wallet/send/prepare'&&req.method==='POST'){
          const {progressId,...input}=await body(req);
          return json(200,await sendProgress.run(current,progressId,'prepare',async()=>{const parameters=input.paymentIntent?await payments.passkeyInput(current,input.paymentIntent):input;const result=await passkeyWallet.send.prepare(current,parameters);if(input.paymentIntent)await payments.bindPasskey(current,input.paymentIntent,result.id);return result;}));
        }
        if(path==='/api/passkey/wallet/send/confirm'&&req.method==='POST'){
          const {progressId,...input}=await body(req);
          return json(200,await sendProgress.run(current,progressId,'send',()=>passkeyWallet.send.confirm(current,input)));
        }
        const transferStatus=path.match(/^\/api\/passkey\/wallet\/send\/([a-f0-9-]{36})$/);
        if(transferStatus&&req.method==='GET')return json(200,await passkeyWallet.send.status(current,transferStatus[1]));
        // No client argument, session or configuration flag can activate these operations.
        if(['/api/passkey/wallet/send','/api/passkey/wallet/receive','/api/passkey/wallet/pair','/api/passkey/wallet/revoke'].includes(path))passkeyWallet.blocked(current);
        throw failure(404,'Page not found.');
      }
      if(req.method==='GET'&&['/terms','/privacy'].includes(path)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(legalPage(legal,path==='/terms'?'terms':'privacy'));}
      if(path.startsWith('/api/'))(await maintain());
      if(path==='/api/blocks'&&['GET','POST'].includes(req.method))return json(200,(await blocks(db,(await account(req)),req.method==='POST'?await body(req):null)));
      if(path==='/api/library'&&['GET','POST'].includes(req.method))return json(200,(await library(db,(await account(req)),req.method==='POST'?await body(req):null,new URL(req.url,origin).searchParams,now())));
      if(path==='/api/reports'&&req.method==='POST')return json(200,(await reportContent(db,(await account(req)),await body(req),now())));
      if(path==='/api/questions/preview'&&req.method==='POST')return json(200,(await previewQuestion(db,(await account(req)),await body(req))));
      if(path==='/api/globe/conversation'&&req.method==='POST')return json(200,await conversationGlobe(db,await account(req),await actionSession(req),clientIp(req,trustProxy),await body(req),now(),geoLookup));
      if(path==='/api/globe'&&['GET','POST'].includes(req.method))return json(200,(await globeData(db,(await account(req)),clientIp(req,trustProxy),req.method==='POST'?await body(req):null,now(),geoLookup)));
      if(path==='/api/presence'&&req.method==='POST'){
        const input=await body(req);let visitor=cookies(req).ns_visitor;
        if(!visitor||!/^[a-f0-9]{64}$/.test(visitor))visitor=token();
        res.setHeader('Set-Cookie',cookie('ns_visitor',visitor,604800));
        return json(200,(await presence(db,hash(visitor),(await account(req)),input.active===true,now())));
      }
      if(path==='/api/ranking'&&req.method==='GET'){const a=await account(req);return json(200,await reputationRanking(db,new URL(req.url,origin).searchParams,now(),a?.role==='admin',a?.address.toLowerCase()));}
      if(path==='/api/rounds'&&req.method==='GET')return json(200,{rounds:await rounds(db,now())});
      if(path==='/api/reputation'&&req.method==='GET'){const a=await account(req);if(!a)throw failure(401,'Sign in to view your reputation.');const r=new URL(req.url,origin).searchParams.get('round');return json(200,await reputation(db,a.address.toLowerCase(),now(),r===null?undefined:Number(r)));}
      const debateVote=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/debate\/(\d+)\/vote$/);
      const liveRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/live-talk$/);
      if(liveRoute&&['GET','POST'].includes(req.method))return json(200,await liveTalk.handle(await account(req),liveRoute[1],req.method==='POST'?await body(req):null));
      if(debateVote&&req.method==='POST')return json(200,await voteOnDebate(db,await account(req),debateVote[1],Number(debateVote[2]),await body(req),now()));
      if(path==='/api/rewards'&&req.method==='GET'){const balance=await readNeuron(REWARD_ADDRESS);return json(200,{address:REWARD_ADDRESS,balance:balance.balance,updatedAt:balance.updatedAt,...(await rewardGrowth(db,balance.balance,now()))});}
      const paymentStatus=path.match(/^\/api\/payments\/([a-f0-9-]{36})$/i);if(paymentStatus&&req.method==='GET')return json(200,await payments.status(await account(req),paymentStatus[1]));
      if(path==='/api/payments/prepare'&&req.method==='POST')return json(200,await payments.prepare((await account(req)),await body(req),now()));
      if(path==='/api/payments/confirm'&&req.method==='POST')return json(200,await payments.confirm((await account(req)),await body(req),now()));
      if(path==='/api/version'&&req.method==='GET')return json(200,{version:runningVersion});
      if(path==='/api/token/market'&&req.method==='GET')return json(200,await readMarket());
      if(path==='/api/token'&&req.method==='GET')return json(200,await readNeuron());
      if(path==='/api/token/balance'&&req.method==='GET'){const current=(await account(req));if(!current)throw failure(401,'Please sign in to view your balance.');return json(200,await readNeuron(await currentWalletForIdentity(db,current.address,{required:true})));}
      if(path==='/api/token/confirm'&&req.method==='POST'){const current=(await account(req));if(!current)throw failure(401,'Please sign in first.');const input=await body(req);if(input.contract!==NS_TOKEN.address||input.confirmed!==true)throw failure(400,'Confirm that Neuron Storm is visible in Pelagus.');(await db.prepare("INSERT INTO token_confirmations VALUES($1,$2,$3) ON CONFLICT(address) DO UPDATE SET contract=excluded.contract,confirmed_at=excluded.confirmed_at").run(current.address.toLowerCase(),NS_TOKEN.address,now()));return json(200,{confirmed:true});}
      if(path==='/api/wallet' && req.method==='GET'){const current=(await account(req));if(!current)throw failure(401,'Please sign in to view your wallet.');const address=await currentWalletForIdentity(db,current.address,{required:true});const neuron=await readNeuron(address);return json(200,{address,network:'Quai Mainnet',assets:[{name:NS_TOKEN.name,symbol:NS_TOKEN.symbol,type:'ERC-20',contract:NS_TOKEN.address,balance:neuron.balance}],updatedAt:neuron.updatedAt||new Date(now()).toISOString()});}
      if(path==='/api/actions/challenge'&&req.method==='POST'){
        const current=await account(req);
        if(!current)throw failure(401,'Please sign in first.');
        const input=await body(req,7100000);
        const challenge=await prepareAction(db,current,await actionSession(req),input.path,input.payload,origin,now());
        return json(200,{...challenge,...(current.method==='passkey'?{method:'passkey',options:await passkeys.actionOptions(current,challenge.message)}:{})});
      }
      const debateRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/debate$/);
      if(debateRoute&&['GET','POST'].includes(req.method))return json(200,(await debate(db,(await account(req)),debateRoute[1],await actionSession(req),new URL(req.url,origin).searchParams,req.method==='POST'?await body(req):null,now())));
      if (path === '/api/session' && req.method === 'GET') return json(200, { account: (await account(req)) || await passkeys.session(cookies(req).ns_passkey_session) });
      if(path==='/api/notifications'&&req.method==='GET'){const owner=await account(req);const result=await listNotifications(db,owner,new URL(req.url,origin).searchParams);tokenNotices?.schedule(owner);return json(200,result);}
      if(['/api/notifications/read','/api/notifications/read-all'].includes(path)&&req.method==='POST')return json(200,(await readNotifications(db,(await account(req)),await body(req),path.endsWith('read-all'),now())));
      if(path.startsWith('/api/admin/')){
        const current=(await account(req));(await requireAdmin(db,current));
        if(path==='/api/admin/reputation'&&req.method==='GET')return json(200,await reputationAdmin(db,new URL(req.url,origin).searchParams,now()));
        if(path==='/api/admin/archive.txt'&&req.method==='GET'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="neuron-storm-history.txt"');await pipeline(Readable.from((await archiveText(db))),res);return;}
        if(path==='/api/admin/reports'&&['GET','POST'].includes(req.method))return json(200,(await adminReports(db,current,req.method==='POST'?await body(req):null,new URL(req.url,origin).searchParams,now())));
        if(path==='/api/admin/rewards/confirm'&&req.method==='POST')return json(200,await confirmReward(current,await body(req),now()));
        if(path==='/api/admin/accepted'&&req.method==='GET')return json(200,(await acceptedAnswers(db,new URL(req.url,origin).searchParams)));
        if(path==='/api/admin/members'&&req.method==='GET')return json(200,await adminMembers(db,current,new URL(req.url,origin).searchParams));
        if(path==='/api/admin/verification'&&req.method==='GET'){
          const params=new URL(req.url,origin).searchParams,member=params.get('member')||'',before=Number(params.get('before')||Number.MAX_SAFE_INTEGER);
          const address=member.startsWith('passkey:')?(await db.prepare('SELECT address FROM passkey_community_accounts WHERE account_id=$1').get(member.slice(8)))?.address:member.toLowerCase();
          if(!/^0x[0-9a-f]{40}$/.test(address)||!Number.isSafeInteger(before)||before<1)throw failure(400,'Choose a valid member.');
          if(!await db.prepare('SELECT 1 FROM accounts WHERE address=$1').get(address))throw failure(404,'Member not found.');
          const events=await db.prepare(`SELECT e.id,e.message_id AS "messageId",e.question_id AS "questionId",f.name,e.previous_value AS "previousValue",e.value,e.counted,e.reason,e.occurred_at AS "occurredAt" FROM verification_events e JOIN verification_fields f ON f.id=e.field_id WHERE e.recipient=$1 AND e.id<$2 ORDER BY e.id DESC LIMIT 100`).all(address,before);
          return json(200,{fields:await verificationFields(db,address,now(),{admin:true}),events,nextBefore:events.length===100?events.at(-1).id:null});
        }
        if(path==='/api/admin/conversations'&&req.method==='GET')return json(200,(await adminList(db,current,new URL(req.url,origin).searchParams)));
        const route=path.match(/^\/api\/admin\/conversations\/([a-f0-9-]{36})(?:\/(delete|restore))?$/);
        if(route){if(!route[2]&&req.method==='GET')return json(200,{...(await adminThread(db,current,route[1])),serverTime:now()});if(route[2]&&req.method==='POST')return json(200,(await moderateThread(db,current,route[1],route[2],await body(req),now())));}
        throw failure(405,'This administration request is not supported.');
      }
      if(path==='/api/stats'&&req.method==='GET'){
        return json(200,{stats:{members:(await db.prepare("SELECT count(*) AS n FROM accounts").get()).n,topics:(await db.prepare("SELECT count(*) AS n FROM categories").get()).n,questions:(await db.prepare("SELECT count(*) AS n FROM questions WHERE deleted_at IS NULL AND closed_at IS NULL").get()).n,replies:(await db.prepare("SELECT count(*) AS n FROM replies r JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL AND q.closed_at IS NULL AND r.deleted_at IS NULL").get()).n}});
      }
      if(path==='/api/questions'){
        const current=(await account(req));
        if(req.method==='GET')return json(200,{questions:(await listQuestions(db,current,new URL(req.url,origin).searchParams.get('view')||'inbox')),serverTime:now()});
        if(req.method==='POST')return json(201,(await submitAction(db,current,await actionSession(req),path,await body(req),now(),passkeys.verifyAction)));
      }
      const acceptanceRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/accept$/);
      if(acceptanceRoute&&req.method==='POST'){const result=(await submitAction(db,(await account(req)),await actionSession(req),path,await body(req),now(),passkeys.verifyAction));return json(200,result);}
      const voteRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/replies\/(\d+)\/vote$/);
      if(voteRoute&&req.method==='POST')return json(200,(await voteOnReply(db,(await account(req)),voteRoute[1],Number(voteRoute[2]),await body(req),now())));
      const threadRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})(?:\/(replies|read))?$/);
      if(threadRoute){
        const current=(await account(req)),[,id,action]=threadRoute;
        if(!action&&req.method==='GET')return json(200,{thread:(await readThread(db,current,id)),serverTime:now()});
        if(action==='replies'&&req.method==='POST')return json(201,(await submitAction(db,current,await actionSession(req),path,await body(req),now(),passkeys.verifyAction)));
        if(action==='read'&&req.method==='POST')return json(200,(await markThreadRead(db,current,id,await body(req))));
      }
      if (path === '/api/profile' || path === '/api/categories') {
        const current = (await account(req));
        if (!current) throw failure(401, 'Your session has expired. Please sign in again.');
        const address = current.address.toLowerCase();
        if (path === '/api/categories' && req.method === 'GET') return json(200, { categories: (await readCategories(db,new URL(req.url,origin).searchParams.get('available')==='1')) });
        if (path === '/api/profile' && req.method === 'GET') return json(200, { profile: (await readProfile(db, address)), tokenSetupRequired: false, token:NS_TOKEN });
        if (path === '/api/profile' && req.method === 'POST') {
          const input = await body(req,1450000);
          return json(200, { profile: (await saveProfile(db, address, input, now())) });
        }
        throw failure(405, 'This method is not supported.');
      }
      if (path === '/api/challenge' && req.method === 'POST') {
        if(await passkeys.session(cookies(req).ns_passkey_session))throw failure(409,'Sign out before choosing a different account.');
        const input = await body(req);
        let address;
        try { address = getAddress(input.address); } catch { throw failure(400, 'Invalid wallet address.'); }
        if (!isQuaiAddress(address)) throw failure(400, "Select a QUAI account in Pelagus.");
        if(legal.published&&(input.termsAccepted!==true||input.termsHash!==legal.hash))throw failure(400,'Read and accept the current Terms of Use before signing.');
        const id = token(), browser = token(), issued = now(), expires = issued + 300000;
        const message = `Neuron Storm — sign in\n\nWebsite: ${origin}\nWallet address: ${address}\n\nThis signature confirms access to your Neuron Storm account.\nIt does not authorize a transaction or transfer of funds.${legal.published?`\n\nI am at least 18 and agree to the Neuron Storm Terms of Use, version ${legal.version}.\nI have been provided with the Privacy Notice.\nTerms: ${origin}/terms\nPrivacy: ${origin}/privacy\nDocument SHA-256: ${legal.hash}`:''}\n\nOne-time code: ${id}\nIssued at: ${new Date(issued).toISOString()}\nExpires at: ${new Date(expires).toISOString()}`;
        const previous = cookies(req).ns_challenge;
        if (previous) (await db.prepare("DELETE FROM challenges WHERE browser_hash=$1").run(hash(previous)));
        (await db.prepare("INSERT INTO challenges(id,browser_hash,address,message,expires,legal_hash) VALUES($1,$2,$3,$4,$5,$6)").run(id, hash(browser), address.toLowerCase(), message, expires,legal.published?legal.hash:null));
        res.setHeader('Set-Cookie', cookie('ns_challenge', browser, 300));
        return json(200, { id, message });
      }
      if (path === '/api/verify' && req.method === 'POST') {
        if(await passkeys.session(cookies(req).ns_passkey_session))throw failure(409,'Sign out before choosing a different account.');
        const { id, signature, registrationMethod } = await body(req);
        if (typeof id !== 'string' || typeof signature !== 'string' || signature.length > 300) throw failure(400, 'Invalid signature.');
        const browser = cookies(req).ns_challenge || '';
        // DELETE RETURNING atomically consumes the challenge, including failed signature attempts.
        const challenge = (await db.prepare("DELETE FROM challenges WHERE id=$1 AND browser_hash=$2 AND expires>$3 RETURNING *").get(id, hash(browser), now()));
        if (!challenge) throw failure(401, 'This challenge has expired or has already been used. Please sign in again.');
        if(legal.published&&challenge.legal_hash!==legal.hash)throw failure(409,'The Terms of Use have changed. Read them and sign in again.');
        let recovered;
        try { recovered = verifyMessage(challenge.message, signature).toLowerCase(); } catch { throw failure(401, 'The signature could not be verified.'); }
        if (recovered !== challenge.address) throw failure(401, 'The signature does not match the selected account.');
        const session = token();

        await db.transaction(async () => {
          const created=await db.prepare("INSERT INTO accounts VALUES($1,$2) ON CONFLICT DO NOTHING").run(recovered, now());
          if(created.changes===1&&['pelagus','blippay'].includes(registrationMethod))await db.prepare('INSERT INTO account_registration_methods(address,method,recorded_at) VALUES($1,$2,$3)').run(recovered,registrationMethod,now());
          if(challenge.legal_hash)(await db.prepare("INSERT INTO legal_acceptances VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING").run(recovered,challenge.legal_hash,now(),challenge.message,signature));
          const old = cookies(req).ns_session;
          if (old) (await db.prepare("DELETE FROM sessions WHERE token_hash=$1").run(hash(old)));
          (await db.prepare("INSERT INTO sessions VALUES($1,$2,$3)").run(hash(session), recovered, now() + 28800000));

        });
        res.setHeader('Set-Cookie', [cookie('ns_session', session, 28800), cookie('ns_challenge', '', 0)]);
        return json(200, { account: { address: getAddress(recovered), role: recovered === ADMIN ? 'admin' : 'member' } });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const current = cookies(req);
        const departing=(await account(req));if(departing)(await db.prepare("DELETE FROM globe_presence WHERE address=$1").run(departing.address.toLowerCase()));
        await passkeys.logout(current.ns_passkey_session);
        if (current.ns_session) (await db.prepare("DELETE FROM sessions WHERE token_hash=$1").run(hash(current.ns_session)));
        if (current.ns_challenge) (await db.prepare("DELETE FROM challenges WHERE browser_hash=$1").run(hash(current.ns_challenge)));
        res.setHeader('Set-Cookie', [cookie('ns_session', '', 0), cookie('ns_challenge', '', 0),cookie('ns_passkey_session','',0),cookie('ns_passkey_challenge','',0)]);
        return json(200, { ok: true });
      }
      const files = { '/live-talk.js':['public/live-talk.js','text/javascript'], '/livekit-client.js':['node_modules/livekit-client/dist/livekit-client.esm.mjs','text/javascript'], '/verification-ui.js':['public/verification-ui.js','text/javascript'], '/file-ui.js':['public/file-ui.js','text/javascript'], '/profile-validation.js':['public/profile-validation.js','text/javascript'], '/pelagus-mark.png':['public/brands/pelagus-mark.png','image/png'], '/blip-mark.svg':['public/brands/blip-mark.svg','image/svg+xml'], '/passkey-ui.js':['public/passkey-ui.js','text/javascript'], '/fonts/audiowide/Audiowide-Regular.ttf':['public/fonts/audiowide/Audiowide-Regular.ttf','font/ttf'], '/reputation-ui.js':['public/reputation-ui.js','text/javascript'], '/question-tools.js':['public/question-tools.js','text/javascript'], '/member-tools.js':['public/member-tools.js','text/javascript'], '/topic-suggestions.js':['public/topic-suggestions.js','text/javascript'], '/globe-controls.js':['public/globe-controls.js','text/javascript'], '/wallet-provider.js':['public/wallet-provider.js','text/javascript'], '/globe.js':['public/globe.js','text/javascript'], '/world-map.json':['public/world-map.json','application/json'], '/lifecycle-ui.js':['public/lifecycle-ui.js','text/javascript'], '/': ['public/index.html', 'text/html'], '/rewards-ui.js':['public/rewards-ui.js','text/javascript'], '/notification-sound.js':['public/notification-sound.js','text/javascript'], '/neuron-background.js':['public/neuron-background.js','text/javascript'], '/debate.js':['public/debate.js','text/javascript'], '/token-ui.js':['public/token-ui.js','text/javascript'], '/app.js': ['public/app.js', 'text/javascript'], '/conversations.js': ['public/conversations.js', 'text/javascript'], '/wallet.js': ['public/wallet.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'], '/logo.svg': ['public/logo.svg', 'image/svg+xml'], '/neuron-storm-logo.png': ['public/neuron-storm-logo.png', 'image/png'] };
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
        if(path==='/'){const version=runningVersion;return res.end(readFileSync(join(root,file),'utf8').replace('__APP_VERSION__',version));}
        return res.end(readFileSync(join(root, file)));
      }
      return json(404, { error: 'Page not found.' });
    } catch (error) {
      if(res.headersSent||res.destroyed){if(!res.destroyed)res.destroy();return;}
      if(req.method==='POST'&&!req.complete){res.setHeader('Connection','close');req.resume();}
      if (!error.status) console.error('Request failed:', error.message);
      return json(error.status || 500, { error: error.status ? error.message : 'Server error. Please try again.' });
    }
  });
  let expiryTimer,provisionTimer,provisionWork,sendTimer,sendWork,liveTimer,liveWork;
  const liveMaintenance=()=>{if(!liveWork)liveWork=(async()=>{await settleVerification(db,now());await liveTalk.tick();})().catch(()=>console.error('[live-talk] maintenance deferred')).finally(()=>{liveWork=null;});};
  server.on('listening',()=>{liveMaintenance();liveTimer=setInterval(liveMaintenance,3000);liveTimer.unref();});
  const reconcileSends=()=>{
    if(!feeWallet?.reconciler||sendWork)return;
    sendWork=feeWallet.reconciler.poll().catch(()=>console.error('Send verification deferred; no transaction resubmitted.')).finally(()=>{sendWork=null;});
  };
  const provisionApproved=()=>{
    if((!walletExecutor?.provisioner&&!autoActivation)||provisionWork)return;
    provisionWork=(async()=>{
      // Read-only chain observations plus idempotent DB settlement; never resubmit.
      if(autoActivation){await autoActivation.runNext();return;}
      const next=await db.prepare("SELECT account_id FROM passkey_clone_approvals WHERE approved=TRUE AND phase='quoted' AND expires_at>$1 ORDER BY expires_at LIMIT 1").get(now());
      if(next)await walletExecutor.provisioner.execute(next.account_id);
    })().catch(()=>console.error('Approved wallet provisioning stopped; manual review required.')).finally(()=>{provisionWork=null;});
  };
  const runMaintenance=()=>maintain().catch(()=>console.error('Question maintenance failed.'));
  server.on('listening',()=>{runMaintenance();expiryTimer=setInterval(runMaintenance,10000);expiryTimer.unref();if(walletExecutor?.provisioner||autoActivation){provisionApproved();provisionTimer=setInterval(provisionApproved,10000);provisionTimer.unref();}});
  server.on('listening',()=>{if(feeWallet?.reconciler){reconcileSends();sendTimer=setInterval(reconcileSends,10000);sendTimer.unref();}});
  server.on('close',()=>{clearInterval(expiryTimer);clearInterval(provisionTimer);clearInterval(sendTimer);clearInterval(liveTimer);});
  return { server, db, async close(){clearInterval(liveTimer);if(liveWork)await liveWork;clearInterval(expiryTimer);clearInterval(provisionTimer);clearInterval(sendTimer);if(server.listening)await new Promise(resolve=>server.close(resolve));if(maintenance)await maintenance.catch(()=>{});if(provisionWork)await provisionWork;if(sendWork)await sendWork;await db.close();} };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = (await createApp());
  server.listen(3000, '127.0.0.1', () => console.log('Neuron Storm: http://localhost:3000'));
}
