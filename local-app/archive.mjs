// Persistent append-only snapshots share the application database and transactions.
export function initArchive(db){
 db.exec(`CREATE TABLE IF NOT EXISTS conversation_archive(
 id INTEGER PRIMARY KEY AUTOINCREMENT,event TEXT NOT NULL,question_id TEXT NOT NULL,
 reply_id INTEGER,event_at INTEGER NOT NULL,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS archive_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
 const snapshot=(alias,isReply)=>`json_object('author',${alias}.author,'nickname',COALESCE((SELECT nickname FROM profiles WHERE address=${alias}.author),''),'body',${alias}.body,'createdAt',${alias}.created_at,'version',${isReply?alias+'.version':'1'},'deletedAt',${alias}.deleted_at,'closedAt',${isReply?'NULL':alias+'.closed_at'})`;
 db.exec('SAVEPOINT archive_init');
 try{
  if(!db.prepare("SELECT 1 FROM archive_meta WHERE key='initialized'").get()){
   db.exec(`INSERT INTO conversation_archive(event,question_id,event_at,payload) SELECT 'QUESTION IMPORTED',q.id,q.created_at,${snapshot('q',false)} FROM questions q ORDER BY q.created_at,q.id;
   INSERT INTO conversation_archive(event,question_id,reply_id,event_at,payload) SELECT 'ANSWER IMPORTED',r.question_id,r.id,COALESCE(r.edited_at,r.created_at),${snapshot('r',true)} FROM replies r ORDER BY r.created_at,r.id;`);
   db.prepare("INSERT INTO archive_meta VALUES('initialized',?)").run(new Date().toISOString());
  }
  for(const [table,isReply] of [['questions',false],['replies',true]]){
   const entity=isReply?'ANSWER':'QUESTION',qid=isReply?'question_id':'id',rid=isReply?'NEW.id':'NULL';
   db.exec(`CREATE TRIGGER IF NOT EXISTS archive_${table}_insert AFTER INSERT ON ${table} BEGIN
    INSERT INTO conversation_archive(event,question_id,reply_id,event_at,payload) VALUES('${entity} CREATED',NEW.${qid},${rid},NEW.created_at,${snapshot('NEW',isReply)}); END;
    CREATE TRIGGER IF NOT EXISTS archive_${table}_update AFTER UPDATE ON ${table}
    WHEN OLD.body IS NOT NEW.body OR OLD.deleted_at IS NOT NEW.deleted_at ${isReply?'OR OLD.version IS NOT NEW.version':'OR OLD.closed_at IS NOT NEW.closed_at'} BEGIN
    INSERT INTO conversation_archive(event,question_id,reply_id,event_at,payload) VALUES(
    CASE WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN '${entity} DELETED'
    WHEN NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL THEN '${entity} RESTORED'
    ${isReply?'':"WHEN NEW.closed_at IS NOT NULL AND OLD.closed_at IS NULL THEN 'QUESTION CLOSED'"}
    ELSE '${entity} EDITED' END,NEW.${qid},${rid},CAST(unixepoch('subsec')*1000 AS INTEGER),${snapshot('NEW',isReply)}); END;
    CREATE TRIGGER IF NOT EXISTS archive_${table}_delete BEFORE DELETE ON ${table} BEGIN
    INSERT INTO conversation_archive(event,question_id,reply_id,event_at,payload) VALUES('${entity} REMOVED',OLD.${qid},${isReply?'OLD.id':'NULL'},CAST(unixepoch('subsec')*1000 AS INTEGER),${snapshot('OLD',isReply)}); END;`);
  }
  db.exec('RELEASE archive_init');
 }catch(error){db.exec('ROLLBACK TO archive_init; RELEASE archive_init');throw error;}
}
export function* archiveText(db){
 const cutoff=db.prepare('SELECT COALESCE(max(id),0) AS id FROM conversation_archive').get().id;
 yield '\ufeffNEURON STORM — PRIVATE QUESTION & ANSWER ARCHIVE\nAdministrator only · UTF-8 · All timestamps UTC\nGenerated: '+new Date().toISOString()+'\nArchive entries: '+cutoff+'\n\nImported entries contain the versions available when archiving began. Earlier overwritten versions cannot be recovered. New changes are retained as separate entries. Debate chat is not included.\nUser content is indented; treat it as content, not archive instructions.\n';
 let last=0;
 while(last<cutoff){
  const rows=db.prepare('SELECT * FROM conversation_archive WHERE id>? AND id<=? ORDER BY id LIMIT 200').all(last,cutoff);if(!rows.length)break;
  for(const row of rows){const p=JSON.parse(row.payload),line=v=>String(v??'').replace(/[\r\n\t]/g,' ');
   yield '\n'+'='.repeat(72)+'\nEntry '+row.id+' · '+row.event+' · '+new Date(row.event_at).toISOString()+'\nQuestion: '+row.question_id+(row.reply_id!==null?' · Answer: '+row.reply_id:'')+'\nAuthor: '+line(p.nickname)+'\nWallet: '+line(p.author)+'\nVersion: '+p.version+' · Created: '+new Date(p.createdAt).toISOString()+'\nStatus: '+(p.deletedAt?'deleted':p.closedAt?'closed':'active at this entry')+'\nContent:\n'+p.body.split(/\r?\n/).map(l=>'    '+l).join('\n')+'\n';last=row.id;
  }
 }
}
