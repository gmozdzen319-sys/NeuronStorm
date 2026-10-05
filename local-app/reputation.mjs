// Hosting-independent scoring API. PostgreSQL's append-only ledger is authoritative.
export const WEEK=604800000;
export function roundStart(now){return Math.floor((now-345600000)/WEEK)*WEEK+345600000;}
const fail=message=>Object.assign(Error(message),{status:400});
export async function rounds(db,now){
 const current=roundStart(now);
 await db.prepare(`INSERT INTO weekly_rounds(round_id,start_time,end_time,status)
 SELECT s,s,s+$2,CASE WHEN s<$1 THEN 'closed' ELSE 'open' END FROM generate_series(
 LEAST(COALESCE((SELECT min(round_id) FROM weekly_rounds),$1),$1),$1,$2) s ON CONFLICT DO NOTHING`).run(current,WEEK);
 await db.prepare("UPDATE weekly_rounds SET status='closed' WHERE end_time<=$1 AND status='open'").run(now);
 return db.prepare('SELECT * FROM weekly_rounds ORDER BY round_id DESC').all();
}
function selection(params,now){
 const round=Number(params.get('round')||roundStart(now)),category=Number(params.get('category')||0),limit=Number(params.get('limit')||20);
 if(!Number.isSafeInteger(round)||round<0||roundStart(round)!==round||!Number.isSafeInteger(category)||category<0||![20,50,100].includes(limit))throw fail('Choose a valid round, field and Top 20, 50 or 100.');
 return {round,category,limit};
}
const aggregates=`COALESCE(sum(e.units),0)::bigint AS units,
 COALESCE(sum(e.units) FILTER(WHERE e.source IN('qa','best')),0)::bigint AS "qaUnits",
 COALESCE(sum(e.units) FILTER(WHERE e.source='debate'),0)::bigint AS "debateUnits",
 count(*) FILTER(WHERE e.source='best') AS "bestAnswers"`;
export async function reputation(db,address,now=Date.now(),selectedRound=roundStart(now)){
 if(!Number.isSafeInteger(selectedRound)||selectedRound<0||roundStart(selectedRound)!==selectedRound)throw fail('Invalid weekly round.');
 const all=await db.prepare(`SELECT ${aggregates} FROM reputation_events e WHERE recipient=$1`).get(address);
 const weekly=await db.prepare(`SELECT ${aggregates} FROM reputation_events e WHERE recipient=$1 AND round_id=$2`).get(address,selectedRound);
 const votes=await db.prepare(`SELECT count(*) FILTER(WHERE value=1) AS helpful,count(*) FILTER(WHERE value=-1) AS "notHelpful" FROM
 (SELECT DISTINCT ON(source,target_id,voter) value FROM reputation_events WHERE recipient=$1 AND source<>'best' ORDER BY source,target_id,voter,id DESC) active`).get(address);
 const categories=await db.prepare(`SELECT c.id,c.name,c.kind,sum(ec.units)::bigint AS units,
 COALESCE(sum(ec.units) FILTER(WHERE e.round_id=$2),0)::bigint AS "weeklyUnits"
 FROM reputation_events e JOIN reputation_event_categories ec ON ec.event_id=e.id JOIN categories c ON c.id=ec.category_id
 WHERE e.recipient=$1 GROUP BY c.id ORDER BY units DESC,c.id`).all(address,selectedRound);
 const rank=await db.prepare(`WITH scores AS(SELECT recipient,sum(units) AS score FROM reputation_events WHERE round_id=$1 GROUP BY recipient),
 ranked AS(SELECT recipient,rank() OVER(ORDER BY score DESC) AS position FROM scores) SELECT position FROM ranked WHERE recipient=$2`).get(selectedRound,address);
 return {...all,...votes,weekly,weeklyRank:rank?.position??null,roundId:selectedRound,categories};
}
export async function reputationRanking(db,params,now,includeAddresses=false,address=null){
 const {round,category,limit}=selection(params,now),history=await rounds(db,now);
 if(!history.some(r=>r.round_id===round))throw fail('This round does not exist.');
 const rows=await db.prepare(`WITH scores AS (
 SELECT e.recipient,sum(CASE WHEN $2=0 THEN e.units ELSE ec.units END)::bigint AS "weeklyUnits"
 FROM reputation_events e LEFT JOIN reputation_event_categories ec ON ec.event_id=e.id AND ec.category_id=$2
 WHERE e.round_id=$1 AND ($2=0 OR ec.event_id IS NOT NULL) GROUP BY e.recipient),
 ranked AS(SELECT *,rank() OVER(ORDER BY "weeklyUnits" DESC) AS position FROM scores)
 SELECT s.*,p.nickname,COALESCE((SELECT sum(units)::bigint FROM reputation_events WHERE recipient=s.recipient),0) AS "totalUnits",
 (SELECT c.name FROM reputation_events e JOIN reputation_event_categories ec ON ec.event_id=e.id JOIN categories c ON c.id=ec.category_id WHERE e.recipient=s.recipient GROUP BY c.id ORDER BY sum(ec.units) DESC,c.id LIMIT 1) AS expertise
 FROM ranked s JOIN profiles p ON p.address=s.recipient ORDER BY s.position,p.nickname,s.recipient LIMIT $3`).all(round,category,limit);
 const result=rows.map(({recipient,...r})=>({...r,...(includeAddresses?{address:recipient}:{}),stars:r.weeklyUnits/100}));
 return {weekStart:round,weekEnd:round+WEEK,round:history.find(r=>r.round_id===round),rounds:history,rows:result,
 categories:await db.prepare('SELECT id,name,kind FROM categories ORDER BY kind,name').all(),
 me:address?await reputation(db,address,now,round):null};
}
export async function reputationAdmin(db,params,now){
 const ranking=await reputationRanking(db,params,now,true),round=ranking.weekStart;
 const totals=await db.prepare(`SELECT ${aggregates},count(*) AS events,count(*) FILTER(WHERE source<>'best') AS "voteEvents",
 count(*) FILTER(WHERE source<>'best' AND value=1) AS helpful,count(*) FILTER(WHERE source<>'best' AND value=-1) AS "notHelpful" FROM reputation_events e WHERE round_id=$1`).get(round);
 const page=Number(params.get('page')||1);if(!Number.isSafeInteger(page)||page<1||page>100000)throw fail('Invalid history page.');
 const events=await db.prepare(`SELECT e.*,p.nickname AS recipient_name,actor.nickname AS voter_name,
 (SELECT json_agg(json_build_object('name',c.name,'units',ec.units) ORDER BY c.id) FROM reputation_event_categories ec JOIN categories c ON c.id=ec.category_id WHERE ec.event_id=e.id) AS categories,
 rv.qualified_for_rewards,rv.trust_score,rv.fraud_reason,rv.review_status,rv.rule_version AS review_rule_version
 FROM reputation_events e LEFT JOIN reputation_reviews rv ON rv.event_id=e.id JOIN profiles p ON p.address=e.recipient JOIN profiles actor ON actor.address=e.voter
 WHERE e.round_id=$1 ORDER BY e.id DESC LIMIT 50 OFFSET $2`).all(round,(page-1)*50);
 const suspiciousVotes=await db.prepare(`SELECT e.*,rv.* FROM reputation_reviews rv JOIN reputation_events e ON e.id=rv.event_id WHERE e.round_id=$1 AND rv.review_status IN('Watch','Suspicious','Rejected') ORDER BY e.id DESC LIMIT 100`).all(round);
 const suspiciousAccounts=await db.prepare("SELECT * FROM reputation_account_reviews WHERE review_status IN('Watch','Suspicious','Rejected') ORDER BY address LIMIT 100").all();
 const review=await db.prepare(`SELECT count(*) FILTER(WHERE rv.qualified_for_rewards IS NOT NULL) AS assessed,
 count(*) FILTER(WHERE rv.qualified_for_rewards=false) AS rejected,
 COALESCE(sum(e.units) FILTER(WHERE rv.qualified_for_rewards=true),0)::bigint AS "qualifiedUnits"
 FROM reputation_events e LEFT JOIN reputation_reviews rv ON rv.event_id=e.id WHERE e.round_id=$1`).get(round);
 for(const row of ranking.rows)row.reputation=await reputation(db,row.address,now,round);
 return {...ranking,totals,events,page,pages:Math.max(1,Math.ceil(totals.events/50)),review,suspiciousVotes,suspiciousAccounts,engineEnabled:false,serverTime:now};
}
