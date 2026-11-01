import test from 'node:test';
import assert from 'node:assert/strict';
const {EmbedPlayer}=await import(process.env.FANTASY_AUDIT_EMBED||'../web/embed-player.js');
function harness(){
 let now=0;const attributes=new Map(),events=new Map(),navigations=[];
 const frame={setAttribute:(k,v)=>attributes.set(k,v),addEventListener:(k,v)=>events.set(k,v),remove(){this.removed=true;},get src(){return navigations.at(-1)?.url;},set src(url){navigations.push({url,sandbox:attributes.get('sandbox')});}};
 // The original adapter used the global document; keep the negative-control
 // harness compatible so failures exercise behavior, not injection support.
 const previous=globalThis.document;let p;
 globalThis.document={createElement:()=>frame};
 try{p=new EmbedPlayer('https://ntv.st/game/example',{now:()=>now,createFrame:()=>frame});}finally{globalThis.document=previous;}
 return {p,frame,navigations,attributes,load:()=>events.get('load')(),tick:value=>{now=value;}};
}
test('embed safety: every stream navigation is sandboxed before loading, including returns and reloads',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();
 assert.ok(h.navigations[0].sandbox,'the first document must already be sandboxed');
 p.reload();p.setVisible(false);p.setVisible(true);
 for(const navigation of h.navigations){
  const flags=new Set(navigation.sandbox.split(' '));
  for(const required of ['allow-scripts','allow-same-origin','allow-forms','allow-presentation'])assert.ok(flags.has(required));
  for(const unsafe of ['allow-popups','allow-popups-to-escape-sandbox','allow-top-navigation','allow-top-navigation-by-user-activation','allow-top-navigation-to-custom-protocols','allow-modals','allow-downloads'])assert.equal(flags.has(unsafe),false,unsafe);
 }
 assert.match(h.frame.allow,/autoplay/);assert.match(h.frame.allow,/fullscreen/);p.destroy();
});
test('embed safety: reload restores the original stream after internal navigation and waits for a fresh load',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();h.tick(2000);assert.equal(p.progressing,true);
 const before=h.navigations.length;assert.equal(p.reload(),true);assert.equal(h.navigations.length,before+1);assert.equal(h.navigations.at(-1).url,p.url);assert.equal(p.progressing,false);
 h.load();h.tick(4000);assert.equal(p.progressing,true);assert.equal(p.wantPlay,true);p.destroy();
});
test('embed safety: pause and hidden frames cannot be restarted by a reload',()=>{
 const h=harness(),{p}=h;assert.equal(p.reload(),false);assert.equal(h.navigations.length,0);
 p.setVisible(true);p.play();p.pause();const count=h.navigations.length;assert.equal(p.reload(),false);assert.equal(h.navigations.length,count);assert.equal(h.frame.src,'about:blank');
 p.play();assert.equal(h.frame.src,p.url);p.setVisible(false);assert.equal(p.reload(),false);assert.equal(h.frame.src,'about:blank');p.destroy();
});
test('embed safety: destroyed frames ignore late load, play, visibility and reload calls',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();p.destroy();const count=h.navigations.length;
 h.load();p.play();p.setVisible(true);assert.equal(p.reload(),false);assert.equal(h.navigations.length,count);assert.equal(p.loadedAt,null);assert.equal(p.progressing,false);assert.equal(p.wantPlay,false);assert.equal(h.frame.removed,true);
});
