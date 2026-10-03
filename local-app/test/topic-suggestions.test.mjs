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
