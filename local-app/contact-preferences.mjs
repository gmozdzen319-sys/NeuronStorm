import {randomUUID} from 'node:crypto';
import {requireProfile,allowed} from './threads.mjs';
const fail=(status,message)=>Object.assign(new Error(message),{status});

export async function isBlocked(db,a,b){return !!(await db.prepare("SELECT 1 FROM blocked_members WHERE (owner=$1 AND target=$2) OR (owner=$3 AND target=$4)").get(a,b,b,a));}
export async function ownBlock(db,owner,target){return (await db.prepare("SELECT id FROM blocked_members WHERE owner=$1 AND target=$2").get(owner,target))?.id||null;}
export async function blocks(db,account,input){(await requireProfile(db,account));const owner=account.address.toLowerCase();
 if(input){if(input.action==='remove'){if(typeof input.id!=='string')throw fail(400,'Choose a blocked member.');(await db.prepare("DELETE FROM blocked_members WHERE owner=$1 AND id=$2").run(owner,input.id));}
 else if(input.action==='add'){const q=(await allowed(db,input.questionId,account)),r=input.replyId?(await db.prepare("SELECT author FROM replies WHERE id=$1 AND question_id=$2").get(input.replyId,q.id)):q;if(!r)throw fail(404,'Member not found.');if(r.author===owner)throw fail(400,'You cannot block yourself.');(await db.prepare("INSERT INTO blocked_members VALUES($1,$2,$3) ON CONFLICT DO NOTHING").run(randomUUID(),owner,r.author));}
 else throw fail(400,'Choose block or unblock.');}
 return {members:(await db.prepare("SELECT b.id,p.nickname FROM blocked_members b JOIN profiles p ON p.address=b.target WHERE b.owner=$1 ORDER BY p.nickname").all(owner))};
}
export async function remindDeadlines(db,now){(await db.prepare(`INSERT INTO deadline_reminders(address,question_id,created_at) SELECT author,id,$1 FROM questions WHERE closed_at IS NULL AND deleted_at IS NULL AND created_at<=$2 AND created_at>$3 ON CONFLICT DO NOTHING`).run(now,now-6*86400000,now-7*86400000));}
