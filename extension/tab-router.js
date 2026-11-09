import {sameStreamURL} from './engine.js';
export class TabRouter {
  constructor(api){this.api=api;}
  async validate(r) {
    await Promise.all(Object.entries(r.bindings).map(async([gameId,b])=>{
      try {
        const tab=await this.api.tabs.get(b.tabId);
        if(!sameStreamURL(tab.url,b.url))throw new Error('navigated');
        b.unavailable=!!tab.discarded;b.status=tab.discarded?'Tab unloaded · open its player':tab.status==='loading'?'Page loading':'Tab available';
      } catch {
        delete r.bindings[gameId];if(r.currentGame===gameId)r.currentGame='';if(r.lockGame===gameId)r.lockGame='';
      }
    }));
  }
  async capture(r,persist) {
    const bindings=Object.values(r.bindings);
    const tabs=(await Promise.allSettled(bindings.map(b=>this.api.tabs.get(b.tabId)))).filter(x=>x.status==='fulfilled').map(x=>x.value).filter(tab=>bindings.some(b=>b.tabId===tab.id && sameStreamURL(tab.url,b.url)));
    for(const tab of tabs){
      if(!r.originalMutes[tab.id])r.originalMutes[tab.id]={url:tab.url,muted:!!tab.mutedInfo?.muted,autoDiscardable:tab.autoDiscardable!==false};
    }
    await persist();return tabs;
  }
  async prepare(r,persist) {
    const tabs=await this.capture(r,persist);
    await Promise.allSettled(tabs.map(tab=>this.api.tabs.update(tab.id,{autoDiscardable:false})));
  }
  async take(r,game,{muteOthers=true,manual=false,persist=async()=>{}}={}) {
    const b=r.bindings[game.id];if(!b)throw new Error('Assign a stream tab to this game.');
    const target=await this.api.tabs.get(b.tabId);
    if(!sameStreamURL(target.url,b.url)){delete r.bindings[game.id];throw new Error('Stream URL changed. Assign this game again.');}
    if(target.discarded && !manual){b.unavailable=true;throw new Error('Stream tab was unloaded. Open its player before Auto can use it.');}
    const startedAt=Date.now();
    if(muteOthers){
      const tabs=await this.capture(r,persist);
      // Quiet every outgoing stream in parallel, then activate and unmute the
      // incoming tab. Never reload a player or leave two managed tabs audible.
      const results=await Promise.allSettled(tabs.filter(t=>t.id!==target.id && sameStreamURL(t.url,r.originalMutes[t.id]?.url)).map(t=>this.api.tabs.update(t.id,{muted:true})));
      if(results.some(x=>x.status==='rejected'))throw new Error('An outgoing stream could not be muted. Check its audio and retry.');
    }
    await this.api.windows.update(target.windowId,{focused:true});
    await this.api.tabs.update(target.id,{active:true,...(muteOthers?{muted:false}:{})});
    if(!(await this.api.tabs.get(target.id)).active)throw new Error('Chrome did not activate the target tab. Test the switch outside fullscreen.');
    return {ok:true,at:Date.now(),tabId:target.id,windowId:target.windowId,gameId:game.id,activationMs:Date.now()-startedAt};
  }
  async muteAll(r,persist) {
    const tabs=await this.capture(r,persist);
    await Promise.all(tabs.filter(t=>sameStreamURL(t.url,r.originalMutes[t.id]?.url)).map(t=>this.api.tabs.update(t.id,{muted:true})));
  }
  async restore(r) {
    const failures={};
    await Promise.all(Object.entries(r.originalMutes).map(async([key,value])=>{
      try {const tab=await this.api.tabs.get(Number(key));if(sameStreamURL(tab.url,value.url))await this.api.tabs.update(tab.id,{muted:value.muted,autoDiscardable:value.autoDiscardable!==false});}
      catch{try{await this.api.tabs.get(Number(key));failures[key]=value;}catch{}}
    }));r.originalMutes=failures;
  }
}
