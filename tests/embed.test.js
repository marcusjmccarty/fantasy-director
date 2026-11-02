import test from 'node:test';
import assert from 'node:assert/strict';
const {EmbedPlayer}=await import(process.env.FANTASY_AUDIT_EMBED||'../web/embed-player.js');
function harness(){
 let now=0;const navigations=[],frames=[];
 const createFrame=()=>{const attributes=new Map(),events=new Map();let src;const frame={attributes,events,setAttribute:(k,v)=>attributes.set(k,v),addEventListener:(k,v)=>events.set(k,v),replaceWith(){this.removed=true;},remove(){this.removed=true;},get src(){return src;},set src(url){src=url;navigations.push({url,sandbox:attributes.get('sandbox')});}};frames.push(frame);return frame;};
 // The original adapter used the global document; keep the negative-control
 // harness compatible so failures exercise behavior, not injection support.
 const previous=globalThis.document;let p;
 globalThis.document={createElement:createFrame};
 try{p=new EmbedPlayer('https://ntv.st/game/example',{now:()=>now,createFrame});}finally{globalThis.document=previous;}
 return {p,get frame(){return p.element;},frames,navigations,load:(frame=p.element)=>frame.events.get('load')(),tick:value=>{now=value;}};
}
test('embed safety: every stream navigation is sandboxed before loading, including returns and reloads',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();
 assert.ok(h.navigations[0].sandbox,'the first document must already be sandboxed');
 p.reload();p.setVisible(false);p.setVisible(true);
 for(const navigation of h.navigations){
  const flags=new Set(navigation.sandbox.split(' '));
  for(const required of ['allow-scripts','allow-same-origin','allow-forms','allow-presentation','allow-storage-access-by-user-activation'])assert.ok(flags.has(required));
  for(const unsafe of ['allow-popups','allow-popups-to-escape-sandbox','allow-top-navigation','allow-top-navigation-by-user-activation','allow-top-navigation-to-custom-protocols','allow-modals','allow-downloads'])assert.equal(flags.has(unsafe),false,unsafe);
 }
 assert.match(h.frame.allow,/autoplay/);assert.match(h.frame.allow,/fullscreen \*/);p.destroy();
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
test('embed recovery: a loaded page is periodically reconnected even without a reported media error',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();
 h.tick(119999);p.checkHealth();assert.equal(h.navigations.length,1);
 h.tick(120000);p.checkHealth();assert.equal(h.navigations.length,2);assert.equal(p.loadedAt,null);assert.equal(p.reconnecting,true);
 for(let i=0;i<20;i++)p.checkHealth();assert.equal(h.navigations.length,2,'one navigation per recovery, not per application tick');
 h.load();h.tick(122000);assert.equal(p.progressing,true);assert.equal(p.reconnecting,false);p.destroy();
});
test('embed recovery: a page that never loads keeps retrying with backoff until Pause',()=>{
 const h=harness(),{p}=h,errors=[];p.on('error',e=>errors.push(e));p.setVisible(true);p.play();
 for(const [at,count] of [[14999,1],[15000,2],[34999,2],[35000,3],[64999,3]]){h.tick(at);p.checkHealth();assert.equal(h.navigations.length,count);assert.equal(errors.length,0);}
 h.tick(65000);p.checkHealth();assert.equal(h.navigations.length,4);assert.equal(p.progressing,false);
 for(let i=1;i<=180;i++){
  h.tick(65000+i*60000-1);p.checkHealth();assert.equal(h.navigations.length,3+i);
  h.tick(65000+i*60000);p.checkHealth();assert.equal(h.navigations.length,4+i);assert.equal(errors.length,0);assert.equal(p.error,null);
 }
 p.pause();const paused=h.navigations.length;h.tick(15000000);p.checkHealth();assert.equal(h.navigations.length,paused);assert.equal(h.frame.src,'about:blank');p.destroy();
});
test('embed recovery: a successful loading retry resets backoff and repeated reloads remain spaced',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.tick(15000);p.checkHealth();h.tick(16000);h.load();
 h.tick(65000);p.checkHealth();assert.equal(p.error,null);assert.equal(h.navigations.length,2);
 h.tick(135000);p.checkHealth();assert.equal(h.navigations.length,3);assert.equal(p.loadRetries,0);
 h.tick(150000);p.checkHealth();assert.equal(h.navigations.length,4);h.load();p.destroy();
});
test('embed recovery: user reload resets the periodic deadline instead of immediately reloading twice',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();h.tick(119000);p.reload();h.load();
 h.tick(120000);p.checkHealth();assert.equal(h.navigations.length,2);h.tick(239000);p.checkHealth();assert.equal(h.navigations.length,3);p.destroy();
});
test('embed recovery: a flapping network cannot cause rapid reloads or consume the load retry budget',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();
 for(let at=1000;at<=30000;at+=1000){h.tick(at);p.checkHealth({online:false});p.checkHealth({online:true});if(p.loadedAt===null)h.load();}
 assert.equal(h.navigations.length,4,'initial load plus at most one reconnect per ten seconds');assert.equal(p.error,null);assert.equal(p.loadRetries,0);p.destroy();
});
test('embed recovery: hidden, paused and destroyed frames cannot reconnect from late health checks',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();p.setVisible(false);const hidden=h.navigations.length;
 h.tick(300000);p.checkHealth();assert.equal(h.navigations.length,hidden);p.setVisible(true);h.load();p.pause();const paused=h.navigations.length;
 h.tick(600000);p.checkHealth();assert.equal(h.navigations.length,paused);p.destroy();const destroyed=h.navigations.length;
 h.tick(900000);p.checkHealth();assert.equal(h.navigations.length,destroyed);
});
test('embed recovery: a background tab suspends a loading deadline without burst retries on return',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.tick(5000);p.checkHealth({foreground:false});
 h.tick(605000);p.checkHealth({foreground:false});assert.equal(h.navigations.length,1);p.checkHealth();assert.equal(h.navigations.length,1);
 h.tick(615000);p.checkHealth();assert.equal(h.navigations.length,2);p.destroy();
});
test('embed recovery: opting out stops periodic refresh but retains page-load recovery',()=>{
 const h=harness(),{p}=h;p.setAutoReconnect(false);p.setVisible(true);p.play();h.load();h.tick(500000);p.checkHealth();assert.equal(h.navigations.length,1);
 p.setAutoReconnect(true);p.checkHealth();assert.equal(h.navigations.length,1);h.tick(620000);p.checkHealth();assert.equal(h.navigations.length,2);
 p.setAutoReconnect(false);h.tick(635000);p.checkHealth();assert.equal(h.navigations.length,3,'load retries do not depend on the optional periodic refresh');p.destroy();
});
test('embed recovery: reconnect announces navigation first and respects synchronous Pause or destruction',()=>{
 for(const stop of ['pause','destroy']){
  const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();const before=h.navigations.length;
  p.on('reconnect',()=>{assert.equal(h.navigations.length,before,'prepare the parent before unloading the frame');p[stop]();});
  h.tick(120000);p.checkHealth();assert.equal(h.frame.src,'about:blank');assert.equal(h.navigations.length,before+1);assert.equal(p.wantPlay,false);p.destroy();
 }
});
test('embed switching: a paused visible page cannot restart through a repeated show',()=>{
 const h=harness(),{p}=h;p.setVisible(true);assert.equal(h.navigations.length,0);p.play();h.load();p.pause();const count=h.navigations.length;
 p.setVisible(true);p.setVisible(true);assert.equal(h.navigations.length,count);assert.equal(p.wantPlay,false);assert.equal(p.loadedAt,null);p.destroy();
});
test('embed switching: late load events from a retired page or blank document cannot ready the returning stream',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();const first=p.element;h.load();p.setVisible(false);const blank=p.element;p.setVisible(true);const current=p.element;
 h.tick(1000);h.load(first);h.load(blank);assert.equal(p.loadedAt,null,'old document events cannot acknowledge the current request');assert.equal(p.progressing,false);
 assert.notEqual(current,first);assert.notEqual(current,blank);assert.equal(first.removed,true);assert.equal(blank.removed,true);
 h.load(current);h.tick(3000);assert.equal(p.progressing,true);p.destroy();
});
test('embed switching: reloading the same URL creates a new attempt and rejects the previous load event',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();const old=p.element;p.reload();h.tick(1000);h.load(old);assert.equal(p.loadedAt,null);
 h.load();h.tick(3000);assert.equal(p.progressing,true);assert.equal(old.removed,true);p.destroy();
});
test('embed switching: all active documents delegate media across origins and retain navigation containment',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();p.reload();p.setVisible(false);p.setVisible(true);
 for(const frame of h.frames){assert.match(frame.allow,/autoplay \*/);assert.match(frame.allow,/encrypted-media \*/);assert.match(frame.allow,/fullscreen \*/);assert.equal(frame.allowFullscreen,true);assert.doesNotMatch(frame.attributes.get('sandbox'),/allow-popups|allow-top-navigation/);}
 p.destroy();
});
