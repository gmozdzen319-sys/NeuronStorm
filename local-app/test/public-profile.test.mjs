import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './database.mjs';
import {saveProfile} from '../profiles.mjs';
import {conversationProfile} from '../public-profile.mjs';
test('public profile exposes only approved fields; enforces conversation, session, target and block boundaries',async t=>{
 const app=await createApp();t.after(()=>app.close());const db=app.db,now=Date.now();
 const a='0x'+'1'.repeat(40),b='0x'+'2'.repeat(40),c='0x'+'3'.repeat(40),q='11111111-1111-4111-8111-111111111111';
 for(const address of [a,b,c]){await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(address,now);await saveProfile(db,address,{nickname:address===a?'Author':'Member',firstName:'Private',lastName:'Name',work:['Neuron Storm'],hobbies:[]},now);}
 const category=await db.prepare('SELECT id FROM categories LIMIT 1').get();
 await db.prepare('INSERT INTO questions(id,author,category_id,body,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$5)').run(q,a,category.id,'Question',now);
 for(const address of [a,b])await db.prepare('INSERT INTO question_participants VALUES($1,$2,0)').run(q,address);
 const account={address:b},params=new URLSearchParams();
 const p=await conversationProfile(db,account,q,params);
 assert.deepEqual(Object.keys(p).sort(),['nickname','avatar','work','hobbies','points','activityPoints','verification'].sort());assert.equal(p.nickname,'Author');assert.equal(p.work[0].name,'Neuron Storm');assert.ok(!JSON.stringify(p).includes(a));assert.ok(!JSON.stringify(p).includes('Private'));
 await assert.rejects(conversationProfile(db,null,q,params),{status:401});
 await assert.rejects(conversationProfile(db,{address:c},q,params),{status:404});
 for(const query of ['reply=999','message=999','reply=1&message=2','reply=0','message=bad'])await assert.rejects(conversationProfile(db,account,q,new URLSearchParams(query)),{status:404});
 const reply=await db.prepare('INSERT INTO replies(question_id,author,body,created_at) VALUES($1,$2,$3,$4) RETURNING id').get(q,b,'Answer',now);
 assert.equal((await conversationProfile(db,{address:a},q,new URLSearchParams('reply='+reply.id))).nickname,'Member');
 const message=await db.prepare('INSERT INTO debate_messages(question_id,author,body,client_id,created_at) VALUES($1,$2,$3,$4,$5) RETURNING id').get(q,b,'Message','22222222-2222-4222-8222-222222222222',now);
 assert.equal((await conversationProfile(db,{address:a},q,new URLSearchParams('message='+message.id))).nickname,'Member');
 await db.prepare('INSERT INTO blocked_members VALUES($1,$2,$3)').run('test-block',a,b);await assert.rejects(conversationProfile(db,account,q,params),{status:404});await db.prepare('DELETE FROM blocked_members WHERE id=$1').run('test-block');
 await db.prepare('UPDATE questions SET closed_at=$1 WHERE id=$2').run(now,q);await assert.rejects(conversationProfile(db,account,q,params),{status:404});
});
