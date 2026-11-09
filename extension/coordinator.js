import {VERSION,DEFAULTS,migrateConfig,validateConfig,normalizeLeague,normalizeScoreboard,rankGames,chooseGame,alignedGames} from './engine.js';
import {SCOREBOARD,requestJSON,scoreboardHighlights} from './feed.js';
import {normalizeHighlights,mergeHighlights,highlightView,espnURL,playable} from './highlights.js';
import {nextReplay,protectedLive} from './replay-policy.js';
import {rehearsalFrame} from './rehearsal.js';
import {TabRouter} from './tab-router.js';
import {demoData,demoHighlights} from './demo.js';
export const ALARM='fantasy-director-watchdog';
const fresh=()=>({apiVersion:3,lab:null,player:null,reel:false,quietSince:0,lastReplayAt:0,nextGame:'',lastSwitchMode:'',running:false,demo:false,demoStep:0,bindings:{},originalMutes:{},games:[],history:[],league:null,rosterAt:0,rosterError:'',fetchedAt:0,feedError:'',currentGame:'',lockGame:'',manualUntil:0,switchedAt:0,lastShown:{},switchCount:0,lastSwitchResult:null,candidate:null,decision:'Connect a roster or choose NFL RedZone.',decisionCode:'stopped',directorMode:'standby',engineToken:'',engineHeartbeat:0,engineError:'',nextPollAt:0,alarmDueAt:0,highlights:[],summaryPoll:{},highlightsAt:0,highlightsError:'',replay:null,log:[],timing:{samples:[],cuts:[]},gameSignature:'',lastGameChangeAt:0,lastTickAt:0,connectionRevision:0});
export class Coordinator {
  constructor(api,{request=requestJSON,now=Date.now}={}) {
    this.api=api;this.request=request;this.now=now;this.router=new TabRouter(api);this.queue=Promise.resolve();this.jobs=new Map();this.lastSavedAt=0;
  }
  async ready() {
    if(!this.loading)this.loading=(async()=>{
      const [local,session]=await Promise.all([this.api.storage.local.get('config'),this.api.storage.session.get('runtime')]);
      const old=session.runtime || {},r={...fresh(),...old};
      if(old.apiVersion!==3){r.running=false;r.engineToken='';r.apiVersion=3;r.candidate=null;r.timing={samples:[],cuts:[]};}
      this.s={version:VERSION,config:migrateConfig(local.config),runtime:r};return this.s;
    })();return this.loading;
  }
  enqueue(fn) {
    const task=this.queue.then(async()=>{await this.ready();return fn(this.s);});this.queue=task.catch(()=>{});return task;
  }
  async persist() {
    const config=JSON.stringify(this.s.config);
    if(this.savedConfig!==config){await this.api.storage.local.set({config:this.s.config});this.savedConfig=config;}
    await this.api.storage.session.set({runtime:this.s.runtime});this.lastSavedAt=this.now();
  }
  announce(){this.api.runtime.sendMessage({target:'desk',action:'updated'}).catch(()=>{});}
  log(text){const r=this.s.runtime;r.log=[{at:this.now(),text},...r.log].slice(0,80);}
  roster() {
    const {config:c,runtime:r}=this.s;if(c.focusMode==='nfl' && !r.lab)return [];
    return (r.league?.teams.find(t=>t.id===(r.demo?'demo':c.teamId))?.players || []).filter(p=>c.includeBench || p.starter);
  }
  policy(){return this.s.runtime.lab?{...this.s.config,focusMode:'fantasy',includeBench:false,holdSeconds:8,delaySeconds:0,autoHighlights:true,highlightsEnabled:true}:this.s.config;}
  games() {const {runtime:r}=this.s,c=this.policy();return rankGames(r.demo?r.games:alignedGames(r.games,r.history,r.bindings,c.delaySeconds,this.now()),this.roster(),c);}
  clips() {const {config:c,runtime:r}=this.s;return highlightView(r.highlights,this.roster(),0,this.now()).filter(h=>r.demo || h.discoveredAt<=this.now()-(r.bindings[h.gameId]?.delaySeconds ?? c.delaySeconds)*1000);}
  view() {
    const r=this.s.runtime;
    const league=r.league?{...r.league,teams:r.league.teams.map(t=>({...t,players:t.id===(r.demo?'demo':this.s.config.teamId)?t.players:[]}))}:null;
    return {...this.s,runtime:{...r,league,lab:r.lab?{...r.lab,saved:undefined}:null,games:this.games(),highlights:this.clips(),timing:{samples:r.timing.samples.slice(-1),cuts:r.timing.cuts.slice(-1)},highlightSources:Object.entries(r.summaryPoll).map(([gameId,p])=>({gameId,...p})),summaryPoll:undefined,history:undefined,originalMutes:undefined,engineToken:undefined,gameSignature:undefined}};
  }
  async ensureAlarm() {
    let alarm=await this.api.alarms.get(ALARM);
    if(!alarm){await this.api.alarms.create(ALARM,{periodInMinutes:0.5});alarm=await this.api.alarms.get(ALARM);}
    this.s.runtime.alarmDueAt=alarm?.scheduledTime || this.now()+30000;
  }
  async startEngine(restart=false) {
    const r=this.s.runtime;if((r.demo && !r.lab) || !r.running)return;
    const contexts=await this.api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[this.api.runtime.getURL('offscreen.html')]});
    if(contexts.length && !restart && r.engineToken && this.now()-r.engineHeartbeat<10000)return;
    if(contexts.length)await this.api.offscreen.closeDocument();
    r.engineToken=crypto.randomUUID();r.engineHeartbeat=this.now();r.engineError='';
    await this.persist();
    await this.api.offscreen.createDocument({url:'offscreen.html',reasons:['WORKERS'],justification:'Run the dedicated live-feed and timing worker while NFL streaming tabs are focused.'});
    const result=await this.api.runtime.sendMessage({target:'live-engine',type:'start',token:r.engineToken,pollSeconds:this.s.config.pollSeconds,lab:r.lab?{startedAt:r.lab.startedAt}:null});
    if(!result?.ok)throw new Error('Live engine did not start. Reload the extension and check its offscreen permission.');
  }
  async stop() {
    const r=this.s.runtime;r.running=false;r.reel=false;r.nextGame='';r.engineToken='';r.lockGame='';r.manualUntil=0;r.candidate=null;r.directorMode='standby';r.alarmDueAt=0;
    await this.persist(); // Late network results cannot restart a stopped session.
    if(r.replay)await this.endReplay(false);
    await this.api.alarms.clear(ALARM);
    const contexts=await this.api.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[this.api.runtime.getURL('offscreen.html')]});
    if(contexts.length)await this.api.offscreen.closeDocument();
    await this.router.restore(r);
  }
  async take(game,{manual=false,reason=game.reason,code='manual'}={}) {
    const r=this.s.runtime,at=this.now(),candidateAt=r.candidate?.id===game.id?r.candidate.since:(game.observedAt || at);
    try {
      if(!r.demo || r.lab)r.lastSwitchResult=await this.router.take(r,game,{muteOthers:this.s.config.muteOthers,manual,persist:()=>this.persist()});
      r.currentGame=game.id;r.switchedAt=this.now();r.lastSwitchMode=game.directorMode;r.lastShown[game.id]=r.switchedAt;r.switchCount++;r.candidate=null;
      const cut={at:r.switchedAt,gameId:game.id,name:game.name,code,reason,activationMs:r.demo&&!r.lab?0:r.lastSwitchResult.activationMs,decisionToActivationMs:r.switchedAt-at,receivedToActivationMs:r.switchedAt-r.fetchedAt,opportunityToActivationMs:r.switchedAt-candidateAt,snapshotToActivationMs:r.switchedAt-(game.fetchedAt || r.fetchedAt),alignmentSeconds:r.bindings[game.id]?.delaySeconds ?? this.s.config.delaySeconds};
      r.timing.cuts=[...r.timing.cuts,cut].slice(-120);this.log(`${r.demo?'Demo: ':''}${game.name} · ${reason}`);await this.persist();
    } catch(e){r.lastSwitchResult={ok:false,at:this.now(),error:e.message};r.decision=e.message;this.log(e.message);throw e;}
  }
  async evaluate() {
    const r=this.s.runtime;r.lastTickAt=this.now();
    if(!r.running)return;
    const c=this.policy(),games=this.games(),bindings=r.demo&&!r.lab?Object.fromEntries(games.map(g=>[g.id,{}])):r.bindings;
    if(r.replay?.native){
      const timedOut=this.now()>r.replay.deadline;
      const preempt=r.replay.automatic && !r.feedError && this.now()-r.fetchedAt<20000 && protectedLive(games,bindings);
      if(timedOut || preempt){await this.endReplay(false);this.log(timedOut?'Replay deadline reached · returning to coverage':'Live opportunity returned · replay interrupted');}
    }
    if(!r.reel && c.focusMode==='fantasy' && (!r.league || (!r.demo && this.now()-r.rosterAt>600000))){r.decision='Roster missing or too old · cuts paused';r.decisionCode='roster-stale';return;}
    const protectedNow=protectedLive(games,bindings);
    if(protectedNow || r.feedError)r.quietSince=0;else if(!r.quietSince)r.quietSince=this.now();
    const clip=nextReplay(this.clips(),games,r,r.reel?{...c,autoHighlights:true,highlightsEnabled:true}:c,this.now());
    if(clip){try{await this.openClip(clip.id,true);return;}catch(e){this.log('Automatic replay unavailable: '+e.message);}}
    const result=chooseGame(games,bindings,r,c,this.now());r.candidate=result.candidate;r.nextGame=result.nextId || '';
    if(result.code!==r.decisionCode)this.log(result.reason);
    r.decision=result.reason;r.decisionCode=result.code;r.directorMode=result.mode || (r.replay?'highlights':r.lockGame?'locked':'standby');
    if(result.game){try{await this.take(result.game,{reason:result.reason,code:result.code});}catch{r.decisionCode='switch-error';}}
  }
  ingest(games,meta,highlights=[]) {
    const r=this.s.runtime;
    const signatureOf=g=>JSON.stringify([g.state,g.statusName,g.clock,g.period,g.possession,g.yardsToGoal,g.lastPlayId,g.lastPlay,g.teams.map(t=>t.score)]);
    games=games.map(g=>{const previous=r.games.find(p=>p.id===g.id);return {...g,observedAt:previous && signatureOf(g)===signatureOf(previous)?(previous.observedAt || meta.receivedAt):meta.receivedAt};});
    const signature=JSON.stringify(games.map(g=>[g.id,g.state,g.statusName,g.clock,g.period,g.possession,g.yardsToGoal,g.lastPlayId,g.lastPlay,g.teams.map(t=>t.score)]));
    if(signature!==r.gameSignature){r.gameSignature=signature;r.lastGameChangeAt=this.now();}
    r.games=games;r.fetchedAt=meta.receivedAt;r.feedError='';r.engineError='';
    const needsHistory=this.s.config.delaySeconds>0 || Object.values(r.bindings).some(b=>b.delaySeconds>0);
    r.history=needsHistory?[...r.history,{at:meta.receivedAt,games}].filter(h=>meta.receivedAt-h.at<140000).slice(-32):[];
    r.timing.samples=[...r.timing.samples,{...meta,changedAt:r.lastGameChangeAt,liveGames:games.filter(g=>g.state==='in').length}].slice(-120);
    if(this.s.config.highlightsEnabled || r.reel)r.highlights=mergeHighlights(r.highlights,highlights,this.now());
  }
  async packet(packet) {
    await this.enqueue(async()=>{
      const r=this.s.runtime;if(!r.running || (r.demo&&!r.lab) || packet.token!==r.engineToken)return;
      r.engineHeartbeat=this.now();r.nextPollAt=packet.nextPollAt || r.nextPollAt;
      if(r.lab && packet.lab){r.lab.elapsed=packet.elapsed;r.lab.label=packet.label;if(packet.done){r.lab.complete=true;await this.stop();r.decision='Rehearsal complete · inspect the activity log or run it again';await this.persist();this.announce();return;}}
      const previous=r.decisionCode,current=r.currentGame;
      if(packet.type==='feed'){if(packet.meta.receivedAt<r.fetchedAt)return;this.ingest(packet.games,packet.meta,packet.highlights);}
      if(packet.type==='feedError'){r.feedError=packet.error;this.log(packet.error);}
      if(packet.type==='engineError'){r.engineError=packet.error;r.feedError=packet.error;r.engineHeartbeat=0;}
      await this.evaluate();
      if(packet.type==='feedError' || packet.type==='engineError' || current!==r.currentGame || this.now()-this.lastSavedAt>=30000)await this.persist();
      if(packet.type!=='pulse' || previous!==r.decisionCode || current!==r.currentGame || this.now()-(this.lastAnnouncedAt || 0)>=5000){this.announce();this.lastAnnouncedAt=this.now();}
    });
    this.maintenance();
  }
  // Network jobs execute outside the mutation queue. Their results re-enter
  // only for a short commit. Stop, feed packets and cuts never await highlights.
  job(key,run) {
    if(this.jobs.has(key))return this.jobs.get(key);
    const promise=run().finally(()=>{if(this.jobs.get(key)===promise)this.jobs.delete(key);});
    this.jobs.set(key,promise);return promise;
  }
  async refreshRoster() {
    await this.ready();
    const {config:c,runtime:r}=this.s,revision=r.connectionRevision;
    const key=`roster:${revision}`;
    return this.job(key,async()=>{
      try {
        const {raw}=await this.request(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${c.season}/segments/0/leagues/${c.leagueId}?view=mRoster&view=mTeam&view=mStatus`,{credentials:'include',timeout:8000});
        const league=normalizeLeague(raw);
        return await this.enqueue(async()=>{
          if(revision!==this.s.runtime.connectionRevision)return {ok:false,error:'League request superseded.'};
          Object.assign(this.s.runtime,{league,rosterAt:this.now(),rosterError:''});
          if(!league.teams.some(t=>t.id===this.s.config.teamId))this.s.config.teamId='';
          await this.persist();this.announce();return {ok:true};
        });
      }catch(e){return this.enqueue(async()=>{if(revision===this.s.runtime.connectionRevision){this.s.runtime.rosterError=e.message;this.s.runtime.rosterAttemptAt=this.now();await this.persist();this.announce();}return {ok:false,error:e.message};});}
    });
  }
  async refreshBoard() {
    await this.ready();const r=this.s.runtime;if(r.demo)return;
    if(r.running){await this.api.runtime.sendMessage({target:'live-engine',type:'poke'});return;}
    const token=r.engineToken,revision=r.connectionRevision;
    return this.job('scoreboard',async()=>{
      try {
        const {raw,meta}=await this.request(SCOREBOARD);const games=normalizeScoreboard(raw,meta.receivedAt);
        await this.enqueue(async()=>{if(this.s.runtime.demo || revision!==this.s.runtime.connectionRevision || token!==this.s.runtime.engineToken)return;this.ingest(games,meta,scoreboardHighlights(raw,games,meta.receivedAt));await this.persist();this.announce();});
      }catch(e){await this.enqueue(async()=>{if(revision===this.s.runtime.connectionRevision && !this.s.runtime.running){this.s.runtime.feedError=e.message;await this.persist();this.announce();}});}
    });
  }
  async refreshHighlights(force=false) {
    await this.ready();
    return this.job('highlights',async()=>{
      const selected=await this.enqueue(()=>{
        const r=this.s.runtime,now=this.now();
        if(r.demo || (!this.s.config.highlightsEnabled && !r.reel && !force) || (!force && now-r.highlightsAt<30000))return null;
        r.highlightsAt=now;
        const games=r.games.filter(g=>/^\d+$/.test(g.id) && ['in','post'].includes(g.state) && (force || now-(r.summaryPoll[g.id]?.at || 0)>=(r.summaryPoll[g.id]?.failed?300000:g.state==='post'?1800000:120000))).sort((a,b)=>(r.summaryPoll[a.id]?.at || 0)-(r.summaryPoll[b.id]?.at || 0)).slice(0,1);
        return games.length?{games,revision:r.connectionRevision}:null;
      });
      if(!selected)return;
      const results=await Promise.allSettled(selected.games.map(async g=>normalizeHighlights((await this.request(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${g.id}`,{timeout:4000})).raw,g,this.now())));
      await this.enqueue(async()=>{
        const r=this.s.runtime;if(r.demo || selected.revision!==r.connectionRevision)return;
        for(let i=0;i<results.length;i++){const x=results[i],g=selected.games[i],ok=x.status==='fulfilled';r.summaryPoll[g.id]={at:this.now(),name:g.name,failed:!ok,error:ok?'':x.reason.message,clips:ok?x.value.filter(h=>h.kind==='clip').length:0,plays:ok?x.value.filter(h=>h.kind==='play').length:0};if(ok)r.highlights=mergeHighlights(r.highlights,x.value,this.now());}
        const errors=Object.values(r.summaryPoll).filter(x=>x.failed);r.highlightsError=errors.length?`${errors.length} highlight source(s) unavailable. Live cuts are unaffected.`:'';
        await this.persist();this.announce();
      });
    });
  }
  maintenance() {
    if(!this.s?.runtime.running || this.s.runtime.demo)return;
    const r=this.s.runtime;
    if(!r.reel && this.s.config.focusMode==='fantasy' && r.league && this.now()-Math.max(r.rosterAt,r.rosterAttemptAt || 0)>120000)void this.refreshRoster().catch(()=>{});
    if(this.now()-r.highlightsAt>=30000)void this.refreshHighlights().catch(()=>{});
  }
  async endReplay(returnLive=true) {
    const r=this.s.runtime,replay=r.replay;if(!replay)return;
    r.replay=null;r.lastReplayAt=this.now();
    if(replay.native)await this.api.runtime.sendMessage({target:'replay-player',type:'clear',tabId:replay.tabId}).catch(()=>{});
    else try{const tab=await this.api.tabs.get(replay.tabId);if(tab.url===replay.url)await this.api.tabs.remove(tab.id);}catch{}
    if(!r.running)await this.router.restore(r);r.currentGame='';r.switchedAt=0;
    if(returnLive){
      const game=this.games().find(g=>g.id===(r.lockGame || replay.previousGame));
      const hasLive=this.games().some(g=>g.eligible && r.bindings[g.id] && !r.bindings[g.id].unavailable);
      if(game && (r.lockGame || !r.running || (!hasLive && !r.reel)))await this.take(game,{manual:true,reason:'Returned from highlight'});
      if(r.running){await this.router.prepare(r,()=>this.persist());await this.evaluate();}
      else r.decision='Returned to live. Auto remains stopped.';
    }
  }
  async openClip(id,automatic=false) {
    const r=this.s.runtime,item=this.clips().find(h=>h.id===id && h.kind==='clip');
    if(r.demo && !r.lab)throw new Error('Demo clips are fictional.');
    if(!item)throw new Error('This clip is unavailable or inside the timing buffer.');
    if(playable(item,this.now()) || (r.lab && item.testClip))return this.openNativeClip(item,automatic);
    if(automatic)throw new Error('This clip has no playable published MP4 source.');
    const url=espnURL(item.url);if(!url)throw new Error('No supported ESPN clip link.');
    const previousGame=r.replay?.previousGame || r.currentGame;if(r.replay)await this.endReplay(false);
    try {
      await this.router.muteAll(r,()=>this.persist());const tab=await this.api.tabs.create({url,active:true});
      r.replay={tabId:tab.id,url,highlightId:id,title:item.title,previousGame};r.highlights=r.highlights.map(h=>h.id===id?{...h,opened:true}:h);
      r.decision='Highlight break · close the clip or Return to live';r.directorMode='highlights';this.log('Opened ESPN clip: '+item.title);
    }catch(e){await this.router.restore(r);const game=this.games().find(g=>g.id===previousGame);if(r.running && game)await this.take(game,{manual:true});throw e;}
  }
  async openNativeClip(item,automatic) {
    const r=this.s.runtime,previousGame=r.replay?.previousGame || r.currentGame;
    if(r.replay)await this.endReplay(false);
    const url=this.api.runtime.getURL('replay.html');let tab;
    if(r.player)try{const old=await this.api.tabs.get(r.player.tabId);if(old.url===url)tab=old;}catch{}
    if(!tab)tab=await this.api.tabs.create({url,active:false});
    r.player={tabId:tab.id,url};
    r.replay={native:true,automatic,tabId:tab.id,url,nonce:crypto.randomUUID(),highlightId:item.id,title:item.title,previousGame,phase:'loading',deadline:this.now()+12000};
    r.highlights=r.highlights.map(h=>h.id===item.id?{...h,attemptedAt:this.now()}:h);
    r.decision='Preparing replay · live coverage continues';r.directorMode='highlights';
    this.log('Preparing replay: '+item.title);
    await this.persist();
    this.api.runtime.sendMessage({target:'replay-player',type:'load',tabId:tab.id}).catch(()=>{});this.announce();
  }
  async playerRequest(m,sender) {
    return this.enqueue(async()=>{
      const r=this.s.runtime,replay=r.replay;
      if(sender.url!==this.api.runtime.getURL('replay.html') || sender.tab?.id!==r.player?.tabId)throw new Error('Replay player is not owned by this session.');
      if(m.action==='playerState'){
        if(!replay?.native)return null;
        const item=r.highlights.find(h=>h.id===replay.highlightId);
        if(!item || !(playable(item,this.now()) || (r.lab && item.testClip)))return null;
        return {nonce:replay.nonce,title:item.title,url:item.testClip?this.api.runtime.getURL('assets/rehearsal.webm'):item.mediaUrl,source:espnURL(item.url),test:!!item.testClip,automatic:replay.automatic,maxSeconds:replay.automatic?100:Math.min(900,Math.max(120,item.duration+15))};
      }
      if(!replay?.native || m.nonce!==replay.nonce)return null;
      if(m.event==='ready'){
        const item=r.highlights.find(h=>h.id===replay.highlightId);
        if(!item || !(playable(item,this.now()) || (r.lab && item.testClip))){await this.endReplay();return {play:false};}
        await this.router.muteAll(r,()=>this.persist());
        const tab=await this.api.tabs.get(replay.tabId);if(tab.url!==replay.url)throw new Error('Replay tab navigated away.');
        await this.api.windows.update(tab.windowId,{focused:true});await this.api.tabs.update(tab.id,{active:true,muted:false});
        if(!(await this.api.tabs.get(tab.id)).active)throw new Error('Replay tab did not activate.');
        replay.phase='playing';replay.deadline=this.now()+(replay.automatic?105:Math.min(905,Math.max(125,item.duration+20)))*1000;r.decision='Replay playing · live opportunities can interrupt';
        await this.persist();this.announce();return {play:true};
      }
      if(m.event==='playing' || m.event==='muted'){
        r.highlights=r.highlights.map(h=>h.id===replay.highlightId?{...h,opened:true,played:true}:h);
        replay.muted=m.event==='muted';this.log(replay.muted?'Replay playing muted · enable sound in the player':'Automatic replay playing');
      }else if(['ended','error','skip','stalled'].includes(m.event)){
        if(['error','stalled'].includes(m.event)){r.highlights=r.highlights.map(h=>h.id===replay.highlightId?{...h,playbackError:'Playback unavailable'}:h);this.log('Replay unavailable · returning to coverage');}
        await this.endReplay();
      }
      await this.persist();this.announce();return {ok:true};
    });
  }
  async startRehearsal() {
    if(this.s.runtime.lab)await this.exitRehearsal();
    await this.stop();const r=this.s.runtime,saved=structuredClone(r),frame=rehearsalFrame(0,this.now());
    const revision=r.connectionRevision+1;
    Object.assign(r,fresh(),{connectionRevision:revision,demo:true,lab:{startedAt:this.now(),elapsed:0,label:frame.label,complete:false,saved,tabs:[]},league:frame.league,rosterAt:this.now()});
    try{
      for(const game of frame.games){
        const url=this.api.runtime.getURL(`test-stream.html?game=${game.id}&session=${r.lab.startedAt}`),tab=await this.api.tabs.create({url,active:false});
        r.lab.tabs.push({tabId:tab.id,url});r.bindings[game.id]={tabId:tab.id,url,delaySeconds:0};
      }
      this.ingest(frame.games,{receivedAt:this.now(),networkMs:0},[]);r.running=true;
      await this.router.prepare(r,()=>this.persist());await this.ensureAlarm();await this.startEngine(true);await this.evaluate();
    }catch(e){await this.exitRehearsal();throw e;}
  }
  async exitRehearsal() {
    const r=this.s.runtime,lab=r.lab;if(!lab)return;
    await this.stop();
    for(const owned of [...lab.tabs,...(r.player?[r.player]:[])])try{const tab=await this.api.tabs.get(owned.tabId);if(tab.url===owned.url)await this.api.tabs.remove(tab.id);}catch{}
    Object.assign(r,fresh(),lab.saved,{lab:null,demo:false,running:false,engineToken:'',connectionRevision:r.connectionRevision+1});
    r.decision='Rehearsal ended · your live setup is restored; Auto is stopped';await this.router.validate(r);
  }
  async action(m) {
    const {config:c,runtime:r}=this.s;
    if(r.lab && ['settings','beginConnect','demo','exitDemo','forget'].includes(m.action))throw new Error('Exit rehearsal before changing your live setup.');
    switch(m.action){
      case 'state':if(r.running && (!r.demo || r.lab)){await this.ensureAlarm();if(r.engineError || this.now()-r.engineHeartbeat>10000)await this.startEngine(!!r.engineError);}return;
      case 'rehearsal':await this.startRehearsal();break;
      case 'exitRehearsal':await this.exitRehearsal();break;
      case 'reel':{
        if(r.demo)throw new Error('Exit rehearsal first.');await this.stop();r.reel=true;r.running=true;r.quietSince=this.now()-5000;r.lastReplayAt=0;
        await this.ensureAlarm();await this.startEngine(true);await this.evaluate();break;
      }
      case 'settings':{
        const next=validateConfig(m.config,c);
        if(next.leagueId!==c.leagueId || next.season!==c.season)throw new Error('Use Connect to change league or season.');
        if(next.teamId!==c.teamId || next.focusMode!==c.focusMode){await this.stop();r.currentGame='';}
        if(c.muteOthers && !next.muteOthers)await this.router.restore(r);
        this.s.config=next;
        if(r.running && next.pollSeconds!==c.pollSeconds)await this.startEngine(true);
        if(r.running && next.muteOthers!==c.muteOthers){
          await this.router.prepare(r,()=>this.persist());
          const current=this.games().find(g=>g.id===r.currentGame);
          if(next.muteOthers && current)await this.take(current,{manual:true,reason:'Updated stream audio preference'});
        }break;
      }
      case 'beginConnect':{
        await this.stop();this.s.config=validateConfig(m.config,c);r.connectionRevision++;r.demo=false;r.league=null;r.rosterAt=0;r.rosterError='';
        if(m.auth?.swid || m.auth?.s2){
          const swid=String(m.auth.swid || '').trim(),s2=String(m.auth.s2 || '').trim();
          if(!/^\{[0-9a-f-]{36}\}$/i.test(swid) || !s2 || s2.length>4096 || /[\s;\r\n]/.test(s2))throw new Error('Enter both valid ESPN cookies.');
          for(const [name,value] of [['SWID',swid],['espn_s2',s2]])await this.api.cookies.set({url:'https://fantasy.espn.com/',domain:'.espn.com',path:'/',name,value,secure:true,httpOnly:true,sameSite:'no_restriction'});
        }break;
      }
      case 'start':{
        if(r.lab){await this.startRehearsal();break;}r.reel=false;
        if(r.replay)await this.endReplay(false);
        if(!r.demo && c.focusMode==='fantasy' && !r.league?.teams.some(t=>t.id===c.teamId))throw new Error('Connect and select your team, or choose NFL RedZone.');
        await this.router.validate(r);if(!r.demo && !Object.keys(r.bindings).length)throw new Error('Assign game tabs before starting Auto.');
        r.running=true;r.quietSince=0;r.lockGame='';r.manualUntil=0;r.candidate=null;r.currentGame='';r.switchedAt=0;
        try{await this.ensureAlarm();if(!r.demo){await this.router.prepare(r,()=>this.persist());await this.startEngine(true);}await this.evaluate();}
        catch(e){await this.stop();r.engineError=e.message;throw e;}
        this.log('Auto started · live worker enabled.');break;
      }
      case 'stop':await this.stop();r.decision='Stopped. Original stream audio restored.';r.decisionCode='stopped';this.log(r.decision);break;
      case 'auto':r.lockGame='';r.manualUntil=0;r.switchedAt=0;r.candidate=null;await this.evaluate();break;
      case 'bind':{
        if(r.demo)throw new Error('Exit demo to assign real streams.');
        if(!r.games.some(g=>g.id===m.gameId))throw new Error('Refresh the game list first.');
        await this.router.restore(r);
        if(!m.tabId){delete r.bindings[m.gameId];}
        else {
          const tab=await this.api.tabs.get(Number(m.tabId));if(!/^https:\/\//.test(tab.url || ''))throw new Error('Choose an HTTPS game tab.');
          if(Object.entries(r.bindings).some(([id,b])=>id!==m.gameId && b.tabId===tab.id))throw new Error('That tab is already assigned to another game.');
          r.bindings[m.gameId]={tabId:tab.id,url:tab.url,delaySeconds:c.delaySeconds,unavailable:!!tab.discarded};
        }
        if(r.currentGame===m.gameId)r.currentGame='';if(r.lockGame===m.gameId)r.lockGame='';r.manualUntil=0;
        if(r.running){await this.router.prepare(r,()=>this.persist());r.currentGame='';await this.evaluate();}break;
      }
      case 'streamTiming':{
        const b=r.bindings[m.gameId],seconds=Number(m.seconds);if(!b || !Number.isInteger(seconds) || seconds<0 || seconds>120)throw new Error('Assign a stream and enter 0–120 seconds.');
        b.delaySeconds=seconds;r.candidate=null;break;
      }
      case 'watch':case 'lock':case 'testSwitch':{
        if(r.replay)await this.endReplay(false);await this.router.validate(r);
        const games=this.games();let game=games.find(g=>g.id===m.gameId);
        if(m.action==='testSwitch'){
          if(r.demo)throw new Error('Exit demo to test real tabs.');
          const assigned=games.filter(g=>r.bindings[g.id]);if(assigned.length<2)throw new Error('Assign two different game tabs first.');
          game=assigned[(assigned.findIndex(g=>g.id===r.currentGame)+1)%assigned.length];
        }
        if(!game)throw new Error('Game unavailable. Refresh the desk.');
        await this.take(game,{manual:true,reason:m.action==='testSwitch'?'Manual tab activation test':'Viewer selection'});
        r.lockGame=m.action==='lock'?game.id:'';r.manualUntil=m.action==='lock'?0:this.now()+c.holdSeconds*1000;
        r.decision=m.action==='lock'?'Game locked · Resume Auto to release':r.running?`Preview · Auto resumes in ${c.holdSeconds}s`:'Tab selected. Auto is stopped.';break;
      }
      case 'openHighlight':await this.openClip(m.highlightId);break;
      case 'returnLive':{
        const wasReel=r.reel;r.reel=false;
        if(wasReel && (!Object.keys(r.bindings).length || (c.focusMode==='fantasy'&&!r.league?.teams.some(t=>t.id===c.teamId)))){await this.stop();r.decision='Highlight queue stopped. Assign streams to return to live coverage.';}
        else await this.endReplay();break;
      }
      case 'demo':await this.stop();Object.assign(r,fresh(),{demo:true});{const d=demoData(0,this.now());r.league=d.league;r.games=d.games;r.fetchedAt=this.now();r.highlights=demoHighlights();r.decision='Fictional demo · no real stream control';}break;
      case 'advance':{
        if(!r.demo)throw new Error('Available in demo only.');const d=demoData(++r.demoStep,this.now());r.games=d.games;r.fetchedAt=this.now();r.highlights=mergeHighlights(r.highlights,demoHighlights(r.demoStep),this.now());r.switchedAt=this.now()-100000;r.candidate=null;await this.evaluate();break;
      }
      case 'exitDemo':case 'forget':await this.stop();Object.assign(r,fresh(),{connectionRevision:r.connectionRevision+1});if(m.action==='forget')this.s.config={...DEFAULTS};break;
      default:throw new Error('Unknown control.');
    }
  }
  async dispatch(m) {
    await this.ready();
    if(m.action==='tabs')return (await this.api.tabs.query({})).filter(t=>/^https:\/\//.test(t.url || '')).map(t=>({id:t.id,title:t.title || new URL(t.url).hostname}));
    if(m.action==='report')return this.enqueue(()=>this.report());
    if(m.action==='connect'){
      await this.enqueue(async()=>{try{await this.action({...m,action:'beginConnect'});}finally{await this.persist();}});
      const result=await this.refreshRoster();if(!result.ok)throw new Error(result.error);await this.refreshBoard();
    } else if(m.action==='poll'){
      if(m.force && this.s.runtime.league && !this.s.runtime.demo)void this.refreshRoster().catch(()=>{});
      await this.refreshBoard();void this.refreshHighlights().catch(()=>{});
    } else if(m.action==='refreshHighlights')await this.refreshHighlights(true);
    else await this.enqueue(async()=>{try{await this.action(m);}finally{if(m.action!=='state')await this.persist();}});
    return this.enqueue(()=>this.view());
  }
  async watchdog() {
    await this.enqueue(async()=>{
      const r=this.s.runtime;if(!r.running){await this.api.alarms.clear(ALARM);return;}
      try{await this.router.validate(r);await this.ensureAlarm();if(!r.demo || r.lab)await this.startEngine(!!r.engineError);await this.evaluate();}
      catch(e){r.engineError=e.message;r.feedError=e.message;r.decision='Live engine needs attention: '+e.message;this.log(r.decision);}
      await this.persist();this.announce();
    });this.maintenance();
  }
  async tabChanged(tabId,removed=false) {
    await this.enqueue(async()=>{
      const r=this.s.runtime;
      if(!Object.values(r.bindings).some(b=>b.tabId===tabId) && r.player?.tabId!==tabId && r.replay?.tabId!==tabId)return;
      if(r.replay?.tabId===tabId){let valid=!removed;try{valid=valid && (await this.api.tabs.get(tabId)).url===r.replay.url;}catch{valid=false;}if(!valid)await this.endReplay();}
      if(removed && r.player?.tabId===tabId)r.player=null;
      if(Object.values(r.bindings).some(b=>b.tabId===tabId)){await this.router.validate(r);await this.evaluate();}
      await this.persist();this.announce();
    });
  }
  report() {
    const r=this.s.runtime,c=this.s.config;
    return {product:'Fantasy Director',version:VERSION,createdAt:new Date(this.now()).toISOString(),settings:{focusMode:c.focusMode,pollSeconds:c.pollSeconds,holdSeconds:c.holdSeconds,delaySeconds:c.delaySeconds},engine:{running:r.running,heartbeat:r.engineHeartbeat,nextPollAt:r.nextPollAt,error:r.engineError},feed:{lastReceived:r.fetchedAt,lastChange:r.lastGameChangeAt,error:r.feedError},streams:Object.entries(r.bindings).map(([gameId,b])=>({gameId,delaySeconds:b.delaySeconds,unavailable:b.unavailable})),timing:r.timing,decisions:r.log,limitations:'Network RTT and receipt-to-cut timing are measured locally. Field-to-ESPN delay and video delay are not automatically measured. No credentials, stream URLs or fantasy roster are included.'};
  }
}
