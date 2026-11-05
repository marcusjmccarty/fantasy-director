// The game strip's shared helpers, and what a shared link or an old phone meets before any script runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripEnds,stripTabStop,stripKeys} from '../web/strip.js';
const button=(tab,id)=>{const b={id,attrs:{tabindex:tab},getAttribute:k=>b.attrs[k]??null,setAttribute:(k,v)=>{b.attrs[k]=String(v);},focus(){b.focused=true;},closest:()=>b};return b;};
const list=all=>({querySelectorAll:()=>all});
const press=(key,target,extra={})=>({key,target,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
test('an arrow with nowhere to go steps aside, at both ends and neither in the middle',()=>{
 const prev={},next={};stripEnds({scrollLeft:0,clientWidth:100,scrollWidth:500},prev,next);assert.deepEqual([prev.hidden,next.hidden],[true,false]);
 stripEnds({scrollLeft:200,clientWidth:100,scrollWidth:500},prev,next);assert.deepEqual([prev.hidden,next.hidden],[false,false]);
 stripEnds({scrollLeft:400,clientWidth:100,scrollWidth:500},prev,next);assert.deepEqual([prev.hidden,next.hidden],[false,true]);
 stripEnds({scrollLeft:0,clientWidth:500,scrollWidth:500},prev,next);assert.deepEqual([prev.hidden,next.hidden],[true,true],'everything fits');
});
test('the strip always has one tab stop: today\'s tiles when there are any, else the newest past tile',()=>{
 const past=[button('-1','a'),button('-1','b')],today=button(null,'c');stripTabStop(list([...past,today]));assert.equal(past[1].attrs.tabindex,'-1','today has its own');
 stripTabStop(list(past));assert.equal(past[0].attrs.tabindex,'-1');assert.equal(past[1].attrs.tabindex,'0','no game today: the newest past tile');
 assert.doesNotThrow(()=>stripTabStop(list([])));
});
test('arrow keys walk the row, stay inside it, and do not reach the page\'s seek shortcuts',()=>{
 const all=[button(null,'a'),button(null,'b'),button(null,'c')];
 let e=press('ArrowRight',all[0]);stripKeys(e,list(all));assert.equal(all[1].focused,true);assert.equal(e.prevented,true);assert.equal(e.stopped,true,'a replay must not seek as the focus moves');
 all[0].focused=false;e=press('ArrowLeft',all[0]);stripKeys(e,list(all));assert.equal(all[0].focused,true,'stops at the end');
 e=press('End',all[0]);stripKeys(e,list(all));assert.equal(all[2].focused,true);
 for(const extra of [{metaKey:true},{ctrlKey:true},{altKey:true}]){e=press('ArrowRight',all[0],extra);stripKeys(e,list(all));assert.equal(e.prevented,undefined,'the browser keeps Cmd+Left');}
 e=press('Enter',all[0]);stripKeys(e,list(all));assert.equal(e.prevented,undefined);
});
for(const [page,path] of [['index.html','/'],['sports.html','/sports.html']])test(page+': a shared link has a picture and a title, and an old phone or a browser with no scripts gets a plain message',()=>{
 const html=readFileSync(new URL('../web/'+page,import.meta.url),'utf8');
 for(const tag of ['og:title','og:description','og:site_name','og:type','og:image:width','og:image:height'])assert.match(html,new RegExp(`property="${tag}" content="[^"]+"`),tag);
 assert.match(html,/property="og:image" content="https:\/\/[^"]+\/og-image\.png"/);assert.ok(html.includes(`property="og:url" content="https://fantasy-stream.fantasy-hub.workers.dev${path}"`));assert.match(html,/name="twitter:card" content="summary_large_image"/);assert.match(html,/rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
 assert.doesNotMatch(html.match(/property="og:title" content="([^"]+)"/)[1],/NBA|NHL|MLB/,'one page serves three leagues');
 assert.ok(html.indexOf('AbortSignal.timeout=')<html.indexOf('type="module"'),'the stand-in is in place before any module runs');assert.match(html,/<noscript><p class="notice old-browser">/);
 assert.match(html,/hasOwn/);
 assert.doesNotMatch(html,/stay in this browser and go only to ESPN/,'the old promise was not true');assert.match(html,/pass through Fantasy Stream’s server to reach ESPN/);assert.doesNotMatch(html,/inputmode="numeric"/);
});
