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
