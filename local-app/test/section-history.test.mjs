import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Exercise the pure history adapter without starting unrelated UI timers.
const source=await readFile(new URL('../public/conversations.js',import.meta.url),'utf8');
const {createSectionHistory}=await import('data:text/javascript,'+encodeURIComponent(source.slice(source.indexOf('export function createSectionHistory'))));
test('Section history restores Back/Forward without duplicate entries and isolates accounts',()=>{
 const entries=[null];let index=0,listener,controller;const restored=[];
 const browser={history:{get state(){return entries[index];},replaceState(s){entries[index]=s;},pushState(s){entries.splice(++index);entries.push(s);}},addEventListener(name,fn){assert.equal(name,'popstate');listener=fn;}};
 controller=createSectionHistory(browser,route=>{restored.push(route);controller.record(route);});controller.setOwner('a');
 controller.record({view:'ask'});controller.record({view:'wallet'});controller.record({view:'wallet'});controller.record({view:'thread',id:'question',fromAdmin:false});
 assert.equal(entries.length,3);assert.equal(index,2);
 listener({state:entries[--index]});assert.deepEqual(restored.at(-1),{view:'wallet'});assert.equal(entries.length,3);
 listener({state:entries[--index]});assert.deepEqual(restored.at(-1),{view:'ask'});
 listener({state:entries[++index]});assert.deepEqual(restored.at(-1),{view:'wallet'});
 controller.record({view:'profile'});assert.equal(entries.length,3);assert.equal(entries[2].neuronSection.route.view,'profile');
 controller.setOwner('b');const count=restored.length;listener({state:entries[0]});assert.equal(restored.length,count);
 controller.record({view:'ask'});assert.equal(entries.length,3);assert.equal(entries[index].neuronSection.owner,'b');
});
test('Refresh restores the same section or conversation without adding a history entry',()=>{
 for(const route of [{view:'wallet'},{view:'profile'},{view:'profile-edit'},{view:'inbox'},{view:'thread',id:'question',fromAdmin:false}]){
  let state={neuronSection:{owner:'same-user',route}},writes=0,restored;
  const browser={history:{get state(){return state;},replaceState(s){state=s;writes++;},pushState(s){state=s;writes++;}},addEventListener(){}};
  const controller=createSectionHistory(browser,value=>{restored=value;controller.record(value);return true;});
  assert.equal(controller.restoreCurrent(),false);controller.setOwner('same-user');
  assert.equal(controller.restoreCurrent(),true);assert.deepEqual(restored,route);assert.equal(writes,0);
  controller.setOwner('different-user');assert.equal(controller.restoreCurrent(),false);assert.equal(writes,0);
 }
});
test('Invalid or unavailable saved destination permits the normal landing fallback',()=>{
 let state={neuronSection:{owner:'user',route:{view:'unavailable'}}},writes=0;
 const browser={history:{get state(){return state;},replaceState(s){state=s;writes++;},pushState(s){state=s;writes++;}},addEventListener(){}};
 const controller=createSectionHistory(browser,()=>false);controller.setOwner('user');
 assert.equal(controller.restoreCurrent(),false);controller.record({view:'ask'});assert.equal(writes,1);
 assert.equal(state.neuronSection.route.view,'ask');
});
