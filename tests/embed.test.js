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
test('embed recovery: a page that never loads retries three times with long windows, then stops and asks the viewer',()=>{
 const h=harness(),{p}=h,errors=[],events=[];p.on('error',x=>errors.push(x));p.on('reconnect',d=>events.push(d));p.setVisible(true);p.play();
 for(const [at,count] of [[44999,1],[45000,2],[104999,2],[105000,3],[194999,3],[195000,4]]){h.tick(at);p.checkHealth();assert.equal(h.navigations.length,count);assert.equal(errors.length,0);}
 assert.deepEqual(events.map(x=>x.failover),[false,true,true],'the other source is tried only once this page has had two full windows');
 h.tick(10000000);p.checkHealth();assert.equal(h.navigations.length,4,'no endless loop');assert.equal(p.gaveUp,true);assert.equal(p.reconnecting,true);assert.match(p.recoveryMessage,/Reload stream/);
 assert.equal(p.reload(),true);assert.equal(h.navigations.length,5);assert.equal(p.gaveUp,false);
 p.pause();const paused=h.navigations.length;h.tick(15000000);p.checkHealth();assert.equal(h.navigations.length,paused);assert.equal(h.frame.src,'about:blank');p.destroy();
});
test('embed recovery: a click inside the page counts as proof of life and stops automatic reloads',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.tick(20000);p.noteInteraction();
 h.tick(400000);p.checkHealth();assert.equal(h.navigations.length,1,'no load-window retry and no periodic refresh after the viewer pressed play');assert.equal(p.progressing,true);
 h.tick(20000+600001);p.checkHealth();assert.equal(h.navigations.length,2,'the periodic refresh returns once the trust has expired');
 p.setVisible(false);p.setVisible(true);assert.equal(p.interactedAt,null,'a fresh document starts without trust');p.destroy();
});test('embed recovery: a successful loading retry resets backoff and repeated reloads remain spaced',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.tick(45000);p.checkHealth();assert.equal(h.navigations.length,2);h.tick(46000);h.load();
 assert.equal(p.loadRetries,0);assert.equal(p.everLoaded,true);
 h.tick(164999);p.checkHealth();assert.equal(h.navigations.length,2);h.tick(165000);p.checkHealth();assert.equal(h.navigations.length,3,'the periodic refresh runs two minutes after the retry');
 h.tick(209999);p.checkHealth();assert.equal(h.navigations.length,3);h.tick(210000);p.checkHealth();assert.equal(h.navigations.length,4,'a page that then fails to load gets the first window again');h.load();p.destroy();
});test('embed recovery: user reload resets the periodic deadline instead of immediately reloading twice',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();h.tick(119000);p.reload();h.load();
 h.tick(120000);p.checkHealth();assert.equal(h.navigations.length,2);h.tick(239000);p.checkHealth();assert.equal(h.navigations.length,3);p.destroy();
});
test('embed recovery: a flapping network cannot cause rapid reloads or consume the load retry budget',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();
 for(let at=1000;at<=30000;at+=1000){h.tick(at);p.checkHealth({online:false});p.checkHealth({online:true});}
 assert.equal(h.navigations.length,1,'blips shorter than the settle time never reload');
 h.tick(40000);p.checkHealth({online:false});h.tick(46000);p.checkHealth({online:false});h.tick(47000);p.checkHealth({online:true});
 assert.equal(h.navigations.length,2,'a real outage reconnects once it is back');assert.equal(p.error,null);assert.equal(p.loadRetries,0);
 h.load();h.tick(48000);p.checkHealth({online:false});h.tick(54000);p.checkHealth({online:false});h.tick(55000);p.checkHealth({online:true});assert.equal(h.navigations.length,2,'and not again within ten seconds of the last reconnect');
 p.destroy();
});test('embed recovery: hidden, paused and destroyed frames cannot reconnect from late health checks',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.load();p.setVisible(false);const hidden=h.navigations.length;
 h.tick(300000);p.checkHealth();assert.equal(h.navigations.length,hidden);p.setVisible(true);h.load();p.pause();const paused=h.navigations.length;
 h.tick(600000);p.checkHealth();assert.equal(h.navigations.length,paused);p.destroy();const destroyed=h.navigations.length;
 h.tick(900000);p.checkHealth();assert.equal(h.navigations.length,destroyed);
});
test('embed recovery: a background tab suspends a loading deadline without burst retries on return',()=>{
 const h=harness(),{p}=h;p.setVisible(true);p.play();h.tick(5000);p.checkHealth({foreground:false});
 h.tick(605000);p.checkHealth({foreground:false});assert.equal(h.navigations.length,1);p.checkHealth();assert.equal(h.navigations.length,1);
 h.tick(644999);p.checkHealth();assert.equal(h.navigations.length,1);h.tick(645000);p.checkHealth();assert.equal(h.navigations.length,2);p.destroy();
});test('embed recovery: opting out stops periodic refresh but retains page-load recovery',()=>{
 const h=harness(),{p}=h;p.setAutoReconnect(false);p.setVisible(true);p.play();h.load();h.tick(500000);p.checkHealth();assert.equal(h.navigations.length,1);
 p.setAutoReconnect(true);p.checkHealth();assert.equal(h.navigations.length,1);h.tick(620000);p.checkHealth();assert.equal(h.navigations.length,2);
 p.setAutoReconnect(false);h.tick(664999);p.checkHealth();assert.equal(h.navigations.length,2);h.tick(665000);p.checkHealth();assert.equal(h.navigations.length,3,'load retries do not depend on the optional periodic refresh');p.destroy();
});test('embed recovery: reconnect announces navigation first and respects synchronous Pause or destruction',()=>{
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
