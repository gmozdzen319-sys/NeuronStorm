import test from 'node:test';
import assert from 'node:assert/strict';
import {requestLiveMicrophone} from '../public/live-talk.js';

test('Join asks for audio permission immediately and closes every capture track without publishing',async()=>{
 let asked=false,stopped=0;
 const ready=requestLiveMicrophone({getUserMedia(options){asked=true;assert.equal(options.video,false);assert.equal(options.audio.echoCancellation,true);return Promise.resolve({getTracks:()=>[{stop(){stopped++;}},{stop(){stopped++;}}]});}});
 assert.equal(asked,true);await ready;assert.equal(stopped,2);
});
test('denied permission and missing microphone produce actionable messages',async()=>{
 for(const [name,message] of [['NotAllowedError',/Allow microphone access/],['NotFoundError',/No microphone/],['NotReadableError',/Close other apps/]])await assert.rejects(requestLiveMicrophone({getUserMedia:async()=>{throw {name};}}),message);
 await assert.rejects(requestLiveMicrophone({}),/supported browser over HTTPS/);
});
