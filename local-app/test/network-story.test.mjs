import test from 'node:test';import assert from 'node:assert/strict';import {networkPath,storyState,debateMembers} from '../public/neuron-background.js';
test('story uses real edges for question and reversible answer routes on both original grid sizes',()=>{for(const cols of [10,19]){const edges=[];for(let r=0;r<8;r++)for(let c=0;c<cols;c++){const i=r*cols+c;if(c)edges.push([i-1,i]);if(r)edges.push([i-cols,i]);if(r&&c&&(r+c)%2===0)edges.push([i-cols-1,i]);}const route=networkPath(edges,5*cols+1,2*cols+cols-3);assert.ok(route.length>3);for(const path of [route,[...route].reverse()])for(let i=1;i<path.length;i++)assert.ok(edges.some(([a,b])=>a===path[i-1]&&b===path[i]||b===path[i-1]&&a===path[i]));}});
test('orphaned graph cannot invent a connection',()=>assert.deepEqual(networkPath([[1,2]],1,3),[]));
test('scroll maps to bounded states and final state restores the ambient grid exactly',()=>{for(let p=-.1;p<=1.1;p+=.001){const s=storyState(p);for(const key of ['progress','strength','wake','loss','question','answer'])assert.ok(s[key]>=0&&s[key]<=1);assert.ok(Number.isFinite(s.zoom));}const final=storyState(1);assert.equal(final.strength,0);assert.equal(final.zoom,1);assert.equal(final.loss,0);assert.equal(storyState(.31).question>0,true);assert.equal(storyState(.57).answer>0,true);assert.equal(storyState(.625).loss,0);assert.equal(storyState(.82).loss,0);});

test("debate participants are distinct existing nodes with stable varied experience",()=>{for(const cols of [10,19]){const points=Array.from({length:cols*8},(_,i)=>({u:(i%cols)/(cols-1),v:Math.floor(i/cols)/7}));const members=debateMembers(points,cols===10);assert.ok(members.length>=8);assert.equal(new Set(members.map(m=>m.index)).size,members.length);assert.ok(new Set(members.map(m=>m.years)).size>5);assert.ok(members.every(m=>m.years>=3&&m.years<=48&&points[m.index]&&typeof m.specialty==="string"&&m.specialty.length>0));assert.deepEqual(members,debateMembers(points,cols===10));}});

import {storyData,storyScenes,storyPhase,topAnswerMember} from '../public/network-story-data.js';
import {readFileSync} from 'node:fs';
test('fictional source uses real reputation units and no runners or backend imports',()=>{
 assert.equal(storyData.fictional,true);assert.deepEqual(storyData.rules,{helpful:1,notHelpful:-1,bestAnswer:5,debatePositive:.25,debateNegative:-.25});
 const sql=readFileSync(new URL('../db/migrations/002_reputation.sql',import.meta.url),'utf8');assert.match(sql,/weight:=25/);assert.match(sql,/0,1,500/);
 const source=readFileSync(new URL('../public/network-story-data.js',import.meta.url),'utf8');assert.doesNotMatch(source,/fetch\(|openDatabase|localStorage|sessionStorage/);
 assert.equal(storyData.builderReputationBeforeChoice+storyData.rules.bestAnswer,89);
});
test('community surfaces three answers before Daniel selects the same participating builder',()=>{
 assert.equal(storyData.responses.length,3);assert.equal(new Set(storyData.responses.map(r=>r.member)).size,3);
 assert.equal(storyData.responders[storyData.responses[0].member][0],'Builder');assert.equal(storyData.responders[0][1],41);
 assert.ok(storyScenes.find(s=>s.at===.59).at>storyScenes.find(s=>s.at===.50).at);
 assert.equal(storyPhase(.49).returning,0);assert.equal(storyPhase(.59).returning,1);assert.equal(storyPhase(.59).chosen,false);assert.equal(storyPhase(.64).chosen,false);assert.equal(storyPhase(.67).chosen,true);
 assert.equal(storyPhase(.70).bonus,0);assert.equal(storyPhase(.75).bonus,1);
 assert.ok(storyData.responders.some(p=>p[0]==='DIY Renovator'));assert.ok(!storyData.responders.some(p=>p[0]==='Carpenter'));
 assert.ok(storyData.people.some(p=>p[0]==='Angler'));assert.ok(storyData.people.some(p=>p[0]==='Home Cook'));
});
test('all returning community routes end at Daniel using the existing grid',()=>{
 for(const cols of [10,19]){const points=Array.from({length:cols*8},(_,i)=>({u:i%cols/(cols-1),v:Math.floor(i/cols)/7})),edges=[];for(let i=0;i<points.length;i++){if(i%cols)edges.push([i-1,i]);if(i>=cols)edges.push([i-cols,i]);}
 const members=debateMembers(points,cols===10),daniel=6*cols+1;
 for(const response of storyData.responses){const path=networkPath(edges,members[topAnswerMember(response,cols===10)].index,daniel);assert.equal(path.at(-1),daniel);assert.equal(path[0],members[topAnswerMember(response,cols===10)].index);assert.ok(path.length>1);}
 }
});

test('approved scene 05 retains its copy and return progression',()=>{
 const scene=storyScenes.find(s=>s.at===.50);
 assert.deepEqual(scene,{at:.50,label:"05 / THE COMMUNITY'S MOST LIKED ANSWERS",title:'Three answers stood out.',body:'Human experience finds its way back to Daniel.'});
 assert.equal(storyPhase(.515).returning,0);assert.equal(storyPhase(.58).returning>0.99,true);
});
test('final correction removes retired copy, cards, second story and visible hashtags',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').split('<section id="network-story"')[1].split('</section>')[0];
 const copy=JSON.stringify(storyScenes)+html;
 for(const text of ['Maya Reed','tomato','Home gardener','NEURON STORM / HUMAN KNOWLEDGE','Ask what you don\'t know.','Share what you do.','Scroll to follow','Fictional people','story-annotation'])assert.ok(!copy.includes(text),text);
 assert.doesNotMatch(JSON.stringify(storyScenes),/#\w/);
 assert.equal(storyScenes.at(-2).title,'One question can unlock decades of experience.');
 assert.equal(storyScenes.at(-2).body,"Someone already knows what you don't.");
 assert.equal(storyScenes.some(s=>s.quote),false);
 assert.equal(storyScenes.at(-1).title,'Turn your experience into value.');
 assert.equal(storyScenes.at(-1).at,.92);
});

test('top answers occupy separated existing responder nodes while Builder stays first',()=>{
 for(const cols of [10,19]){
  const points=Array.from({length:cols*8},(_,i)=>({u:i%cols/(cols-1),v:Math.floor(i/cols)/7}));
  const members=debateMembers(points,cols===10), selected=storyData.responses.map(r=>members[topAnswerMember(r,cols===10)]);
  assert.equal(selected[0],members[0]);assert.equal(selected[0].specialty,'Builder');assert.equal(selected[0].years,41);
  const nodes=selected.map(m=>({x:m.index%cols,y:Math.floor(m.index/cols)}));
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)assert.ok(Math.max(Math.abs(nodes[i].x-nodes[j].x),Math.abs(nodes[i].y-nodes[j].y))>1);
  const [a,b,c]=nodes;assert.notEqual((b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),0);
 }
});
