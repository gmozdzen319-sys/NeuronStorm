const fail=(status,message)=>Object.assign(Error(message),{status});
export async function desktopHeartbeat(db,account,req,input,now){
 if(req.headers['x-ns-desktop-presence']!=='1'||req.headers.origin||req.headers['sec-fetch-site'])throw fail(403,'Desktop only.');
 if(!/^[a-f0-9]{32}$/.test(input?.instance||'')||typeof input.mining!=='boolean')throw fail(400,'Invalid desktop heartbeat.');
 // Anonymous instances count as open apps; signed-in users are deduplicated across devices.
 await db.prepare('DELETE FROM desktop_app_presence WHERE seen_at<=$1').run(now-60000);
 await db.prepare(`INSERT INTO desktop_app_presence(instance,account_id,mining,seen_at) VALUES($1,$2,$3,$4)
 ON CONFLICT(instance) DO UPDATE SET account_id=EXCLUDED.account_id,mining=EXCLUDED.mining,seen_at=EXCLUDED.seen_at`).run(input.instance,account?.id||null,!!account&&input.mining,now);
 return desktopStatistics(db,now);
}
export async function desktopStatistics(db,now){
 const row=await db.prepare(`SELECT COUNT(*) AS online, COUNT(*) FILTER(WHERE mining) AS mining FROM
 (SELECT COALESCE(account_id,instance),BOOL_OR(mining) AS mining FROM desktop_app_presence WHERE seen_at>$1 GROUP BY COALESCE(account_id,instance)) p`).get(now-60000);
 const downloads=await db.prepare('SELECT total FROM desktop_download_count WHERE id=1').get();
 return {online:Number(row.online),mining:Number(row.mining),downloads:Number(downloads.total),asOf:now};
}
export async function recordDesktopDownload(db){await db.prepare('UPDATE desktop_download_count SET total=total+1 WHERE id=1').run();}
