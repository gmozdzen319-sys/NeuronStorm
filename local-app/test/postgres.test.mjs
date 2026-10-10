import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {Wallet} from 'quais';
import {createApp} from './database.mjs';
import {openDatabase} from '../db/database.mjs';
import {saveProfile,readProfile} from '../profiles.mjs';
import {createQuestion,replyToThread} from '../threads.mjs';
import {prepareAction,submitAction} from '../actions.mjs';
import {acceptAnswer,expireQuestions,QUESTION_LIFETIME} from '../lifecycle.mjs';

async function fixture(t,options={}){
 const app=await createApp(options);t.after(()=>app.close());
 const {db}=app,now=Date.now(),wallets=[new Wallet(randomBytes(32).toString('hex')),new Wallet(randomBytes(32).toString('hex'))];
 const accounts=wallets.map(w=>({address:w.address.toLowerCase(),role:'member'}));
 for(const [i,a] of accounts.entries()){
  await db.prepare('INSERT INTO accounts VALUES($1,$2)').run(a.address,now);
  await saveProfile(db,a.address,{nickname:'Member '+i,work:['Driving'],hobbies:['Travel']},now);
 }
 const categoryIds=(await db.prepare('SELECT id FROM categories ORDER BY id').all()).map(c=>c.id);
 return {...app,now,wallets,accounts,categoryIds};
}

test('missing PostgreSQL configuration refuses startup instead of falling back to SQLite',async()=>{
 for(const value of [undefined,'',':memory:','data/auth.sqlite'])await assert.rejects(openDatabase(value),/DATABASE_URL/);
});

test('fresh schema includes every legacy data table and a shared transaction registry',async t=>{
 const {db}=await fixture(t);
 const names=(await db.prepare("SELECT tablename FROM pg_tables WHERE schemaname='public'").all()).map(r=>r.tablename);
 const expected='accounts challenges sessions token_confirmations profiles categories profile_categories questions question_participants question_reads question_categories replies answer_slots reply_votes admin_audit notifications accepted_answers conversation_archive archive_meta saved_answers content_reports reward_receipts signed_actions debate_messages debate_presence payment_intents reward_baselines site_visitors site_presence globe_preferences globe_presence blocked_members deadline_reminders legal_documents legal_acceptances used_transactions schema_migrations weekly_rounds debate_votes reputation_events reputation_event_categories reputation_reviews reputation_account_reviews passkey_accounts passkey_credentials passkey_sessions passkey_challenges passkey_wallets passkey_tokens passkey_clone_wallets passkey_native_operations passkey_relayer_grants passkey_relayer_intents passkey_clone_approvals passkey_relayer_lanes passkey_clone_approval_history passkey_auto_activations'.split(' ');
 assert.deepEqual(names.sort(),expected.sort());
 assert.equal(typeof (await db.prepare('SELECT count(*) AS n FROM accounts').get()).n,'number');
 assert.deepEqual((await db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).map(r=>r.version),['001_initial.sql','002_reputation.sql','003_passkey_accounts.sql','004_clone_wallets.sql','005_auto_activation.sql']);
});

test('a failed profile transaction restores nickname and all previous categories',async t=>{
 const {db,accounts,now}=await fixture(t),address=accounts[0].address,before=await readProfile(db,address);
 await db.exec("CREATE FUNCTION reject_test_category() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Reject' THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_test_category BEFORE INSERT ON categories FOR EACH ROW EXECUTE FUNCTION reject_test_category();");
 await assert.rejects(saveProfile(db,address,{nickname:'Not saved',work:['Reject'],hobbies:[]},now),/test rollback/);
 assert.deepEqual(await readProfile(db,address),before);
});

test('simultaneous signed submissions create one question and one notification per recipient',async t=>{
 const {db,accounts,wallets,categoryIds,now}=await fixture(t),a=accounts[0];
 const c=await prepareAction(db,a,'session','/api/questions',{body:'One question',categoryIds},'http://localhost',now);
 const signed={actionId:c.id,signature:await wallets[0].signMessage(c.message)};
 const results=await Promise.all(Array.from({length:6},()=>submitAction(db,a,'session','/api/questions',signed,now+1)));
 assert.ok(results.every(r=>r.id===results[0].id));
 assert.equal((await db.prepare('SELECT count(*) AS n FROM questions').get()).n,1);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM notifications').get()).n,1);
});

test('simultaneous answers preserve one answer slot and one revision increment',async t=>{
 const {db,accounts,categoryIds,now}=await fixture(t);
 const {id}=await createQuestion(db,accounts[0],{body:'Concurrent replies',categoryIds},now);
 const results=await Promise.allSettled(Array.from({length:5},()=>replyToThread(db,accounts[1],id,{body:'Answer'},now+1)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(results.filter(r=>r.status==='rejected').every(r=>r.reason.status===409));
 assert.equal((await db.prepare('SELECT revision FROM questions WHERE id=$1').get(id)).revision,2);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM conversation_archive').get()).n,2);
});

test('shared transaction registry prevents a transfer being both a payment and a reward',async t=>{
 const {db}=await fixture(t),hash='0x'+'a'.repeat(64);
 await db.prepare("INSERT INTO used_transactions VALUES(9,$1,'payment','intent')").run(hash);
 await assert.rejects(db.prepare("INSERT INTO used_transactions VALUES(9,$1,'reward','question')").run(hash),e=>e.code==='23505');
});

test('reopening PostgreSQL preserves archive entries without re-importing or repeating migrations',async t=>{
 const key='archive-reopen-'+randomUUID(),first=await fixture(t,{database:key});
 await createQuestion(first.db,first.accounts[0],{body:'Keep this archive',categoryIds:first.categoryIds},first.now);
 await first.close();
 const second=await createApp({database:key});t.after(()=>second.close());
 assert.equal((await second.db.prepare('SELECT count(*) AS n FROM conversation_archive').get()).n,1);
 assert.deepEqual((await second.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()).map(r=>r.version),['001_initial.sql','002_reputation.sql','003_passkey_accounts.sql','004_clone_wallets.sql','005_auto_activation.sql']);
});

test('two application pools cannot select two winners during acceptance and expiry',{
 skip:process.env.NEURON_TEST_PGLITE==='1'?'Requires independent native PostgreSQL sessions; PGlite multiplexes one backend.':false
},async t=>{
 const key='parallel-'+randomUUID(),first=await fixture(t,{database:key}),second=await createApp({database:key});t.after(()=>second.close());
 const {accounts,categoryIds,now,db}=first,{id}=await createQuestion(db,accounts[0],{body:'One winner',categoryIds},now);
 await replyToThread(db,accounts[1],id,{body:'Selected answer'},now+1);
 const reply=await db.prepare('SELECT id FROM replies WHERE question_id=$1').get(id);
 await Promise.allSettled([acceptAnswer(db,accounts[0],id,{replyId:reply.id,version:1},now+QUESTION_LIFETIME-1),expireQuestions(second.db,now+QUESTION_LIFETIME)]);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM accepted_answers WHERE question_id=$1').get(id)).n,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM conversation_archive WHERE question_id=$1 AND event='QUESTION CLOSED'").get(id)).n,1);
});
