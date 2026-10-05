import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp,ADMIN} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {createQuestion,replyToThread} from '../threads.mjs';
import {archiveText} from '../archive.mjs';
async function seed(db){
 const now=Date.now(),accounts=[ADMIN,'0x'+'2'.repeat(40)].map(address=>({address,role:address===ADMIN?'admin':'member'}));
 for(const [i,a] of accounts.entries()){(await db.prepare("INSERT INTO accounts VALUES($1,$2)").run(a.address,now));(await saveProfile(db,a.address,{nickname:'Member '+i,work:['Lighting'],hobbies:[]},now));}
 const categoryId=(await db.prepare("SELECT id FROM categories").get()).id,id=(await createQuestion(db,accounts[0],{body:'Pytanie — żółć?',categoryId},now)).id;
 (await replyToThread(db,accounts[1],id,{body:'Original answer'},now+1));return {id,accounts};
}
test('archive retains edits, deletions and closed questions; rolled-back changes leave no archive entry',async t=>{
 const {db}=(await createApp({database:':memory:'}));t.after(async ()=>(await db.close()));const {id}=(await seed(db));
 (await db.exec("UPDATE replies SET body='Edited answer',version=version+1; UPDATE replies SET deleted_at=123;"));
 (await db.prepare("UPDATE questions SET closed_at=$1 WHERE id=$2").run(Date.now(),id));
 let output=(await Array.fromAsync(archiveText(db))).join('');for(const text of ['Pytanie — żółć?','Original answer','Edited answer','ANSWER DELETED','QUESTION CLOSED'])assert.ok(output.includes(text));
 await db.transaction(async()=>{await db.exec("SAVEPOINT test; UPDATE replies SET body='Rolled back'; ROLLBACK TO test; RELEASE test;");});assert.ok(!(await Array.fromAsync(archiveText(db))).join('').includes('Rolled back'));
});
test('text download is private to the authenticated administrator with no cache and attachment headers',async t=>{
 const app=(await createApp({database:':memory:',origin:'http://127.0.0.1:43129'}));const {accounts}=(await seed(app.db));
 await new Promise(resolve=>app.server.listen(43129,'127.0.0.1',resolve));t.after(async()=>{await new Promise(r=>app.server.close(r));(await app.db.close());});
 for(const [i,a] of accounts.entries())(await app.db.prepare("INSERT INTO sessions VALUES($1,$2,$3)").run(createHash('sha256').update(String(i).repeat(64)).digest('hex'),a.address,Date.now()+60000));
 const url='http://127.0.0.1:43129/api/admin/archive.txt';
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Cookie:'ns_session='+'1'.repeat(64)}})).status,403);
 const response=await fetch(url,{headers:{Cookie:'ns_session='+'0'.repeat(64)}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/plain/);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/attachment/);assert.match(await response.text(),/Original answer/);
});
