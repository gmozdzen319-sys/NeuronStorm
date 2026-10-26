// Called only with the server-authenticated identity; no client day/points input.
export async function recordDailyLogin(db,account,now=Date.now()){
 if(!account?.address)return;
 const day=new Date(now).toISOString().slice(0,10);
 await db.prepare('INSERT INTO daily_login_activity(address,day_utc,awarded_at) VALUES($1,$2,$3) ON CONFLICT(address,day_utc) DO NOTHING').run(account.address.toLowerCase(),day,now);
}
export async function activityPoints(db,address){
 return (await db.prepare('SELECT count(*) AS points FROM daily_login_activity WHERE address=$1').get(address.toLowerCase())).points;
}
