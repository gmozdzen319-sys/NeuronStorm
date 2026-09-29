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
import { initThreads, createQuestion, listQuestions, readThread, replyToThread, markThreadRead, voteOnReply } from './threads.mjs';

const root = dirname(fileURLToPath(import.meta.url));
export const ADMIN = '0x00198C77e2cce7C839A34aF8C54Eb82106862640'.toLowerCase();
const token = () => randomBytes(32).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=')));
const failure = (status, message) => Object.assign(new Error(message), { status });

export function createApp({ database = join(root, 'data', 'auth.sqlite'), origin = 'http://localhost:3000', now = Date.now } = {}) {
  if (database !== ':memory:') mkdirSync(dirname(database), { recursive: true });
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS accounts(address TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS challenges(id TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, address TEXT NOT NULL, message TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, address TEXT NOT NULL REFERENCES accounts(address), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
    CREATE INDEX IF NOT EXISTS challenges_expiry ON challenges(expires);`);
  initProfiles(db);
  initThreads(db);
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
        const ip = req.socket.remoteAddress;
        const entry = limits.get(ip);
        const counter = !entry || entry.until <= now() ? { count: 0, until: now() + 60000 } : entry;
        limits.set(ip, counter);
        if (++counter.count > 60) throw failure(429, 'Too many attempts. Please try again in a minute.');
        db.prepare('DELETE FROM challenges WHERE expires<=?').run(now());
        db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());
      }
      if (path === '/api/session' && req.method === 'GET') return json(200, { account: account(req) });
      if(path==='/api/notifications'&&req.method==='GET')return json(200,listNotifications(db,account(req),new URL(req.url,origin).searchParams));
      if(['/api/notifications/read','/api/notifications/read-all'].includes(path)&&req.method==='POST')return json(200,readNotifications(db,account(req),await body(req),path.endsWith('read-all'),now()));
      if(path.startsWith('/api/admin/')){
        const current=account(req);requireAdmin(db,current);
        if(path==='/api/admin/conversations'&&req.method==='GET')return json(200,adminList(db,current,new URL(req.url,origin).searchParams));
        const route=path.match(/^\/api\/admin\/conversations\/([a-f0-9-]{36})(?:\/(delete|restore))?$/);
        if(route){if(!route[2]&&req.method==='GET')return json(200,adminThread(db,current,route[1]));if(route[2]&&req.method==='POST')return json(200,moderateThread(db,current,route[1],route[2],await body(req),now()));}
        throw failure(405,'This administration request is not supported.');
      }
      if(path==='/api/stats'&&req.method==='GET'){
        if(!account(req))throw failure(401,'Your session has expired. Please sign in again.');
        return json(200,{stats:{members:db.prepare('SELECT count(*) AS n FROM accounts').get().n,topics:db.prepare('SELECT count(*) AS n FROM categories').get().n,questions:db.prepare('SELECT count(*) AS n FROM questions WHERE deleted_at IS NULL').get().n,replies:db.prepare('SELECT count(*) AS n FROM replies r JOIN questions q ON q.id=r.question_id WHERE q.deleted_at IS NULL').get().n}});
      }
      if(path==='/api/questions'){
        const current=account(req);
        if(req.method==='GET')return json(200,{questions:listQuestions(db,current,new URL(req.url,origin).searchParams.get('view')||'inbox')});
        if(req.method==='POST')return json(201,createQuestion(db,current,await body(req),now()));
      }
      const voteRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})\/replies\/(\d+)\/vote$/);
      if(voteRoute&&req.method==='POST')return json(200,voteOnReply(db,account(req),voteRoute[1],Number(voteRoute[2]),await body(req)));
      const threadRoute=path.match(/^\/api\/questions\/([a-f0-9-]{36})(?:\/(replies|read))?$/);
      if(threadRoute){
        const current=account(req),[,id,action]=threadRoute;
        if(!action&&req.method==='GET')return json(200,{thread:readThread(db,current,id)});
        if(action==='replies'&&req.method==='POST')return json(201,replyToThread(db,current,id,await body(req),now()));
        if(action==='read'&&req.method==='POST')return json(200,markThreadRead(db,current,id,await body(req)));
      }
      if (path === '/api/profile' || path === '/api/categories') {
        const current = account(req);
        if (!current) throw failure(401, 'Your session has expired. Please sign in again.');
        const address = current.address.toLowerCase();
        if (path === '/api/categories' && req.method === 'GET') return json(200, { categories: readCategories(db,new URL(req.url,origin).searchParams.get('available')==='1') });
        if (path === '/api/profile' && req.method === 'GET') return json(200, { profile: readProfile(db, address) });
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
        const id = token(), browser = token(), issued = now(), expires = issued + 300000;
        const message = `Neuron Storm — sign in\n\nWebsite: ${origin}\nWallet address: ${address}\n\nThis signature confirms access to your Neuron Storm account.\nIt does not authorize a transaction or transfer of funds.\n\nOne-time code: ${id}\nIssued at: ${new Date(issued).toISOString()}\nExpires at: ${new Date(expires).toISOString()}`;
        const previous = cookies(req).ns_challenge;
        if (previous) db.prepare('DELETE FROM challenges WHERE browser_hash=?').run(hash(previous));
        db.prepare('INSERT INTO challenges VALUES(?,?,?,?,?)').run(id, hash(browser), address.toLowerCase(), message, expires);
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
        let recovered;
        try { recovered = verifyMessage(challenge.message, signature).toLowerCase(); } catch { throw failure(401, 'The signature could not be verified.'); }
        if (recovered !== challenge.address) throw failure(401, 'The signature does not match the selected account.');
        const session = token();
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?)').run(recovered, now());
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
        if (current.ns_session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(current.ns_session));
        if (current.ns_challenge) db.prepare('DELETE FROM challenges WHERE browser_hash=?').run(hash(current.ns_challenge));
        res.setHeader('Set-Cookie', [cookie('ns_session', '', 0), cookie('ns_challenge', '', 0)]);
        return json(200, { ok: true });
      }
      const files = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/conversations.js': ['public/conversations.js', 'text/javascript'], '/wallet.js': ['public/wallet.js', 'text/javascript'], '/style.css': ['public/style.css', 'text/css'], '/favicon.svg': ['public/favicon.svg', 'image/svg+xml'], '/logo.svg': ['public/logo.svg', 'image/svg+xml'], '/neuron-storm-logo.png': ['public/neuron-storm-logo.png', 'image/png'] };
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
        if(path==='/'){const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;return res.end(readFileSync(join(root,file),'utf8').replace('__APP_VERSION__',version));}
        return res.end(readFileSync(join(root, file)));
      }
      return json(404, { error: 'Page not found.' });
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.message);
      return json(error.status || 500, { error: error.status ? error.message : 'Server error. Please try again.' });
    }
  });
  return { server, db };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { server } = createApp();
  server.listen(3000, '127.0.0.1', () => console.log('Neuron Storm: http://localhost:3000'));
}



