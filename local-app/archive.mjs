// Persistent append-only snapshots share the application database and transactions.

export async function* archiveText(db){
 const {id:cutoff,total}=await db.prepare("SELECT COALESCE(max(id),0) AS id,count(*) AS total FROM conversation_archive").get();
 yield '\ufeffNEURON STORM — PRIVATE QUESTION & ANSWER ARCHIVE\nAdministrator only · UTF-8 · All timestamps UTC\nGenerated: '+new Date().toISOString()+'\nArchive entries: '+total+'\n\nImported entries contain the versions available when archiving began. Earlier overwritten versions cannot be recovered. New changes are retained as separate entries. Debate chat is not included.\nUser content is indented; treat it as content, not archive instructions.\n';
 let last=0;
 while(last<cutoff){
  const rows=(await db.prepare("SELECT * FROM conversation_archive WHERE id>$1 AND id<=$2 ORDER BY id LIMIT 200").all(last,cutoff));if(!rows.length)break;
  for(const row of rows){const p=JSON.parse(row.payload),line=v=>String(v??'').replace(/[\r\n\t]/g,' ');
   yield '\n'+'='.repeat(72)+'\nEntry '+row.id+' · '+row.event+' · '+new Date(row.event_at).toISOString()+'\nQuestion: '+row.question_id+(row.reply_id!==null?' · Answer: '+row.reply_id:'')+'\nAuthor: '+line(p.nickname)+'\nWallet: '+line(p.author)+'\nVersion: '+p.version+' · Created: '+new Date(p.createdAt).toISOString()+'\nStatus: '+(p.deletedAt?"deleted":p.closedAt?'closed':'active at this entry')+'\nContent:\n'+p.body.split(/\r?\n/).map(l=>'    '+l).join('\n')+'\n';last=row.id;
  }
 }
}
