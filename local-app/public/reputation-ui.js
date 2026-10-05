const el=(tag,text,cls='')=>{const n=document.createElement(tag);n.textContent=text;n.className=cls;return n;};
export const points=units=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(units/100);
const date=ms=>new Date(ms).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC';
export function scoreCard(score){
 const box=el('section','','reputation-card'),stats=el('dl','','dashboard-stats');
 for(const [label,value] of [['Total Reputation',points(score.units)],['Weekly Score',points(score.weekly.units)],['Weekly Rank',score.weeklyRank?'#'+score.weeklyRank:'—'],['Helpful',score.helpful],['Not Helpful',score.notHelpful],['Best Answers / Solved',score.bestAnswers],['Q&A Reputation',points(score.qaUnits)],['Debate Reputation',points(score.debateUnits)]]){
  const item=el('div','');item.append(el('dt',label),el('dd',value));stats.append(item);
 }
 box.append(stats,el('h3','Experience recognised by the community'));
 const cats=el('div','','reputation-categories');for(const c of score.categories)cats.append(el('span',c.name+' · '+points(c.units),'reputation-chip'));
 box.append(cats);if(!score.categories.length)box.append(el('p','Your evaluated contributions will appear here.','field-hint'));
 return box;
}
export function renderReputation(score){const host=document.querySelector('#profile-reputation');if(host&&score)host.replaceChildren(scoreCard(score));}
export function renderRanking(result,host){
 host.replaceChildren();for(const row of result.rows){const card=el('article','','ranking-row'+(row.position<=3?' reputation-top':''));
 card.append(el('strong',`#${row.position} ${row.nickname}`),el('span',row.expertise||'General','reputation-expertise'),el('span',points(row.weeklyUnits)+' Weekly Score'),el('span',points(row.totalUnits)+' Reputation'));
 if(row.address)card.append(el('code',row.address,'address'));host.append(card);
 }if(!result.rows.length)host.append(el('p','No scored contributions in this round yet.','empty-state'));
}
export function roundOptions(picker,rounds,selected){picker.replaceChildren();for(const r of rounds)picker.append(new Option(new Date(r.start_time).toISOString().slice(0,10)+' · '+r.status,r.round_id));picker.value=String(selected);}
let adminRequest=0,adminPage=1;
export function clearReputationAdmin(){adminRequest++;adminPage=1;document.querySelector('#admin-reputation-content')?.replaceChildren();document.querySelector('#admin-round')?.replaceChildren();}
export async function loadReputationAdmin(api){
 const host=document.querySelector('#admin-reputation-content'),picker=document.querySelector('#admin-round'),request=++adminRequest;
 try{
  const result=await api('/api/admin/reputation?limit=20&page='+adminPage+(picker.value?'&round='+picker.value:''));if(request!==adminRequest)return;
  roundOptions(picker,result.rounds,result.weekStart);host.replaceChildren();
  const period=el('p',date(result.weekStart)+' → '+date(result.weekEnd)+' · '+result.round.status,'field-hint'),clock=el('p','','round-clock');clock.dataset.end=result.weekEnd;
  host.append(period,clock);updateClocks();
  const totals=result.totals;host.append(el('p',`${totals.voteEvents} vote events · ${totals.helpful} Helpful events · ${totals.notHelpful} Not Helpful events · ${totals.bestAnswers} Best Answers`),el('p',`${points(totals.qaUnits)} Q&A score · ${points(totals.debateUnits)} Debate score`));
  const list=el('div','');renderRanking(result,list);host.append(list);
  for(const row of result.rows){const d=el('details','');d.append(el('summary',row.nickname+' · contribution details'),scoreCard(row.reputation));host.append(d);}
  const fraud=el('section','','reputation-card');fraud.append(el('h3','Anti-Fraud · preparation'),el('p','Engine not enabled. No votes have been automatically verified. Visible scores do not guarantee NS rewards.','field-hint'),el('p',`Weekly Score Before Review: ${points(totals.units)} · Weekly Score After Review: ${result.review.assessed===totals.events&&totals.events?points(result.review.qualifiedUnits):'Pending review'}`),el('p',`${result.review.assessed} assessed events · ${result.review.rejected} rejected events`));
  for(const [label,items] of [['Suspicious Accounts',result.suspiciousAccounts],['Suspicious Votes',result.suspiciousVotes]]){fraud.append(el('h4',label));if(!items.length)fraud.append(el('p','No flagged cases. Detection has not been enabled.','field-hint'));for(const item of items)fraud.append(el('p',`${item.address||item.voter} · Trust Score: ${item.trust_score??'Unassessed'} · ${item.review_status} · Fraud Reason: ${item.fraud_reason||'—'} · Rule Version: ${item.rule_version||'—'}`,'address'));}
  fraud.append(el('p','Review statuses: Clean · Watch · Suspicious · Rejected · Manually Approved','field-hint'));host.append(fraud);
  const history=el('details','');history.append(el('summary','Voting history · '+totals.events+' score events'));
  for(const e of result.events){const row=el('article','','reputation-event');row.append(el('strong',`${e.voter_name} → ${e.recipient_name} · ${e.source.toUpperCase()} · ${e.previous_value} → ${e.value} · ${points(e.units)}`),el('p',`${date(e.occurred_at)} · target ${e.target_id} · ${e.origin} · ${e.reason}`,'field-hint'),el('code',e.voter,'address'),el('p',(e.categories||[]).map(c=>c.name+' '+points(c.units)).join(' · '),'field-hint'));history.append(row);}
  const pagination=el('div','','pagination');for(const [label,delta] of [['Previous',-1],['Next',1]]){const b=el('button',label,'login');b.type='button';b.disabled=delta<0?adminPage<=1:adminPage>=result.pages;b.onclick=()=>{adminPage+=delta;loadReputationAdmin(api);};pagination.append(b);}history.append(el('p',`Page ${adminPage} of ${result.pages}`),pagination);host.append(history);
  picker.onchange=()=>{adminPage=1;loadReputationAdmin(api);};
 }catch(error){if(request===adminRequest)host.replaceChildren(el('p',error.message,'error'));}
}
function updateClocks(){for(const n of document.querySelectorAll('.round-clock')){const remaining=Math.max(0,Number(n.dataset.end)-Date.now());n.textContent=remaining?`${Math.floor(remaining/86400000)}d ${Math.floor(remaining/3600000)%24}h ${Math.floor(remaining/60000)%60}m ${Math.floor(remaining/1000)%60}s remaining`:'Round ended · history preserved';}}
setInterval(updateClocks,1000);
