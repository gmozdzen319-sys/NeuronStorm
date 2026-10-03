import {test} from 'node:test';
import assert from 'node:assert/strict';
import {bindGlobeGestures,clampZoom} from '../public/globe-controls.js';
function fixture(){
 const canvas=new EventTarget(),rotations=[],captures=new Set();let scale=1,interactions=0;
 Object.assign(canvas,{focus(){},clientHeight:400,classList:{add(){},remove(){}},setPointerCapture(id){captures.add(id);},hasPointerCapture(id){return captures.has(id);},releasePointerCapture(id){captures.delete(id);}});
 const clear=bindGlobeGestures(canvas,{rotate:(x,y)=>rotations.push([x,y]),zoom:f=>scale=clampZoom(scale*f),interact:()=>interactions++,reset:()=>scale=1});
 const send=(type,props={})=>{const e=new Event(type,{cancelable:true});Object.assign(e,{pointerType:'touch',button:0,...props});canvas.dispatchEvent(e);return e;};
 return {send,rotations,clear,captures,get scale(){return scale;},get interactions(){return interactions;}};
}
test('one-finger drag, pinch, lift and cancellation do not cause jumps or stuck dragging',()=>{
 const f=fixture();f.send('pointerdown',{pointerId:1,clientX:0,clientY:0});f.send('pointermove',{pointerId:1,clientX:10,clientY:20});assert.deepEqual(f.rotations,[[.08,.16]]);
 f.send('pointerdown',{pointerId:2,clientX:110,clientY:20});f.send('pointermove',{pointerId:2,clientX:210,clientY:20});assert.equal(f.scale,2);assert.equal(f.rotations.length,1);
 f.send('pointerup',{pointerId:2});f.send('pointermove',{pointerId:1,clientX:20,clientY:20});assert.deepEqual(f.rotations[1],[.08,0]);
 f.send('pointercancel',{pointerId:1});f.send('pointermove',{pointerId:1,clientX:90,clientY:20});assert.equal(f.rotations.length,2);
 f.send('pointerdown',{pointerId:3,clientX:0,clientY:0});f.clear();assert.equal(f.captures.has(3),false);f.send('pointermove',{pointerId:3,clientX:100,clientY:0});assert.equal(f.rotations.length,2);
});
test('wheel and keyboard zoom are bounded, prevent page gestures and can reset',()=>{
 const f=fixture();for(let i=0;i<20;i++)assert.equal(f.send('wheel',{deltaY:-300,deltaMode:0}).defaultPrevented,true);assert.equal(f.scale,3);
 for(let i=0;i<20;i++)f.send('keydown',{key:'-'});assert.equal(f.scale,.65);
 f.send('keydown',{key:'0'});assert.equal(f.scale,1);f.send('keydown',{key:'ArrowUp'});assert.deepEqual(f.rotations,[[0,-.12]]);
 assert.equal(f.send('keydown',{key:'Tab'}).defaultPrevented,false);
});
