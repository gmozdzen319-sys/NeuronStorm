import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function loadLegal(config=JSON.parse(read('./legal-config.json'))){
  const ready=Boolean(config.published&&config.operator?.trim()&&config.country?.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.contactEmail||'')&&/^\d{4}-\d{2}-\d{2}$/.test(config.effectiveDate||'')&&config.version?.trim());
  if(config.published&&!ready)throw new Error('Published terms require an operator, country, contact email, effective date and version.');
  const header=`<p class="eyebrow">NEURON STORM · ${ready?'LEGAL INFORMATION':'DRAFT — NOT YET IN FORCE'}</p><p>Version ${escape(config.version)} · ${ready?'Effective '+escape(config.effectiveDate):'Awaiting operator details and final review'}</p><p>Operator: ${escape(config.operator||'[to be completed]')}<br>Country: ${escape(config.country||'[to be completed]')}<br>Contact: ${escape(config.contactEmail||'[to be completed]')}</p>`;
  const terms=header+read('./legal/terms.html'),privacy=header+read('./legal/privacy.html');
  const hash=createHash('sha256').update(JSON.stringify({version:config.version,terms,privacy})).digest('hex');
  return {published:ready,version:config.version,hash,terms,privacy};
}
export function initLegal(db,legal){
  db.exec(`CREATE TABLE IF NOT EXISTS legal_documents(hash TEXT PRIMARY KEY, version TEXT NOT NULL, terms TEXT NOT NULL, privacy TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS legal_acceptances(address TEXT NOT NULL REFERENCES accounts(address), document_hash TEXT NOT NULL REFERENCES legal_documents(hash), accepted_at INTEGER NOT NULL, message TEXT NOT NULL, signature TEXT NOT NULL, PRIMARY KEY(address,document_hash));`);
  if(!db.prepare('PRAGMA table_info(challenges)').all().some(c=>c.name==='legal_hash'))db.exec('ALTER TABLE challenges ADD COLUMN legal_hash TEXT');
  if(legal.published)db.prepare('INSERT OR IGNORE INTO legal_documents VALUES(?,?,?,?)').run(legal.hash,legal.version,legal.terms,legal.privacy);
}
export function legalPage(legal,kind){
  const title=kind==='privacy'?'Privacy Notice':'Terms of Use';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Neuron Storm</title><link rel="stylesheet" href="/style.css"></head><body><main class="legal-page"><a href="/">← Back to Neuron Storm</a><h1>${title}</h1>${legal[kind]}<p><a href="/terms">Terms of Use</a> · <a href="/privacy">Privacy Notice</a></p></main></body></html>`;
}
