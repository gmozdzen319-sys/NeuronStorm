import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceSequence,createNotificationSound} from '../public/notification-sound.js';
test('notification sound ignores history and stale responses, counts new events only',()=>{
  assert.deepEqual(advanceSequence(null,7),{sequence:7,count:0});
  assert.deepEqual(advanceSequence(7,7),{sequence:7,count:0});
  assert.deepEqual(advanceSequence(7,5),{sequence:7,count:0});
  assert.deepEqual(advanceSequence(7,9),{sequence:9,count:2});
  assert.deepEqual(advanceSequence(7,undefined),{sequence:7,count:0});
});
test('mute persists and suppresses new chimes without replaying them on unmute',async t=>{
  const originals=Object.fromEntries(['window','document','localStorage'].map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const events={},storage=new Map(),attributes={};let starts=0;
  const button={addEventListener:(name,fn)=>events['button:'+name]=fn,setAttribute:(k,v)=>attributes[k]=v};
  globalThis.document={addEventListener:(name,fn)=>events[name]=fn};
  globalThis.localStorage={getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)};
  globalThis.window={addEventListener:()=>{},AudioContext:class{
    state='running';currentTime=0;destination={};
    resume(){this.state='running';return Promise.resolve();}suspend(){this.state='suspended';return Promise.resolve();}
    createOscillator(){return {frequency:{},connect(){},disconnect(){},start(){starts++;},stop(){}};}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }};
  const sound=createNotificationSound(button);sound.setAccount({address:'0xabc'});sound.update(2);assert.equal(starts,0);
  events.pointerdown();sound.update(3);assert.equal(starts,2);sound.update(3);assert.equal(starts,2);
  events['button:click']();assert.equal(storage.get('ns-notification-muted'),'true');assert.equal(attributes['aria-pressed'],'true');
  sound.update(4);assert.equal(starts,2);events['button:click']();sound.update(4);assert.equal(starts,2);sound.update(5);assert.equal(starts,4);
  sound.setAccount({address:'0xdef'});sound.update(20);assert.equal(starts,4);sound.setAccount(null);sound.update(21);assert.equal(button.hidden,true);assert.equal(starts,4);
});
