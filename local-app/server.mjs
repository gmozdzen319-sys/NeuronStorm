import {loadLegal,initLegal,legalPage} from './legal.mjs';
import {blocks,remindDeadlines} from './contact-preferences.mjs';
import {initMemberTools,library,reportContent,adminReports} from './member-tools.mjs';
import {createRewardConfirmation} from './reward-confirmation.mjs';
import {initArchive,archiveText} from './archive.mjs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {initGlobe,globeData,clientIp,lookupCountry} from './geography.mjs';
import {expireQuestions,acceptedAnswers} from './lifecycle.mjs';
import {initPayments,createPayments,REWARD_ADDRESS} from './payments.mjs';
import {initCommunity,presence,ranking,rewardGrowth} from './community.mjs';
import {initActions,prepareAction,submitAction} from './actions.mjs';
import {initDebate,debate} from './debate.mjs';
import {createMarketReader} from './token-market.mjs';
import {NS_TOKEN,createNeuronReader} from './neuron-token.mjs';
import {listNotifications,readNotifications} from './notifications.mjs';
import {requireAdmin,adminList,adminThread,moderateThread} from './admin.mjs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAddress, verifyMessage, isQuaiAddress } from 'quais';
import { initProfiles, readProfile, readCategories, saveProfile } from './profiles.mjs';
import { initThreads, listQuestions, readThread, previewQuestion, markThreadRead, voteOnReply } from './threads.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export const ADMIN = '0x00198C77e2cce7C839A34aF8C54Eb82106862640'.toLowerCase();
const token = () => randomBytes(32).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=')));
const failure = (status, message) => Object.assign(new Error(message), { status });

export function createApp({ database = join(root, 'data', 'auth.sqlite'), origin = 'http://localhost:3000', now = Date.now, tokenFetch = fetch, marketFetch = fetch, paymentFetch = fetch, geoLookup=lookupCountry, trustProxy=process.env.RENDER==='true', legal=loadLegal() } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const runningVersion=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts(address TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, address TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, address TEXT NOT NULL REFERENCES accounts(address), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires);`);
  initLegal(db,legal);
  initProfiles(db);
  initThreads(db);
  initArchive(db);
  initMemberTools(db);
  initActions(db);
  initDebate(db);
  initPayments(db);initCommunity(db);initGlobe(db);
  const maintain=()=>{expireQuestions(db,now());remindDeadlines(db,now());};
  const confirmReward=createRewardConfirmation(db,paymentFetch);
  const payments=createPayments(db,paymentFetch,now);
  db.exec('CREATE TABLE IF NOT EXISTS token_confirmations(address TEXT PRIMARY KEY REFERENCES accounts(address), contract TEXT NOT NULL, confirmed_at INTEGER NOT NULL)');
  const readMarket=createMarketReader(marketFetch);
  const readNeuron=createNeuronReader(tokenFetch);
  const limits = new Map();
  const cookie = (name, value, age) => `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`;
  function account(req) {
    const session = cookies(req).ns_session;
    if (!session || !/^[a-f0-9]{64}$/.test(session)) return null;
    const row = db.prepare('SELECT address FROM sessions WHERE token_hash=? AND expires>?').get(hash(session), now());
    return row ? { address: getAddress(row.address), role: row.address === ADMIN ? 'admin' : 'member' } : null;
  }
  async function body(req) {
    if (req.headers['content-type'] !== 'application/json') throw failure(415, 'JSON format is required.');
    let data = '';
    for await (const chunk of req) {
      data += chunk;
      if (Buffer.byteLength(data) > 32768) throw failure(413, 'The request is too large.');
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
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) throw failure(403, 'Open the website at ' + origin);
      const path = new URL(req.url, origin).pathname;
      if (req.method === 'POST') {
        if (req.headers.origin !== origin) throw failure(403, 'This request origin is not allowed.');
        const isDebate=/^\/api\/questions\/[a-f0-9-]{36}\/debate$/.test(path);
        const ip = (account(req)?.address.toLowerCase()||req.socket.remoteAddress)+(isDebate?':debate':':actions');
        const entry = limits.get(ip);
        const counter = !entry || entry.until <= now() ? { count: 0, until: now() + 60000 } : entry;
        limits.set(ip, counter);
        if (++counter.count > (isDebate?120:60)) throw failure(429, 'Too many attempts. Please try again in a minute.');
        db.prepare('DELETE FROM challenges WHERE expires<=?').run(now());
        db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
      }
      if(req.method==='GET'&&path==='/api/legal')return json(200,{published:legal.published,version:legal.version,hash:legal.hash});
      if(req.method==='GET'&&['/terms','/privacy'].includes(path)){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(legalPage(legal,path==='/terms'?'terms':'privacy'));}
      if(path.startsWith('/api/'))maintain();
      if(path==='/api/blocks'&&['GET','POST'].includes(req.method))return json(200,blocks(db,account(req),req.method==='POST'?await body(req):null));
      if(path==='/api/library'&&['GET','POST'].includes(req.method))return json(200,library(db,account(req),req.method==='POST'?await body(req):null,new URL(req.url,origin).searchParams,now()));
      if(path==='/api/reports'&&req.method==='POST')return json(200,reportContent(db,account(req),await body(req),now()));
      if(path==='/api/questions/preview'&&req.method==='POST')return json(200,previewQuestion(db,account(req),await body(req)));
      if(path==='/api/globe'&&['GET','POST'].includes(req.method))return json(200,globeData(db,account(req),clientIp(req,trustProxy),req.method==='POST'?await body(req):null,now(),geoLookup));
      if(path==='/api/presence'&&req.method==='POST'){
        const input=await body(req);let visitor=cookies(req).ns_visitor;
        if(!visitor||!/^[a-f0-9]{64}$/.test(visitor))visitor=token();
        res.setHeader('Set-Cookie',cookie('ns_visitor',visitor,604800));
        return json(200,presence(db,hash(visitor),account(req),input.active===true,now()));
      }
      if(path==='/api/ranking'&&req.method==='GET')return json(200,ranking(db,new URL(req.url,origin).searchParams,now(),account(req)?.role==='admin'));
      if(path==='/api/rewards'&&req.method==='GET'){const balance=await readNeuron(REWARD_ADDRESS);return json(200,{address:REWARD_ADDRESS,balance:balance.balance,updatedAt:balance.updatedAt,...rewardGrowth(db,balance.balance,now())});}
      if(path==='/api/payments/prepare'&&req.method==='POST')return json(200,await payments.prepare(account(req),await body(req),now()));
      if(path==='/api/payments/confirm'&&req.method==='POST')return json(200,await payments.confirm(account(req),await body(req),now()));
      if(path==='/api/version'&&req.method==='GET')return json(200,{version:runningVersion});
      if(path==='/api/token/market'&&req.method==='GET')return json(200,await readMarket());
      if(path==='/api/token'&&req.method==='GET')return json(200,await readNeuron());
      if(path==='/api/token/balance'&&req.method==='GET'){const current=account(req);if(!current)throw failure(401,'Please sign in to view your balance.');return json(200,await readNeuron(current.address));}
      if(path==='/api/token/confirm'&&req.method==='POST'){const current=account(req);if(!current)throw failure(401,'Please sign in first.');const input=await body(req);if(input.contract!==NS_TOKEN.address||input.confirmed!==true)throw failure(400,'Confirm that Neuron Storm is visible in Pelagus.');db.prepare('INSERT OR REPLACE INTO token_confirmations VALUES(?,?,?)').run(current.address.toLowerCase(),NS_TOKEN.address,now());return json(200,{confirmed:true});}
      if(path==='/api/wallet' && req.method==='GET'){const current=account(req);if(!current)throw failure(401,'Please sign in to view your wallet.');const neuron=await readNeuron(current.address);return json(200,{address:current.address,network:'Quai Mainnet',assets:[{name:NS_TOKEN.name,symbol:NS_TOKEN.symbol,type:'ERC-20',contract:NS_TOKEN.address,balance:neuron.balance}],updatedAt:neuron.updatedAt||new Date(now()).toISOString()});}
      if(path==='/api/actions/challenge'&&req.method==='POST'){const input=await body(req);return json(200,prepareAction(db,account(req),hash(cookies(req).ns_session||''),input.path,input.payload,origin,now()));}
      const debateRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/debate$/);
      if(debateRoute&&['GET','POST'].includes(req.method))return json(200,debate(db,account(req),debateRoute[1],hash(cookies(req).ns_session||''),new URL(req.url,origin).searchParams,req.method==='POST'?await body(req):null,now()));
      if (path === '/api/session' && req.method === 'GET') return json(200, { account: account(req) });
      if(path==='/api/notifications'&&req.method==='GET')return json(200,listNotifications(db,account(req),new URL(req.url,origin).searchParams));
      if(['/api/notifications/read','/api/notifications/read-all'].includes(path)&&req.method==='POST')return json(200,readNotifications(db,account(req),await body(req),path.endsWith('read-all'),now()));
      if(path.startsWith('/api/admin/')){
        const current=account(req);requireAdmin(db,current);
        if(path==='/api/admin/archive.txt'&&req.method==='GET'){res.setHeader('Content-Type','text/plain; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="neuron-storm-history.txt"');await pipeline(Readable.from(archiveText(db)),res);return;}
        if(path==='/api/admin/reports'&&['GET','POST'].includes(req.method))return json(200,adminReports(db,current,req.method==='POST'?await body(req):null,new URL(req.url,origin).searchParams,now()));
        if(path==='/api/admin/rewards/confirm'&&req.method==='POST')return json(200,await confirmReward(current,await body(req),now()));
        if(path==='/api/admin/accepted'&&req.method==='GET')return json(200,acceptedAnswers(db,new URL(req.url,origin).searchParams));
        if(path==='/api/admin/members'&&req.method==='GET'){
          const params=new URL(req.url,origin).searchParams,page=Number(params.get('page')||1),search=(params.get('search')||'').trim();
          if(!Number.isSafeInteger(page)||page<1||page>100000||search.length>100)throw failure(400,'Invalid member search.');
          const filter="(?='' OR instr(lower(COALESCE(p.nickname,'')),lower(?))>0 OR instr(a.address,lower(?))>0)";
          const args=[search,search,search],total=db.prepare(`SELECT count(*) AS n FROM accounts a LEFT JOIN profiles p ON p.address=a.address WHERE ${filter}`).get(...args).n;
          return json(200,{page,pages:Math.max(1,Math.ceil(total/50)),members:db.prepare(`SELECT a.address,COALESCE(p.nickname,'Profile incomplete') AS nickname FROM accounts a LEFT JOIN profiles p ON p.address=a.address WHERE ${filter} ORDER BY a.created_at,a.address LIMIT 50 OFFSET ?`).all(...args,(page-1)*50)});
        }
        if(path==='/api/admin/conversations'&&req.method==='GET')return json(200,adminList(db,current,new URL(req.url,origin).searchParams));
        const route=path.match(/^\/api\/admin\/conversations\/([a-f0-9-]{36})(?:\/(delete|restore))?$/);
        if(route){if(!route[2]&&req.method==='GET')return json(200,{...adminThread(db,current,route[1]),serverTime:now()});if(route[2]&&req.method==='POST')return json(200,moderateThread(db,current,route[1],route[2],await body(req),now()));}
        throw failure(405,'This administration request is not supported.');
      }
      if(path==='/api/stats'&&req.method==='GET'){
        return json(200,{stats:{members:db.prepare('SELECT count(*) AS n FROM accounts').get().n,topics:db.prepare('SELECT count(*) AS n FROM categories').get().n,questions:db.prepare('SELECT count(*) AS n FROM questions WHERE deleted_at IS NULL AND closed_at IS NULL').get().n,replies:db.prepare('SELECT count(*) AS n FROM replies r JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL AND q.closed_at IS NULL AND r.deleted_at IS NULL').get().n}});
      }
      if(path==='/api/questions'){
        const current=account(req);
        if(req.method==='GET')return json(200,{questions:listQuestions(db,current,new URL(req.url,origin).searchParams.get('view')||'inbox'),serverTime:now()});
        if(req.method==='POST')return json(201,submitAction(db,current,hash(cookies(req).ns_session||''),path,await body(req),now()));
      }
      const acceptanceRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/accept$/);
      if(acceptanceRoute&&req.method==='POST'){const result=submitAction(db,account(req),hash(cookies(req).ns_session||''),path,await body(req),now());return json(200,result);}
      const voteRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/replies\/(\d+)\/vote$/);
      if(voteRoute&&req.method==='POST')return json(200,voteOnReply(db,account(req),voteRoute[1],Number(voteRoute[2]),await body(req),now()));
      const threadRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})(?:\/(replies|read))?$/);
      if(threadRoute){
        const current=account(req),[,id,action]=threadRoute;
        if(!action&&req.method==='GET')return json(200,{thread:readThread(db,current,id),serverTime:now()});
        if(action==='replies'&&req.method==='POST')return json(201,submitAction(db,current,hash(cookies(req).ns_session||''),path,await body(req),now()));
        if(action==='read'&&req.method==='POST')return json(200,markThreadRead(db,current,id,await body(req)));
      }
      if (path === '/api/profile' || path === '/api/categories') {
        const current = account(req);
        if (!current) throw failure(401, 'Your session has expired. Please sign in again.');
        const address = current.address.toLowerCase();
        if (path === '/api/categories' && req.method === 'GET') return json(200, { categories: readCategories(db,new URL(req.url,origin).searchParams.get('available')==='1') });
        if (path === '/api/profile' && req.method === 'GET') return json(200, { profile: readProfile(db, address), tokenSetupRequired: false, token:NS_TOKEN });
        if (path === '/api/profile' && req.method === 'POST') {
          const input = await body(req);
          return json(200, { profile: saveProfile(db, address, input, now()) });
        }
        throw failure(405, 'This method is not supported.');
      }
      if (path === '/api/challenge' && req.method === 'POST') {
        const input = await body(req);
        let address;
        try { address = getAddress(input.address); } catch { throw failure(400, 'Invalid wallet address.'); }
        if (!isQuaiAddress(address)) throw failure(400, 'Select a QUAI account in Pelagus.');
        if(legal.published&&(input.termsAccepted!==true||input.termsHash!==legal.hash))throw failure(400,'Read and accept the current Terms of Use before signing.');
        const id = token(), browser = token(), issued = now(), expires = issued + 300000;
        const message = `Neuron Storm — sign in\n\nWebsite: ${origin}\nWallet address: ${address}\n\nThis signature confirms access to your Neuron Storm account.\nIt does not authorize a transaction or transfer of funds.${legal.published?`\n\nI am at least 18 and agree to the Neuron Storm Terms of Use, version ${legal.version}.\nI have been provided with the Privacy Notice.\nTerms: ${origin}/terms\nPrivacy: ${origin}/privacy\nDocument SHA-256: ${legal.hash}`:''}\n\nOne-time code: ${id}\nIssued at: ${new Date(issued).toISOString()}\nExpires at: ${new Date(expires).toISOString()}`;
        const previous = cookies(req).ns_challenge;
        if (previous) db.prepare('DELETE FROM challenges WHERE browser_hash=?').run(hash(previous));
        db.prepare('INSERT INTO challenges(id,browser_hash,address,message,expires,legal_hash) VALUES(?,?,?,?,?,?)').run(id, hash(browser), address.toLowerCase(), message, expires,legal.published?legal.hash:null);
        res.setHeader('Set-Cookie', cookie('ns_challenge', browser, 300));
        return json(200, { id, message });
      }
      if (path === '/api/verify' && req.method === 'POST') {
        const { id, signature } = await body(req);
        if (typeof id !== 'string' || typeof signature !== 'string' || signature.length > 300) throw failure(400, 'Invalid signature.');
        const browser = cookies(req).ns_challenge || '';
        // DELETE RETURNING atomically consumes the challenge, including failed signature attempts.
        const challenge = db.prepare('DELETE FROM challenges WHERE id=? AND browser_hash=? AND expires>? RETURNING *').get(id, hash(browser), now());
        if (!challenge) throw failure(401, 'This challenge has expired or has already been used. Please sign in again.');
        if(legal.published&&challenge.legal_hash!==legal.hash)throw failure(409,'The Terms of Use have changed. Read them and sign in again.');
        let recovered;
        try { recovered = verifyMessage(challenge.message, signature).toLowerCase(); } catch { throw failure(401, 'The signature could not be verified.'); }
        if (recovered !== challenge.address) throw failure(401, 'The signature does not match the selected account.');
        const session = token();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?)').run(recovered, now());
          if(challenge.legal_hash)db.prepare('INSERT OR IGNORE INTO legal_acceptances VALUES(?,?,?,?,?)').run(recovered,challenge.legal_hash,now(),challenge.message,signature);
          const old = cookies(req).ns_session;
          if (old) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(old));
          db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(session), recovered, now() + 28800000);
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        res.setHeader('Set-Cookie', [cookie('ns_session', session, 28800), cookie('ns_challenge', '', 0)]);
        return json(200, { account: { address: getAddress(recovered), role: recovered === ADMIN ? 'admin' : 'member' } });
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const current = cookies(req);
        const departing=account(req);if(departing)db.prepare('DELETE FROM globe_presence WHERE address=?').run(departing.address.toLowerCase());
        if (current.ns_session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(current.ns_session));
        if (current.ns_challenge) db.prepare('DELETE FROM challenges WHERE browser_hash=?').run(hash(current.ns_challenge));
        res.setHeader('Set-Cookie', [cookie('ns_session', '', 0), cookie('ns_challenge', '', 0)]);
        return json(200, { ok: true });
      }
      const files = { '/question-tools.js':['public/question-tools.js','text/javascript'], '/member-tools.js':['public/member-tools.js','text/javascript'], '/topic-suggestions.js':['public/topic-suggestions.js','text/javascript'], '/globe-controls.js':['public/globe-controls.js','text/javascript'], '/wallet-provider.js':['public/wallet-provider.js','text/javascript'], '/globe.js':['public/globe.js','text/javascript'], '/world-map.json':['public/world-map.json','application/json'], '/lifecycle-ui.js':['public/lifecycle-ui.js','text/javascript'], '/': ['public/index.html', 'text/html'], '/rewards-ui.js':['public/rewards-ui.js','text/javascript'], '/notification-sound.js':['public/notification-sound.js','text/javascript'], '/neuron-background.js':['public/neuron-background.js','text/javascript'], '/debate.js':['public/debate.js','text/javascript'], '/token-ui.js':['public/token-ui.js','text/javascript'], '/app.js': ['public/app.js', 'text/javascript'], '/conversations.js': ['public/conversations.js', 'text/javascript'], '/wallet.js': ['public/wallet.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'], '/logo.svg': ['public/logo.svg', 'image/svg+xml'], '/neuron-storm-logo.png': ['public/neuron-storm-logo.png', 'image/png'] };
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
  let expiryTimer;
  server.on('listening',()=>{maintain();expiryTimer=setInterval(()=>{try{maintain();}catch(error){console.error('Question expiry failed:',error.message);}},10000);expiryTimer.unref();});
  server.on('close',()=>clearInterval(expiryTimer));
  return { server, db };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = createApp();
  server.listen(3000, '127.0.0.1', () => console.log('Neuron Storm: http://localhost:3000'));
}



