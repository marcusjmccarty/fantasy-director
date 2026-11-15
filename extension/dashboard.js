import {espnURL} from './highlights.js';
const $=id=>document.getElementById(id);
let state=null, tabs=[], busy=false, lastError='', gameFilter='all', highlightFilter='all';
const painted=new Map();
function unchanged(key,value){const signature=JSON.stringify(value);if(painted.get(key)===signature)return true;painted.set(key,signature);return false;}
function text(id,value){const node=$(id);if(node.textContent!==value)node.textContent=value;}
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
async function message(action,extra={}) {
  const response=await chrome.runtime.sendMessage({action,...extra});
  if (!response?.ok) throw new Error(response?.error || 'Extension unavailable. Reload the extension, then reopen this page.');
  return response.data;
}
function notice(text='') {lastError=text;$('notice').textContent=text;$('notice').hidden=!text;}
async function perform(action,extra={},options={}) {
  if(busy && !['stop','rehearsal','exitRehearsal'].includes(action)) {notice('Finishing the previous request. Please try this control again in a moment.');return false;}
  busy=true;notice();
  for(const b of document.querySelectorAll('[data-operation]')) b.disabled=true;
  try {state=await message(action,extra);render();if(options.fill)fillSettings();return true;}
  catch(e) {notice(e.message);try {state=await message('state');render();}catch{}return false;}
  finally {busy=false;for(const b of document.querySelectorAll('[data-operation]')) b.disabled=false;}
}
function settings() {
  return {...state.config,leagueId:$('leagueId').value.trim(),season:Number($('season').value),pollSeconds:Number($('pollSeconds').value),holdSeconds:Number($('holdSeconds').value),maxDwellSeconds:Number($('maxDwellSeconds').value),delaySeconds:Number($('delaySeconds').value),includeBench:$('includeBench').checked,muteOthers:$('muteOthers').checked,highlightsEnabled:$('highlightsEnabled').checked,autoHighlights:$('autoHighlights').checked};
}
function fillSettings() {
  if(!state)return;
  for(const key of ['leagueId','season','pollSeconds','holdSeconds','maxDwellSeconds','delaySeconds']) $(key).value=state.config[key];
  for(const key of ['includeBench','muteOthers','highlightsEnabled','autoHighlights']) $(key).checked=state.config[key];
}
function openSettings() {fillSettings();$('settingsDialog').showModal();}
function render() {
  const {config:c,runtime:r}=state, team=r.league?.teams.find(t=>t.id===(r.demo?'demo':c.teamId));
  const age=r.fetchedAt?Math.max(0,Math.floor((Date.now()-r.fetchedAt)/1000)):null;
  $('mode').textContent=r.lab?'REHEARSAL':r.demo?'DEMO':r.replay?'HIGHLIGHTS':r.running?(r.lockGame?'LOCKED':r.manualUntil>Date.now()?'PREVIEW':r.directorMode==='redzone'?'REDZONE':'AUTO ON'):'STANDBY';
  $('demoBanner').hidden=!r.demo;
  $('demoBtn').hidden=r.demo;
  if(r.lab)text('labProgress',`${r.lab.elapsed} / 72s · ${r.lab.complete?'Complete':r.lab.label}`);
  $('playReel').disabled=r.demo;
  $('setupBtn').disabled=!!r.lab;
  $('freshness').textContent=r.demo?'FICTIONAL FEED':r.feedError?'FEED ERROR':age===null?'NO FEED':`UPDATED ${age}s AGO`;
  $('startBtn').disabled=r.running;
  $('stopBtn').disabled=!r.running && !r.currentGame && !r.replay;
  $('autoBtn').hidden=!r.lockGame && !(r.running && r.manualUntil>Date.now());
  $('autoBtn').textContent='Resume Auto now';
  $('decision').textContent=r.decision;
  if(!unchanged('teams',[r.league?.teams.map(t=>[t.id,t.name]),r.demo])){
  $('teamSelect').replaceChildren();
  const prompt=el('option','',r.league?'Select your fantasy team':'Connect ESPN to select team');prompt.value='';$('teamSelect').append(prompt);
  for(const t of r.league?.teams || []) {const opt=el('option','',t.name);opt.value=t.id;$('teamSelect').append(opt);}
  }
  $('teamSelect').value=r.demo?'demo':c.teamId;
  $('teamSelect').disabled=r.demo || c.focusMode==='nfl';
  $('focusMode').value=r.lab?'fantasy':c.focusMode;$('focusMode').disabled=r.demo;
  const starters=team?.players.filter(p=>p.starter) || [];
  $('starterCount').textContent=team?starters.length:'—';
  $('gameCount').textContent=r.games.filter(g=>g.eligible).length;
  $('streamCount').textContent=Object.keys(r.bindings).length;
  $('rosterStatus').textContent=r.lab?'Fictional roster · real local test tabs':r.demo?'Fictional roster / preview only':c.focusMode==='nfl'?'NFL mode · closest scoring threat across your assigned streams.':team?`Week ${r.league.week || '—'} · ${c.includeBench?'Entire roster':'Starters only'} watched`:'Select your team after connecting ESPN.';
  const program=r.games.find(g=>g.id===r.currentGame);
  if(program) {
    $('programLabel').textContent=r.replay?'HIGHLIGHT BREAK':r.demo?'DEMO / '+(program.rosterActive?'ROSTER FOCUS':'REDZONE FALLBACK'):r.lockGame?'MANUAL LOCK':program.rosterActive?'ROSTER FOCUS · INFERRED INVOLVEMENT':'REDZONE FALLBACK';
    $('programTitle').textContent=r.replay?.title || program.name;
    $('programReason').textContent=program.reason;
  } else {
    $('programLabel').textContent=r.replay?'REPLAY ROOM':team?'YOUR ROSTER IS READY':'READY WHEN YOU ARE';
    $('programTitle').textContent=r.replay?.title || (team?'Let’s call the cuts.':'Build your Sunday lineup.');
    $('programReason').textContent=r.replay?r.decision:team || c.focusMode==='nfl'?'Assign two game tabs below, test a switch, then start Auto. Watch is temporary; Lock holds a game until you release it.':'Connect ESPN and choose your team, or select NFL RedZone mode to follow the league.';
  }
  // Avoid replacing an open stream-selection dropdown during a feed update.
  if(!document.activeElement?.matches('.assign select,.assign input')) renderGames();
  renderRoster(team);
  renderHighlights();
  renderHealth();
  if(!unchanged('activity',r.log))$('activityList').replaceChildren(...r.log.map(entry=> {
    const li=el('li');const time=el('time','',new Date(entry.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}));li.append(time,document.createTextNode(entry.text));return li;
  }));
  const issue=lastError || [r.feedError,c.focusMode==='fantasy'?r.rosterError:''].filter(Boolean).join(' ');$('notice').textContent=issue;$('notice').hidden=!issue;
}
function renderHealth() {
  const {runtime:r,config:c}=state,now=Date.now();
  const since=at=>at?`${Math.max(0,Math.floor((now-at)/1000))}s ago`:'Not measured';
  const assigned=Object.keys(r.bindings).length,live=r.games.filter(g=>g.eligible && r.bindings[g.id] && !r.bindings[g.id].unavailable);
  const heartbeat=r.engineHeartbeat && now-r.engineHeartbeat<10000;
  const sample=r.timing?.samples?.at(-1),cut=r.timing?.cuts?.at(-1),next=r.games.find(g=>g.id===r.nextGame);
  text('engineStatus',r.lab?(r.running?'Test worker':'Test stopped'):r.demo?'Simulation':!r.running?'Stopped':r.engineError?'Needs attention':heartbeat?'Running':'Waiting for worker');
  $('engineStatus').className=r.running && heartbeat?'healthy':'';
  text('cadenceValue',r.running && r.nextPollAt?`${Math.max(0,Math.ceil((r.nextPollAt-now)/1000))}s to request`:`${c.pollSeconds}s live target`);
  text('networkValue',sample?`${Math.round(sample.networkMs)} ms`:'—');
  text('cutValue',cut && (!r.demo || r.lab)?`${Math.round(cut.activationMs)} ms`:'—');
  text('nextValue',next?.name || (r.running?'Following the drive':'Start Auto'));
  let title='Ready for your Sunday',copy='Test a tab change, then Start Auto. The live worker continues when you close this desk.';
  if(r.lab){title=r.lab.complete?'Rehearsal complete':`Practice field · ${r.lab.elapsed} / 72s`;copy='Four local channels exercise real tab switching, automatic replay, and feed recovery. Exit restores your live setup.';}else if(r.demo){title='Fictional demonstration';copy='No real tabs are controlled.';}
  else if(r.reel){title='Highlight queue';copy=r.replay?'Replay playing · clips advance automatically':'Waiting for another playable published clip. Stop ends the queue.';}
  else if(c.focusMode==='fantasy' && !c.teamId){title='Choose your team or NFL RedZone';copy='Connect your ESPN roster to prioritize your players. NFL RedZone needs no league login.';}
  else if(!assigned){title='Assign your game streams';copy='Start each player in its own tab, refresh the tab list, then match the games below.';}
  else if(assigned===1){title='One stream assigned';copy='Add a second game to enable cross-game cuts. The director cannot select an unassigned stream.';}
  else if(r.replay){title='Highlight break';copy=r.replay.native?'Clips return automatically. Live roster action and scoring threats can interrupt automatic replays.':'Close the ESPN clip tab or Return to live.';}
  else if(r.lockGame){title='Game locked';copy='Resume Auto now releases this game. Watch is temporary; Lock remains until released.';}
  else if(r.feedError || r.engineError){title='Connection needs attention';copy=r.engineError || r.feedError;}
  else if(live.length<2){title=`${live.length} eligible live streams`;copy='Cross-game cuts need two assigned games in progress. Completed scoring plays are treated as between-drive breaks.';}
  else if(r.running){title=next?`${next.name} is up next`:'Auto is directing';copy=r.decision;}
  if(next && r.candidate){const remaining=Math.max(c.holdSeconds*1000-(now-r.switchedAt),2000-(now-r.candidate.since),0);copy=`Cut queued in ${Math.ceil(remaining/1000)}s if this opportunity remains best.`;}
  if(r.running && live.length && r.lastGameChangeAt && now-r.lastGameChangeAt>300000)copy+=' Game data has not changed for over five minutes. Successful requests do not prove fresh play data.';
  text('buildVersion',`LIVE ENGINE / ${state.version}`);text('readinessTitle',title);$('readinessCopy').textContent=copy;
  $('testSwitch').disabled=r.demo || assigned<2;
  text('healthSummary',`${r.running?'Auto on':'Auto off'} · ${live.length} live streams · ${r.switchCount} selections`);
  const rows=[['Worker heartbeat',since(r.engineHeartbeat)],['Scoreboard received',since(r.fetchedAt)],['Game data changed',since(r.lastGameChangeAt)],['Network round trip',sample?`${sample.networkMs} ms`:'Not measured'],['HTTP cache age',sample?.cacheAgeSeconds!=null?`${sample.cacheAgeSeconds}s`:'Not supplied'],['Candidate → last cut',cut?`${(cut.opportunityToActivationMs/1000).toFixed(1)}s (includes holds)`:'Not measured'],['Routine / urgent hold',`${c.holdSeconds}s / 2s guard`],['Field → video lag','Unknown · cannot infer from HTTP timing']];
  if(document.querySelector('.health-panel').open && !unchanged('health',rows))$('healthGrid').replaceChildren(...rows.map(([label,value])=>{const cell=el('div');cell.append(el('span','',label),el('strong','',value));return cell;}));
  text('switchProof',r.lastSwitchResult?.ok?`Chrome confirmed tab activation in ${r.lastSwitchResult.activationMs} ms · ${since(r.lastSwitchResult.at)}. This measures tab control, not video decoding or ESPN publication delay.`:r.lastSwitchResult?.error || 'Test next stream verifies real Chrome tab control after you assign two games.');
  const sources=r.highlightSources || [];
  if(document.querySelector('.health-panel').open && !unchanged('sources',[sources,Math.floor(now/60000)])){ $('highlightSources').replaceChildren(el('strong','','Highlight sources'),...sources.map(p=>el('p','subtle',`${p.name} · ${since(p.at)} · ${p.failed?p.error:`${p.clips} published clips / ${p.plays} big plays`}`)));
  if(!sources.length)$('highlightSources').append(el('p','subtle','Published clips also arrive with scoreboard updates. Find highlights checks detailed game summaries separately.'));
  }
  const best=r.games.find(g=>g.eligible);if(!r.demo && best && !r.bindings[best.id])$('readinessCopy').append(document.createTextNode(` Top opportunity ${best.name} is unassigned.`));
}
function renderGames() {
  const {runtime:r}=state, grid=$('gameGrid');
  if(unchanged('games',[r.games.map(({fetchedAt,observedAt,...g})=>g),r.bindings,r.currentGame,r.nextGame,r.demo,r.league?.teams.map(t=>t.id),state.config,gameFilter,tabs]))return;
  if(!r.league && state.config.focusMode!=='nfl') {
    const card=empty('01 / CONNECT','Your Sunday starts here.','Sign in to ESPN in Chrome, connect your league, and choose your team. Open your game streams in separate tabs and assign them here.');
    const button=el('button','primary','Connect your league ↗');button.addEventListener('click',openSettings);card.append(button);grid.replaceChildren(card);return;
  }
  const relevant=r.games.filter(g=>gameFilter==='roster'?g.players.length:gameFilter==='assigned'?r.bindings[g.id]:true);
  grid.replaceChildren();
  if(!state.config.teamId && !r.demo && state.config.focusMode!=='nfl') {grid.append(empty('02 / SELECT','Which franchise is yours?','Choose your team in the franchise box above.'));return;}
  if(!relevant.length) {grid.append(empty('NO GAMES TO DIRECT','A quiet moment.','No games match this filter. Choose All games to assign league-wide fallback streams.'));return;}
  for(const [index,g] of relevant.entries()) {
    const card=el('article',`game-card${r.currentGame===g.id?' selected':''}${g.redZone&&g.possession&&g.eligible?' redzone':''}`);
    const top=el('div','game-top');
    top.append(el('span','',`${String(index+1).padStart(2,'0')} / ${g.eligible?'LIVE':g.state==='post'?'FINAL':g.state==='in'?'BREAK':'UPCOMING'}`),el('span','',r.currentGame===g.id?'ON AIR':r.nextGame===g.id?'UP NEXT':g.redZone&&g.possession&&g.eligible?'RED ZONE':g.rosterActive?'ROSTER FOCUS':'LEAGUE WATCH'));
    const scoreboard=el('div','scoreboard');
    const away=g.teams.find(t=>t.homeAway==='away') || g.teams[0],home=g.teams.find(t=>t.homeAway==='home') || g.teams[1];
    for(const [i,t] of [away,home].entries()) {
      if(i===1) scoreboard.append(el('div','game-clock',g.detail));
      const score=el('div','team-score');score.append(document.createTextNode(t.abbreviation+' '),el('b','',t.score));
      if(g.possession===t.id) score.append(el('span','possession','●'));
      scoreboard.append(score);
    }
    const copy=el('div','game-copy');copy.append(el('p','players',g.players.map(p=>p.name).join(' · ') || 'Around the league · fallback stream'),el('p','game-reason',g.reason),el('p','last-play',[g.downDistance,g.lastPlay].filter(Boolean).join(' / ') || 'Waiting for play data.'));
    if(Number.isFinite(g.yardsToGoal)) {const field=el('div','field-position');const meter=el('meter');meter.min=0;meter.max=100;meter.value=100-g.yardsToGoal;meter.setAttribute('aria-label',`${g.yardsToGoal} yards to goal`);field.append(meter,el('span','',`${g.yardsToGoal} YD TO GOAL`));copy.append(field);}
    const assign=el('div','assign');const label=el('label','',r.lab?'LOCAL TEST CHANNEL':r.demo?'SIMULATED STREAM':'ASSIGNED STREAM TAB');
    const row=el('div','assign-row'),select=el('select');select.id=`stream-${g.id}`;label.htmlFor=select.id;
    const blank=el('option','',r.demo?'Demo channel — no video':'Choose an open stream…');blank.value='';select.append(blank);
    const binding=r.bindings[g.id];
    for(const tab of tabs) {const opt=el('option','',tab.title);opt.value=tab.id;select.append(opt);}
    if(binding&&!tabs.some(t=>t.id===binding.tabId)) {const opt=el('option','','Assigned tab — refresh to verify');opt.value=binding.tabId;select.append(opt);}
    select.value=binding?.tabId || '';select.disabled=r.demo;
    select.addEventListener('change',()=>perform('bind',{gameId:g.id,tabId:Number(select.value) || null}));
    const watch=el('button','',r.demo?'Preview':'Watch');watch.disabled=!r.demo&&!binding;watch.title=`Watch now; Auto resumes after ${state.config.holdSeconds} seconds`;
    const lock=el('button','quiet','Lock');lock.disabled=watch.disabled;lock.title='Hold this game until Resume Auto';lock.addEventListener('click',()=>perform('lock',{gameId:g.id}));
    watch.addEventListener('click',()=>perform('watch',{gameId:g.id}));row.append(select,watch,lock);assign.append(label,row);
    if(binding?.unavailable)assign.append(el('p','subtle','Player tab unloaded. Use Watch, start its playback, then resume Auto.'));
    if(binding&&!r.lab){const timing=el('details','stream-timing');timing.append(el('summary','',`Stream timing · ${binding.delaySeconds ?? state.config.delaySeconds}s offset`));const timingLabel=el('label','','Video behind ESPN (seconds)'),input=el('input');input.type='number';input.min='0';input.max='120';input.step='1';input.value=binding.delaySeconds ?? state.config.delaySeconds;timingLabel.append(input);input.addEventListener('change',()=>perform('streamTiming',{gameId:g.id,seconds:Number(input.value)}));timing.append(timingLabel,el('p','subtle','Keep 0 if cuts are late. Increase only when the feed is ahead of this video.'));assign.append(timing);}
    card.append(top,scoreboard,copy,assign);grid.append(card);
  }
}
function empty(kicker,title,text) {const n=el('div','empty');n.append(el('span','',kicker),el('h3','',title),el('p','',text));return n;}
function renderRoster(team) {
  if(unchanged('roster',[team,state.config.focusMode,state.runtime.games.map(g=>[g.id,g.state,g.teams.map(t=>[t.id,t.abbreviation])])]))return;
  const list=$('rosterList');list.replaceChildren();
  if(state.config.focusMode==='nfl'&&!state.runtime.lab){list.append(el('p','subtle','NFL RedZone mode follows scoring threats across the league. Switch to Fantasy roster first to prioritize your players.'));return;}
  if(!team){list.append(el('p','subtle','Choose your team to see your roster.'));return;}
  for(const p of [...team.players].sort((a,b)=>Number(b.starter)-Number(a.starter))) {
    const game=state.runtime.games.find(g=>g.teams.some(t=>t.id===p.teamId)), nfl=game?.teams.find(t=>t.id===p.teamId);
    const row=el('div','player'),name=el('div');name.append(el('div','player-name',p.name),el('div','player-meta',`${nfl?.abbreviation || 'NO GAME'} / ${p.starter?'STARTER':'BENCH / IR'}${p.injury?' / '+p.injury:''}`));
    row.append(el('span','position',p.position),name,el('span','player-live',game?.state==='in'?'LIVE':''));list.append(row);
  }
}
function renderHighlights() {
  const r=state.runtime,grid=$('highlightsGrid');
  if(unchanged('highlights',[r.highlights,r.replay,r.highlightsError,state.config.highlightsEnabled,highlightFilter,$('myHighlights').checked,r.demo]))return;
  $('replayBanner').hidden=!r.replay;
  $('replayTitle').textContent=r.replay?.title || '';
  const playable=r.highlights.filter(h=>h.kind==='clip' && h.url && !h.opened);
  $('nextHighlight').disabled=!playable.length;
  const items=r.highlights.filter(h=>(highlightFilter==='all' || h.kind===highlightFilter) && (!$('myHighlights').checked || h.tier==='player'));
  grid.replaceChildren();
  $('highlightsStatus').textContent=r.lab?'Offline rehearsal · original local video tests playback and automatic return.':r.demo?'Fictional preview':!state.config.highlightsEnabled?'Automatic highlight fetching is disabled in settings.':r.highlightsError || `${r.highlights.filter(h=>h.kind==='clip').length} published clips · ${r.highlights.filter(h=>h.kind==='play').length} big plays · automatic replay uses published MP4 sources; other clips retain their ESPN links.`;
  if(!items.length) {
    grid.append(el('p','highlight-empty',r.highlightsError?'The highlight feed is unavailable. Previously collected items remain available in other filters.':r.demo?'No demo items match this filter.':"No items match yet. Published clips are collected as ESPN makes them available. Big plays may arrive before video."));return;
  }
  for(const [index,h] of items.slice(0,30).entries()) {
    const card=el('article',`highlight-card ${h.kind}`),meta=el('div','highlight-meta');
    meta.append(el('span','',h.testClip?'▶ OFFLINE TEST':h.kind==='clip'?'▶ ESPN VIDEO':'≡ PLAY DESCRIPTION'),el('span','',h.playbackError?'PLAYBACK UNAVAILABLE':h.played?'PLAYED':h.opened?'OPENED':h.tier==='player'?'YOUR PLAYER':h.tier==='team'?'ROSTER GAME':'LEAGUE'));
    const title=el('h3','',h.title),description=el('p','',h.description),bottom=el('div','highlight-bottom');
    const duration=h.duration?`${Math.floor(h.duration/60)}:${String(h.duration%60).padStart(2,'0')}`:'';
    bottom.append(el('span','',`${h.gameName}${h.kind==='clip'&&duration?' / '+duration:''}${h.kind==='play'&&h.period?' / Q'+h.period+' '+h.clock:''}`));
    if(h.kind==='clip') {const button=el('button','quiet',r.lab?'Play test clip':h.mediaUrl?'Play clip ▶':'Watch on ESPN ↗');button.disabled=r.demo&&!r.lab;button.addEventListener('click',()=>perform('openHighlight',{highlightId:h.id}));bottom.append(button);}
    if(!r.demo && espnURL(h.url)){const link=el('a','source-link',h.kind==='clip'?'ESPN clip link ↗':'ESPN play-by-play ↗');link.href=espnURL(h.url);link.target='_blank';link.rel='noopener noreferrer';link.title=h.kind==='clip'?'Open on ESPN without pausing Auto':'Open this game’s play-by-play on ESPN; this is a text play, not a video clip';bottom.append(link);}
    card.append(meta,title);
    if(h.players.length)card.append(el('p','highlight-player',h.players.join(' · ')));
    card.append(description,bottom);grid.append(card);
  }
}
for(const [id,filter] of [['allGames','all'],['rosterGames','roster'],['assignedGames','assigned']]) $(id).addEventListener('click',()=>{gameFilter=filter;for(const other of ['allGames','rosterGames','assignedGames'])$(other).setAttribute('aria-pressed',String(other===id));renderGames();});
for(const [id,filter] of [['clipFilter','clip'],['playFilter','play'],['bothFilter','all']]) $(id).addEventListener('click',()=>{highlightFilter=filter;for(const other of ['clipFilter','playFilter','bothFilter'])$(other).setAttribute('aria-pressed',String(other===id));renderHighlights();});
$('myHighlights').addEventListener('change',renderHighlights);
$('playReel').addEventListener('click',()=>perform('reel'));
$('refreshHighlights').addEventListener('click',()=>perform('refreshHighlights'));
$('returnLive').addEventListener('click',()=>perform('returnLive'));
$('nextHighlight').addEventListener('click',()=>{const next=state.runtime.highlights.find(h=>h.kind==='clip' && h.url && !h.opened);if(next)perform('openHighlight',{highlightId:next.id});});
$('setupBtn').addEventListener('click',openSettings);
$('emptySetup').addEventListener('click',openSettings);
$('closeSettings').addEventListener('click',()=>$('settingsDialog').close());
$('startBtn').addEventListener('click',()=>perform('start'));
$('testSwitch').addEventListener('click',()=>perform('testSwitch'));
$('focusMode').addEventListener('change',async()=>{if(await perform('settings',{config:{focusMode:$('focusMode').value}}))await perform('poll',{force:true});});
$('stopBtn').addEventListener('click',()=>perform('stop'));
$('autoBtn').addEventListener('click',()=>perform('auto'));
$('demoBtn').addEventListener('click',()=>perform('rehearsal'));
$('advanceBtn').addEventListener('click',()=>perform('rehearsal'));
$('exitDemoBtn').addEventListener('click',()=>perform('exitRehearsal'));
$('refreshBtn').addEventListener('click',async()=> {
  try{tabs=await message('tabs');await perform('poll',{force:true});}catch(e){notice(e.message);}
});
$('teamSelect').addEventListener('change',()=>perform('settings',{config:{...state.config,teamId:$('teamSelect').value}}));
$('connectBtn').addEventListener('click',async()=> {
  $('connectStatus').textContent='Connecting to ESPN…';$('connectBtn').disabled=true;
  const auth={swid:$('swid').value.trim(),s2:$('s2').value.trim()};
  $('swid').value='';$('s2').value='';
  const ok=await perform('connect',{config:settings(),auth});
  auth.swid='';auth.s2='';$('connectBtn').disabled=false;
  $('connectStatus').textContent=ok?'Connected. Close settings and choose your team.':lastError;
});
$('settingsForm').addEventListener('submit',async e=> {e.preventDefault();if(await perform('settings',{config:settings()}))$('settingsDialog').close();});
$('forgetBtn').addEventListener('click',async()=> {if(await perform('forget',{}, {fill:true})) {$('connectStatus').textContent='Local league data cleared. ESPN browser cookies are unchanged.';$('swid').value='';$('s2').value='';}});
async function init() {
  try {state=await message('state');if(state.version!=='3.1.0')throw new Error('Extension files changed. Reload Fantasy Director at chrome://extensions, then close and reopen this desk.');tabs=await message('tabs');fillSettings();render();if(!state.runtime.demo && !state.runtime.running)void perform('poll');}
  catch(e){state=null;notice(e.message);for(const button of document.querySelectorAll('button'))button.disabled=true;}
}
await init();
setInterval(()=>{if(state&&!document.hidden)renderHealth();},1000);
setInterval(async()=> {
  if(!state || !state.runtime.running || busy || document.hidden || $('settingsDialog').open || document.activeElement?.matches('.assign select,.assign input'))return;
  busy=true;
  try {state=await message('state');notice();render();}catch(e){notice(e.message);}finally{busy=false;}
},60000);
// Feed refreshes can switch focus away from this page. State refresh on return
// reflects background decisions without making another network request.
document.addEventListener('visibilitychange',async()=> {if(state&&!document.hidden&&!busy){try {state=await message('state');render();}catch(e){notice(e.message);}}});

let refreshTimer;
chrome.runtime.onMessage.addListener(message=>{
  if(message.target!=='desk' || document.hidden)return;
  clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{if(busy)return;try{state=await messageState();render();}catch(e){notice(e.message);}},100);
});
async function messageState(){return message('state');}
$('exportTiming').addEventListener('click',async()=>{
  try{const report=await message('report'),blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download='Fantasy-Director-timing.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){notice(e.message);}
});

document.querySelector('.health-panel').addEventListener('toggle',()=>{if(state)renderHealth();});
