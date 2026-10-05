export function weekStart(now){const d=new Date(now);d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.getTime();}
export async function rewardGrowth(db,balance,now){
  const units=value=>{if(!/^\d+(\.\d{1,18})?$/.test(value))throw Error('Invalid reward balance');const [whole,fraction=""]=value.split('.');return BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'));};
  const current=units(balance),week=weekStart(now);
  (await db.prepare("INSERT INTO reward_baselines VALUES($1,$2,$3) ON CONFLICT DO NOTHING").run(week,balance,now));
  const baseline=(await db.prepare("SELECT balance,observed_at FROM reward_baselines WHERE week=$1").get(week)),start=units(baseline.balance);
  const change=start===0n?(current===0n?'0.00':null):(()=>{const delta=current-start,absolute=delta<0n?-delta:delta,hundredths=(absolute*10000n+start/2n)/start;return (delta<0n?'-':'')+(hundredths/100n)+'.'+String(hundredths%100n).padStart(2,'0');})();
  return {changePercent:change,baselineAt:baseline.observed_at,baselineBalance:baseline.balance};
}

export async function presence(db,visitor,account,active,now){
  const week=weekStart(now);(await db.prepare("INSERT INTO site_visitors VALUES($1,$2) ON CONFLICT DO NOTHING").run(week,visitor));
  (await db.prepare("DELETE FROM site_presence WHERE seen<$1").run(now-65000));
  (await db.prepare("DELETE FROM site_visitors WHERE week<$1").run(week-8*604800000));
  if(active)(await db.prepare("INSERT INTO site_presence VALUES($1,$2,$3) ON CONFLICT(visitor) DO UPDATE SET address=excluded.address,seen=excluded.seen").run(visitor,account?.address.toLowerCase()||null,now));
  else (await db.prepare("DELETE FROM site_presence WHERE visitor=$1").run(visitor));
  return {online:(await db.prepare("SELECT count(DISTINCT COALESCE(address,visitor)) AS n FROM site_presence WHERE seen>=$1").get(now-65000)).n,weeklyVisitors:(await db.prepare("SELECT count(*) AS n FROM site_visitors WHERE week=$1").get(week)).n,weekStart:week};
}
export async function ranking(db,params,now,includeAddresses=false){
  const start=weekStart(now),category=Number(params.get('category')||0);
  if(!Number.isSafeInteger(category)||category<0)throw Object.assign(Error('Choose a valid topic.'),{status:400});
  const match=category?'AND EXISTS(SELECT 1 FROM question_categories qc WHERE qc.question_id=q.id AND qc.category_id=$3)':'';
  const args=category?[start,start+604800000,category]:[start,start+604800000];
  const stars=(await db.prepare(`SELECT r.author AS address,count(*) AS n FROM reply_votes v JOIN replies r ON r.id=v.reply_id JOIN questions q ON q.id=r.question_id WHERE v.value=1 AND r.deleted_at IS NULL AND q.deleted_at IS NULL AND v.awarded_at>=$1 AND v.awarded_at<$2 ${match} GROUP BY r.author`).all(...args));
  const answers=(await db.prepare(`SELECT r.author AS address,count(*) AS n FROM replies r JOIN questions q ON q.id=r.question_id WHERE r.deleted_at IS NULL AND q.deleted_at IS NULL AND r.created_at>=$1 AND r.created_at<$2 ${match} GROUP BY r.author`).all(...args));
  const questions=(await db.prepare(`SELECT q.author AS address,count(*) AS n FROM questions q WHERE q.deleted_at IS NULL AND q.created_at>=$1 AND q.created_at<$2 ${match} GROUP BY q.author`).all(...args));
  const rows=new Map();for(const [items,key] of [[stars,'stars'],[answers,'answers'],[questions,'questions']])for(const item of items){if(!rows.has(item.address)){const profile=(await db.prepare("SELECT nickname FROM profiles WHERE address=$1").get(item.address));if(!profile)continue;rows.set(item.address,{...(includeAddresses?{address:item.address}:{}),nickname:profile.nickname,stars:0,answers:0,questions:0});}rows.get(item.address)[key]=item.n;}
  return {weekStart:start,weekEnd:start+604800000,rows:[...rows.values()].map(r=>({...r,activity:r.answers+r.questions})).sort((a,b)=>b.stars-a.stars||b.activity-a.activity||a.nickname.localeCompare(b.nickname)).slice(0,100),categories:(await db.prepare("SELECT id,name,kind FROM categories ORDER BY kind,name").all())};
}
