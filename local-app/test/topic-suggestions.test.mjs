import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestionPlacement} from '../public/topic-suggestions.js';
test('registration suggestions stay above a mobile keyboard and account for panned viewport',()=>{
 const v={top:180,left:0,width:390,height:360};
 const p=suggestionPlacement({top:460,bottom:510,left:25,width:300},v);
 assert.equal(p.upward,true);assert.ok(p.top>=v.top+8);assert.ok(p.top+p.height<=460);assert.ok(p.left+p.width<=v.width-8);
 const below=suggestionPlacement({top:200,bottom:240,left:25,width:300},v);assert.equal(below.upward,false);assert.ok(below.top+below.height<=v.top+v.height-8);
});
test('very short visible space never creates a negative-height popup',()=>{
 const p=suggestionPlacement({top:10,bottom:40,left:5,width:350},{top:0,left:0,width:320,height:60});
 assert.ok(p.height>=0);assert.ok(p.width<=304);assert.ok(p.left>=8);
});

test('Topic tap remains inside onboarding profile and adds once; keyboard selection also works',async()=>{
 const {createTopicSuggestions}=await import('../public/topic-suggestions.js');
 const saved={document:globalThis.document,window:globalThis.window};
 function node(parent=null){return {parent,children:[],handlers:{},style:{},hidden:false,value:'',id:'topics',scrollHeight:120,append(child){child.parent=this;this.children.push(child);},replaceChildren(){this.children=[];},closest(selector){return selector==='#profile-area'?(this.isProfile?this:this.parent?.closest(selector)):null;},setAttribute(){},removeAttribute(){},addEventListener(k,f){this.handlers[k]=f;},focus(){globalThis.document.activeElement=this;},getBoundingClientRect(){return {top:200,bottom:240,left:20,width:300};},scrollIntoView(){}};}
 const profile=node();profile.isProfile=true;const body=node(),input=node(profile),list=node();let added=[];
 globalThis.document={body,activeElement:input,createElement:()=>node()};globalThis.window={visualViewport:{offsetTop:0,offsetLeft:0,width:390,height:600,addEventListener(){}},addEventListener(){}};
 try{
  const control=createTopicSuggestions(input,list,()=>[{name:'Science',memberCount:2},{name:'Art',memberCount:1}],()=>added.push(input.value));control.refresh();
  const option=list.children[0];assert.equal(option.closest('#profile-area'),profile,'onboarding capture guard must allow this click');assert.equal(body.children.length,0);
  let prevented=false;option.handlers.pointerdown({pointerType:'touch',preventDefault(){prevented=true;}});assert(prevented);option.handlers.click();assert.deepEqual(added,['Science']);assert.equal(list.hidden,true);option.handlers.click();assert.equal(added.length,1);
  input.value='';control.refresh();input.handlers.keydown({key:'ArrowDown',preventDefault(){}});let stopped=false;input.handlers.keydown({key:'Enter',preventDefault(){},stopImmediatePropagation(){stopped=true;}});assert(stopped);assert.deepEqual(added,['Science','Science']);
  input.value='';control.refresh();input.handlers.blur();assert.equal(list.hidden,true);
 }finally{Object.assign(globalThis,saved);}
});
