import {randomUUID} from 'node:crypto';
import {requireProfile,allowed} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function initContactPreferences(db){db.exec(`CREATE TABLE IF NOT EXISTS blocked_members(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES accounts(address),target TEXT NOT NULL REFERENCES accounts(address),UNIQUE(owner,target));
 CREATE TABLE IF NOT EXISTS deadline_reminders(id INTEGER PRIMARY KEY,address TEXT NOT NULL REFERENCES accounts(address),question_id TEXT UNIQUE NOT NULL REFERENCES questions(id),created_at INTEGER NOT NULL,read_at INTEGER);`);}
export function isBlocked(db,a,b){return !!db.prepare('SELECT 1 FROM blocked_members WHERE (owner=? AND target=?) OR (owner=? AND target=?)').get(a,b,b,a);}
export function ownBlock(db,owner,target){return db.prepare('SELECT id FROM blocked_members WHERE owner=? AND target=?').get(owner,target)?.id||null;}
export function blocks(db,account,input){requireProfile(db,account);const owner=account.address.toLowerCase();
 if(input){if(input.action==='remove'){if(typeof input.id!=='string')throw fail(400,'Choose a blocked member.');db.prepare('DELETE FROM blocked_members WHERE owner=? AND id=?').run(owner,input.id);}
 else if(input.action==='add'){const q=allowed(db,input.questionId,account),r=input.replyId?db.prepare('SELECT author FROM replies WHERE id=? AND question_id=?').get(input.replyId,q.id):q;if(!r)throw fail(404,'Member not found.');if(r.author===owner)throw fail(400,'You cannot block yourself.');db.prepare('INSERT OR IGNORE INTO blocked_members VALUES(?,?,?)').run(randomUUID(),owner,r.author);}
 else throw fail(400,'Choose block or unblock.');}
 return {members:db.prepare('SELECT b.id,p.nickname FROM blocked_members b JOIN profiles p ON p.address=b.target WHERE b.owner=? ORDER BY p.nickname').all(owner)};
}
export function remindDeadlines(db,now){db.prepare(`INSERT OR IGNORE INTO deadline_reminders(address,question_id,created_at) SELECT author,id,? FROM questions WHERE closed_at IS NULL AND deleted_at IS NULL AND created_at<=? AND created_at>?`).run(now,now-6*86400000,now-7*86400000);}
