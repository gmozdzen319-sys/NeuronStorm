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
// One scoring implementation, shared by the existing entry point.
export {reputationRanking as ranking} from './reputation.mjs';
