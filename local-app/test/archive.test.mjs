import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApp,ADMIN} from '../server.mjs';
import {saveProfile} from '../profiles.mjs';
import {createQuestion,replyToThread} from '../threads.mjs';
import {archiveText,initArchive} from '../archive.mjs';
function seed(db){
 const now=Date.now(),accounts=[ADMIN,'0x'+'2'.repeat(40)].map(address=>({address,role:address===ADMIN?'admin':'member'}));
 for(const [i,a] of accounts.entries()){db.prepare('INSERT INTO accounts VALUES(?,?)').run(a.address,now);saveProfile(db,a.address,{nickname:'Member '+i,work:['Lighting'],hobbies:[]},now);}
 const categoryId=db.prepare('SELECT id FROM categories').get().id,id=createQuestion(db,accounts[0],{body:'Pytanie — żółć?',categoryId},now).id;
 replyToThread(db,accounts[1],id,{body:'Original answer'},now+1);return {id,accounts};
}
test('archive retains edits, deletions and closed questions; rollback and repeated setup do not duplicate events',t=>{
 const {db}=createApp({database:':memory:'});t.after(()=>db.close());const {id}=seed(db);
 db.exec("UPDATE replies SET body='Edited answer',version=version+1; UPDATE replies SET deleted_at=123;");
 db.prepare('UPDATE questions SET closed_at=? WHERE id=?').run(Date.now(),id);
 let output=[...archiveText(db)].join('');for(const text of ['Pytanie — żółć?','Original answer','Edited answer','ANSWER DELETED','QUESTION CLOSED'])assert.ok(output.includes(text));
 const count=db.prepare('SELECT count(*) AS n FROM conversation_archive').get().n;
 initArchive(db);assert.equal(db.prepare('SELECT count(*) AS n FROM conversation_archive').get().n,count);
 db.exec("SAVEPOINT test; UPDATE replies SET body='Rolled back'; ROLLBACK TO test; RELEASE test;");assert.ok(![...archiveText(db)].join('').includes('Rolled back'));
});
test('text download is private to the authenticated administrator with no cache and attachment headers',async t=>{
 const app=createApp({database:':memory:',origin:'http://127.0.0.1:43129'});const {accounts}=seed(app.db);
 await new Promise(resolve=>app.server.listen(43129,'127.0.0.1',resolve));t.after(async()=>{await new Promise(r=>app.server.close(r));app.db.close();});
 for(const [i,a] of accounts.entries())app.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(String(i).repeat(64)).digest('hex'),a.address,Date.now()+60000);
 const url='http://127.0.0.1:43129/api/admin/archive.txt';
 assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers:{Cookie:'ns_session='+'1'.repeat(64)}})).status,403);
 const response=await fetch(url,{headers:{Cookie:'ns_session='+'0'.repeat(64)}});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/plain/);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('content-disposition'),/attachment/);assert.match(await response.text(),/Original answer/);
});

test('initial import captures existing deleted answers and runs only once',t=>{
 const {db}=createApp({database:':memory:'});t.after(()=>db.close());seed(db);
 for(const table of ['questions','replies'])for(const action of ['insert','update','delete'])db.exec('DROP TRIGGER archive_'+table+'_'+action);
 db.exec("DROP TABLE conversation_archive; DROP TABLE archive_meta; UPDATE replies SET body='Previously edited',version=2,deleted_at=1;");
 initArchive(db);initArchive(db);const entries=db.prepare('SELECT * FROM conversation_archive').all();assert.equal(entries.length,2);assert.equal(entries[1].event,'ANSWER IMPORTED');assert.match([...archiveText(db)].join(''),/Previously edited/);
});
