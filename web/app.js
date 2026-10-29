import {ReplayArchive,ReplayClock,timeLabel,mediaTime,addSyncMark,wallTime,forecastGames,observedPlay} from './replay-engine.js';
import {MediaDeck} from './media-deck.js';
import {SourceCatalog,chooseSource} from './sources.js';
import {NFLSourceCatalog,rankNFLClips} from './nfl-sources.js';
import {normalizeScoreboard} from './adapters.js';
import {normalizeHighlights,playable} from './highlights.js';
import {StreamDirector,rankGames,involved,rosterForGame,alias,parseRoster,safeVideo,gameKey} from './director.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const SAMPLE=[{name:'A.J. Brown',team:'PHI',position:'WR'},{name:'Jonathan Taylor',team:'IND',position:'RB'}];
let saved={roster:SAMPLE,teamName:'Sample roster',teamId:'',leagueId:'',streams:{},recordings:{},leagueCache:null,muted:true,rosterOnly:false};
try{
 const old=JSON.parse(localStorage.getItem('fd-simple-v2')||'null');
 if(old&&Array.isArray(old.roster)){saved={...saved,...old};saved.roster=parseRoster(old.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n'));saved.recordings=old.recordings||{};}
}catch{}
const state={mode:'replay',picture:'native',archive:null,session:0,games:[],selected:null,displayed:null,auto:true,started:false,league:saved.leagueCache,loadingLeague:false,side:'games',generation:0,lastFeed:0,feedError:'',clip:null,manualClip:false,clips:[],stories:[],played:new Set(),quietAt:null,lastClip:-Infinity,changedAt:0,switches:0,externalId:null,noticeTimer:null,lastRender:0,lastWarm:0,lastDecision:0,forceSeek:false,intentRunning:false,clockWait:false,seekVersion:0,requestTag:null,retryAt:0,pendingClip:null,highlightGeneration:0,returningTitle:null,quality:'auto',scrubbing:false,gamesMarkup:'',playbackFailure:null,loadAttempt:0,loadWatchdog:null};
const clock=new ReplayClock();
const director=new StreamDirector();
let feedTimer,clipTimer,feedController,clipController,seekTimer,highlightTimer;
const sources=new SourceCatalog({onUpdate:()=>{if(state.archive)renderGames();}});
const nflSources=new NFLSourceCatalog();
const healthReports=new Set();
function reportPlayback(event,game,code='READY'){
 const key=[event,game,code].join(':');if(healthReports.has(key)||healthReports.size>=20)return;healthReports.add(key);
 const slot=deck.slots.get(game),video=slot?.video;
 const report={event,game,code,phase:slot?.failure?.phase||slot?.phase||'source',imported:sources.records.size,readyState:video?.readyState||0,networkState:video?.networkState||0,providerInitialized:video?.initialized===true,providerProgress:video?.progress||0};
 try{Promise.resolve(globalThis.fetch('/api/playback-health',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(report),keepalive:true})).catch(()=>{});}catch{}
}
function persist(){try{localStorage.setItem('fd-simple-v2',JSON.stringify(saved));}catch{notice('Browser storage is unavailable. Your changes work for this visit.');}}
function notice(message){$('roomNotice').textContent=message;$('roomNotice').hidden=false;clearTimeout(state.noticeTimer);state.noticeTimer=setTimeout(()=>$('roomNotice').hidden=true,6000);}
function status(message){if(state.playbackFailure)message=state.playbackFailure.message;$('playbackStatus').textContent=message;if(state.started&&!deck.active&&!state.playbackFailure)$('splashDetail').textContent=message;}
const deck=new MediaDeck($('mediaDeck'),{onCommit:key=>{
 $('playerSplash').hidden=true;
 if(key.startsWith('clip:'))return;
 if(state.mode==='replay')reportPlayback('ready',key);
 if(state.displayed!==key){state.switches++;director.commit(performance.now());}state.displayed=key;state.returningTitle=null;
 if(state.clockWait){state.clockWait=false;clock.setRunning(state.intentRunning,performance.now());deck.setRunning(state.intentRunning);}
 renderNow();
},onRecover:key=>{if(state.playbackFailure?.id===key){state.playbackFailure=null;state.requestTag=null;state.retryAt=0;state.intentRunning=true;state.clockWait=true;deck.retry();deck.setRunning(true);showPicture();}},onStatus:status,onEnd:key=>{if(key.startsWith('clip:')){if(state.pendingClip){deck.activeSlot?.video.pause();return;}finishHighlight();}else if(state.mode==='replay'){const game=state.archive.games.find(g=>g.id===key);if(game){clock.seek(Math.min(clock.end,game.end+1),performance.now());state.games=state.archive.sample(clock.at);if(clock.at>=clock.end){setRunning(false);status('Replay day complete. Choose another day or seek back.');}else{state.requestTag=null;direct(true);}}}},onStall:()=>{
 if(!state.auto)return;
 const ranked=rankGames(state.games,saved.roster,directorOptions()),priority=ranked.some(x=>x.players.length)?ranked.filter(x=>x.players.length):ranked;
 const alternative=priority.find(({game})=>game.id!==deck.active&&deck.ready(game.id,targetFor(game)));
 if(alternative){cancelSelection();state.selected=alternative.game.id;showPicture();}else status('The current source slowed down. Keeping the picture while the next roster game prepares.');
},onBreak:(key,ad)=>{
 if(!deck.active&&key===state.selected){status(ad?'Provider ad · the replay will start after this break.':'Ad finished · preparing the replay.');return;}
 if(!ad||key!==deck.active||!state.auto)return;
 status('Provider ad break · looking for ready football.');direct(true);
 if(state.selected===key){const clip=automaticClips()[0];if(clip&&!state.pendingClip&&!state.clip)playHighlight(clip,false);}
}});
function directorOptions(){return {rosterOnly:saved.rosterOnly,excluded:new Set([...deck.slots.values()].filter(s=>s.video.inAd||s.failed).map(s=>s.key))};}
function automaticClips(){return rankNFLClips(state.clips,saved.roster,state.played).filter(c=>c.kind==='nfl'&&c.short&&c.teams?.some(team=>saved.roster.some(p=>alias(p.team)===alias(team))));}
function cancelSelection(){deck.cancelRequest();clearTimeout(state.loadWatchdog);state.loadAttempt++;state.requestTag=null;state.retryAt=0;state.playbackFailure=null;}
function activeGame(){return state.games.find(g=>g.id===state.selected);}
function displayedGame(){return state.games.find(g=>g.id===state.displayed)||activeGame();}
function showSide(name){state.side=name;for(const n of ['games','roster','clips']){$(n+'Panel').hidden=n!==name;$(n+'Tab').setAttribute('aria-selected',String(n===name));}if(name==='clips')renderClips();}
for(const name of ['games','roster','clips']){
 $(name+'Tab').onclick=()=>showSide(name);
 $(name+'Tab').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=['games','roster','clips'];const next=tabs[(tabs.indexOf(name)+(e.key==='ArrowRight'?1:2))%3];showSide(next);$(next+'Tab').focus();};
}
function franchiseOptions(){
 const teams=state.league?.teams||[];
 $('franchiseSelect').innerHTML=teams.length?(!saved.teamId?`<option value="">${esc(saved.teamName)}</option>`:'')+teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''):`<option value="">${esc(saved.teamName)}</option>`;
 $('franchiseSelect').value=saved.teamId||'';
}
function selectFranchise(team,{announce=true}={}){
 const changed=saved.teamId!==team.id||JSON.stringify(saved.roster)!==JSON.stringify(team.players);
 saved={...saved,roster:team.players,teamName:team.name,teamId:team.id,leagueId:state.league.leagueId,season:state.league.season,rosterWeek:state.league.week,syncedAt:Date.now(),leagueCache:state.league};
 persist();$('franchiseSelect').value=team.id;$('connectBar').hidden=true;state.played.clear();state.quietAt=null;
 if(changed){cancelSelection();state.seekVersion++;director.reset();state.auto=true;}
 if(!state.manualClip)finishHighlight();direct(true);render();if(announce)notice(`${team.name} · ${team.players.length} starters selected.`);
}
$('franchiseSelect').onchange=e=>{const team=state.league?.teams.find(t=>t.id===e.target.value);if(team)selectFranchise(team);};
$('connectionButton').onclick=()=>{$('connectBar').hidden=!$('connectBar').hidden;if(!$('connectBar').hidden)$('leagueId').focus();};
$('leagueId').value=saved.leagueId;$('connectBar').hidden=!!saved.teamId;
async function importLeague({refresh=false,announce=true}={}){
 if(state.loadingLeague)return;const leagueId=(refresh?saved.leagueId:$('leagueId').value).trim();
 if(!/^\d{1,12}$/.test(leagueId)){$('importStatus').textContent='Enter your numeric ESPN league ID.';return;}
 state.loadingLeague=true;$('leagueForm').setAttribute('aria-busy','true');$('importStatus').classList.remove('error');$('importButton').disabled=true;$('refreshRoster').disabled=true;$('importButton').textContent='Importing…';$('importStatus').textContent='Getting every franchise from ESPN…';
 const generation=state.generation;
 try{
  const week=state.mode==='replay'?7:undefined;
  const response=await fetch('/api/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId,week}),signal:AbortSignal.timeout(15000)});
  if(!response.headers.get('Content-Type')?.includes('application/json'))throw new Error('Reload this page to refresh your signed-in session.');
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not import this league.');
  if(generation!==state.generation)return;
  state.league=data;const selected=data.teams.find(t=>t.id===(leagueId===saved.leagueId?saved.teamId:null))||data.teams.find(t=>t.id===data.ownedTeamId)||data.teams[0];
  franchiseOptions();selectFranchise(selected,{announce});$('leagueId').value=data.leagueId;$('importStatus').textContent=`${data.teams.length} franchises available.`;
 }catch(error){if(generation!==state.generation)return;$('connectBar').hidden=false;$('importStatus').classList.add('error');$('importStatus').textContent=error.name==='TimeoutError'?'ESPN took too long. Your saved roster is still available.':error.message;}
 finally{state.loadingLeague=false;$('leagueForm').setAttribute('aria-busy','false');$('importButton').disabled=false;$('refreshRoster').disabled=false;$('importButton').textContent='Import league';if(generation!==state.generation&&saved.leagueId)queueMicrotask(()=>importLeague({refresh:true,announce:false}));}
}
$('leagueForm').onsubmit=e=>{e.preventDefault();importLeague();};$('refreshRoster').onclick=()=>importLeague({refresh:true});
async function restoreConnection(){
 try{const response=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)return;const session=await response.json();if(saved.leagueId)await importLeague({refresh:true,announce:false});else if(session.savedLeagueId&&!$('leagueId').value){$('leagueId').value=session.savedLeagueId;await importLeague({announce:false});}}catch{}
}
function session(){return state.archive?.sessions[state.session];}
function setSession(index,{seek=true}={}){
 state.session=index;const s=session();if(!s)return;$('sessionSelect').value=String(index);clock.end=s.end;$('timeline').min=s.start;$('timeline').max=s.end;$('timelineEnd').textContent=timeLabel(s.end)+' ET';if(seek)seekAll(s.start);
}
function setRunning(running){
 if(running){state.playbackFailure=null;state.requestTag=null;}state.started=state.started||running;state.intentRunning=running;deck.retry();state.retryAt=0;
 if(!running){clock.setRunning(false,performance.now());deck.setRunning(false);state.clockWait=false;}
 else if(state.picture==='signal'||state.mode==='live'){clock.setRunning(state.mode==='replay',performance.now());deck.setRunning(true);}
 else if(deck.active===state.selected&&deck.ready(state.selected,targetFor(activeGame()))){clock.setRunning(true,performance.now());deck.setRunning(true);}
 else{state.clockWait=true;clock.setRunning(false,performance.now());deck.setRunning(true);state.requestTag=null;}
 direct();render();
}
function seekAll(at){
 state.playbackFailure=null;
 director.reset();
 const day=session();if(!day)return;finishHighlight({restore:false});state.seekVersion++;state.requestTag=null;state.retryAt=0;deck.cancelPending();deck.retry();
 state.returningTitle=null;state.forceSeek=true;clock.setRunning(false,performance.now());deck.setRunning(false);state.clockWait=state.intentRunning;
 clock.seek(Math.max(day.start,Math.min(day.end,at)),performance.now());state.played.clear();state.quietAt=null;state.lastClip=-Infinity;state.games=state.archive.sample(clock.at);
 if(state.picture==='signal')clock.setRunning(state.intentRunning,performance.now());direct(true);render();
}
$('sessionSelect').onchange=e=>setSession(Number(e.target.value));
$('timeline').oninput=e=>{state.scrubbing=true;$('timelineTime').textContent=timeLabel(Number(e.target.value))+' ET';};
$('timeline').onchange=e=>{state.scrubbing=false;seekAll(Number(e.target.value));};
$('playButton').onclick=()=>setRunning(!state.intentRunning);
$('skipBack').onclick=()=>seekAll(clock.at-30);
$('skipForward').onclick=()=>{const game=displayedGame();seekAll(game&&deck.active===game.id&&deck.currentTime!==null?wallTime(game,deck.currentTime+30,configFor(game)):clock.at+30);};
$('restartTest').onclick=()=>seekAll(session().start);
$('nextSwitch').onclick=()=>{state.auto=true;$('autoDirector').checked=true;state.started=true;seekAll(state.archive.nextSwitch(clock.at,saved.roster,state.selected,session().end,directorOptions()));};
$('playbackRate').onchange=e=>{if(state.picture==='native'&&state.mode==='replay'&&!videoFor(activeGame())){e.target.value='1';clock.rate=1;deck.setRate(1);notice('Full-game provider replays run at 1×. Data-only tests support faster speeds.');return;}clock.tick(performance.now());clock.rate=Number(e.target.value);if(state.picture==='native'&&clock.rate>4){clock.rate=4;e.target.value='4';notice('Synced recordings support up to 4×. Timeline tests support 60×.');}deck.setRate(clock.rate);};
$('muteButton').onclick=()=>{saved.muted=!saved.muted;deck.setMuted(saved.muted);persist();renderNow();};
function configFor(game){
 const config=saved.recordings[game.id]||{},slot=deck.slots.get(game.id);
 const duration=config.url?(Number.isFinite(slot?.video.duration)?slot.video.duration:0):sources.records.get(game.id)?.duration||0;
 return {...config,duration};
}
function videoFor(game){return state.mode==='replay'?(saved.recordings[game.id]?.url||''):saved.streams[gameKey(game)];}
function targetFor(game){return state.mode==='replay'?mediaTime(game,clock.at,configFor(game)):deck.slots.get(game.id)?.video.currentTime||0;}
async function resolveVideo(game){
 const custom=videoFor(game);if(custom)return {url:custom,type:/\.m3u8(?:\?|$)/i.test(custom)?'application/vnd.apple.mpegurl':'video/mp4'};
 if(state.mode==='live')throw new Error('Add your live source in Sources & sync.');
 const record=await sources.resolve(game);return {...chooseSource(record,state.quality),duration:record.duration};
}
function stopExternal(){if($('externalFrame').hasAttribute('src'))$('externalFrame').removeAttribute('src');$('externalFrame').hidden=true;state.externalId=null;}
function changePicture(picture){
 state.playbackFailure=null;
 finishHighlight({restore:false});deck.destroy();stopExternal();state.picture=picture;state.displayed=null;state.requestTag=null;state.retryAt=0;
 if(picture==='native'&&clock.rate>4){clock.rate=1;$('playbackRate').value='1';}deck.setRate(clock.rate);deck.setMuted(saved.muted);
 if(picture==='external'){state.auto=false;$('autoDirector').checked=false;setRunning(false);}
 else if(state.intentRunning)setRunning(true);
 showPicture();render();
}
$('pictureMode').onchange=e=>changePicture(e.target.value);
function failPlayback(game,tag,attempt,message,code='SOURCE'){
 if(state.requestTag!==tag||state.loadAttempt!==attempt)return;
 if(state.mode==='replay')reportPlayback('failed',game.id,code);
 clearTimeout(state.loadWatchdog);state.loadAttempt++;deck.cancelPending();
 state.playbackFailure={id:game.id,code,message:message+' ['+code+']'};state.clockWait=false;
 if(!deck.active){state.intentRunning=false;clock.setRunning(false,performance.now());deck.setRunning(false);}
 status(state.playbackFailure.message);showPicture();renderNow();renderGames();
}
function showPicture(){
 if(state.rosterIdle&&!state.clip){$('playerSplash').hidden=false;$('splashTitle').textContent='Your roster is between games';$('splashDetail').textContent='Choose another replay day or enable RedZone fallback to watch other teams.';$('splashPlay').hidden=true;return;}
 const game=activeGame();if(!game||state.clip)return;
 const picture=state.mode==='live'?'native':state.picture;
 $('signal').hidden=picture!=='signal';$('mediaDeck').hidden=picture!=='native';$('externalFrame').hidden=picture!=='external';$('playerSplash').hidden=picture!=='native'||!!deck.active||deck.slots.get(game.id)?.video.kind==='provider';
 if(picture==='signal'){state.displayed=game.id;status(`Recorded feed · 14 games · ${state.switches} switches`);return;}
 if(picture==='external'){
  if(state.externalId!==game.id){$('externalFrame').src=game.embed;state.externalId=game.id;state.displayed=game.id;}
  status('Original provider player · use Replay video for shared controls');return;
 }
 if(state.playbackFailure?.id===game.id){if(!deck.active){$('splashTitle').textContent='Couldn’t start this replay';$('splashDetail').textContent=state.playbackFailure.message;$('splashPlay').hidden=false;$('splashPlay').textContent='Retry replay';}return;}
 $('splashPlay').textContent='Play replay';$('splashPlay').hidden=state.started;
 if(!state.started){$('splashTitle').textContent='Your roster. One feed.';$('splashDetail').textContent='All 14 games are importing. Press Play to prepare the first replay.';return;}
 const tag=[state.generation,state.seekVersion,game.id,state.quality].join(':');
 if(state.requestTag===tag||performance.now()<state.retryAt)return;
 if(!state.forceSeek&&state.mode==='replay'&&!clock.running&&!state.clockWait&&deck.active===game.id)return;
 const force=state.forceSeek;state.forceSeek=false;state.requestTag=tag;const attempt=++state.loadAttempt;clearTimeout(state.loadWatchdog);state.loadWatchdog=setTimeout(()=>failPlayback(game,tag,attempt,'The recording did not start within 95 seconds. Retry or choose another game.','START_TIMEOUT'),95000);
 if(!deck.active){$('splashTitle').textContent='Preparing your replay';$('splashDetail').textContent='Opening the recording before the test clock starts.';}
 (async()=>{
  try{
   const source=await resolveVideo(game);if(source.type==='provider/ok'&&clock.rate!==1){clock.rate=1;deck.setRate(1);$('playbackRate').value='1';}if(state.requestTag!==tag||state.loadAttempt!==attempt||state.clip||state.selected!==game.id)return;
   if(source.type==='provider/ok')$('playerSplash').hidden=true;
   const ready=await deck.request(game.id,source.url,()=>targetFor(game),{force,type:source.type,duration:source.duration,isCurrent:()=>state.requestTag===tag&&state.loadAttempt===attempt&&!state.clip&&state.selected===game.id});
   if(state.requestTag!==tag||state.loadAttempt!==attempt)return;
   if(!ready&&!deck.gate.pending){const failed=deck.slots.get(game.id);if(failed?.failed&&state.mode==='replay'&&!videoFor(game))sources.invalidate(game.id);const code=failed?.failure?.code||'NOT_READY';failPlayback(game,tag,attempt,failed?.video.kind==='provider'?(failed.video.error?.message||'The provider has not confirmed playback yet. Press Play inside the video; the shared clock will start when footage is playing.'):code==='AUTOPLAY'?'Your browser blocked playback. Press Retry replay.':'The recording did not produce a ready picture. Retry or choose another game.',code);}
   else if(ready&&state.clockWait){state.clockWait=false;clock.setRunning(state.intentRunning,performance.now());deck.setRunning(state.intentRunning);}
  }catch(error){failPlayback(game,tag,attempt,error.message,error.code||'SOURCE');}
  finally{if(state.loadAttempt===attempt)clearTimeout(state.loadWatchdog);}
 })();
}
function direct(force=false){
 const options=directorOptions();
 state.rosterIdle=state.auto&&saved.rosterOnly&&!state.games.some(g=>g.state==='in'&&rosterForGame(g,saved.roster).length);
 if(state.rosterIdle&&!state.clip){deck.activeSlot?.video.pause();state.clockWait=false;if(state.mode==='replay')clock.setRunning(state.intentRunning,performance.now());}
 if(state.auto&&!state.pendingClip?.manual&&!state.manualClip&&(state.mode==='live'||state.intentRunning||!state.started||force)&&(state.mode==='replay'||Date.now()-state.lastFeed<20000)){
  const currentId=deck.active&&!deck.active.startsWith('clip:')?deck.active:state.selected;
  const pick=director.choose(state.games,saved.roster,{...options,currentId,now:performance.now(),force});
  if(pick&&pick.game.id!==state.selected){cancelSelection();state.selected=pick.game.id;state.changedAt=performance.now();if(state.picture==='signal'){state.switches++;director.commit(performance.now());}}
 }
 if(!activeGame())state.selected=rankGames(state.games,saved.roster,options)[0]?.game.id||(saved.rosterOnly?state.games.find(g=>rosterForGame(g,saved.roster).length)?.id:state.games[0]?.id);
 const pick=rankGames(state.games,saved.roster,options)[0];
 if(pick?.urgent){state.quietAt=null;if(state.pendingClip&&!state.pendingClip.manual){state.highlightGeneration++;state.pendingClip=null;}if(state.clip&&!state.manualClip)finishHighlight();}else if(state.quietAt===null)state.quietAt=performance.now();
 if(state.auto&&state.started&&(state.mode==='live'||clock.running)&&!document.hidden&&(state.mode==='live'||clock.rate<=4)&&$('autoClips').checked&&!state.clip&&!state.pendingClip&&state.quietAt!==null&&performance.now()-state.quietAt>5000&&performance.now()-state.lastClip>45000){
  const clip=automaticClips()[0];
  if(clip)playHighlight(clip,false);
 }
 if(!state.clip&&!state.pendingClip)showPicture();
 if(force)state.lastWarm=0;
}
$('autoDirector').onchange=e=>{
 if(state.picture==='external'&&state.mode==='replay'&&e.target.checked){e.target.checked=false;notice('Choose Timeline test or Synced recordings for automatic cuts. External embeds cannot confirm video readiness.');return;}
 state.auto=e.target.checked;direct(true);render();
};
$('focusSelect').value=saved.rosterOnly?'roster':'redzone';
$('focusSelect').onchange=e=>{saved.rosterOnly=e.target.value==='roster';persist();state.auto=true;director.reset();cancelSelection();direct(true);render();};
$('gameList').onclick=e=>{
 const b=e.target.closest('[data-game]');if(!b)return;const game=state.games.find(g=>g.id===b.dataset.game);if(!game)return;
 cancelSelection();state.rosterIdle=false;state.auto=false;state.started=true;finishHighlight({restore:false});state.selected=game.id;state.requestTag=null;state.retryAt=0;
 if(state.mode==='replay'&&(clock.at<game.start||clock.at>game.end)){
  const index=state.archive.sessions.findIndex(s=>s.gameIds.includes(game.id));setSession(index,{seek:false});seekAll(game.start);return;
 }
 showPicture();render();
};
function renderSignal(){
 const game=displayedGame();if(!game)return;
 const offense=game.teams.find(t=>t.id===game.possession);
 $('signalClock').textContent=state.mode==='replay'?timeLabel(clock.at)+' ET':game.detail;
 $('signalScore').innerHTML=`<div class="score-team"><b>${esc(game.teams[0].abbreviation)}</b><strong>${esc(game.teams[0].score||0)}</strong></div><div class="score-mid">${esc(game.detail)}<br>${esc(game.downDistance||'')}</div><div class="score-team"><strong>${esc(game.teams[1].score||0)}</strong><b>${esc(game.teams[1].abbreviation)}</b></div>`;
 $('awayAbbr').textContent=game.teams[0].abbreviation;$('homeAbbr').textContent=game.teams[1].abbreviation;
 const yards=Number.isFinite(game.yardsToGoal)?game.yardsToGoal:50;
 $('ballMarker').style.left=(offense?.id===game.teams[0].id?100-yards:yards)+'%';
 $('signalPlay').textContent=game.state!=='in'?game.detail:game.phase==='between-drives'?'Break in the action':`${offense?.abbreviation||'Unknown possession'} · ${game.yardsToGoal??'—'} yards to the end zone`;
 $('signalDetail').textContent=state.mode==='replay'?`${game.playType||'Recorded play'} · Timeline test, not game footage.`:'Live data · connect a video source to watch.';
}
function renderNow(){
 const game=displayedGame(),roster=game?involved(game,saved.roster):[];
 $('gameTitle').textContent=state.clip?state.clip.title:state.rosterIdle?'Your roster is between games':state.returningTitle?state.returningTitle:game?.name||'Last week. Any time.';
 $('modeCaption').textContent=state.clip?'OFFICIAL HIGHLIGHT':state.mode==='replay'?'WEEK 7 REPLAY LAB':'LIVE STREAM';
 $('reason').textContent=state.clip?(state.manualClip?'Official NFL highlight · returns to your game when finished.':'Your roster’s highlights · returns when priority action resumes.'):state.rosterIdle?'Only your roster’s games are enabled. Choose another day or turn on RedZone fallback.':!game?'Loading the NFL slate…':!state.auto?'Pinned to this game.':roster.length?`${roster.map(p=>p.name+(p.position==='D/ST'?' (defense)':p.position==='K'?' (kicker)':'')).join(', ')} · roster priority`:saved.rosterOnly?'Your roster’s matchup · waiting for their next possession.':rosterForGame(game,saved.roster).length?'Your roster’s matchup · holding through a short pause.':'RedZone fallback · no roster possession currently available.';
 $('autoDirector').checked=state.auto;$('playButton').textContent=state.intentRunning?'Pause':'Play replay';$('muteButton').textContent=saved.muted?'Unmute':'Mute';$('muteButton').setAttribute('aria-pressed',String(saved.muted));
 $('alignVideo').hidden=state.mode!=='replay'||!deck.active||!!state.clip;$('returnGame').hidden=!state.clip;$('sourceLink').hidden=state.mode!=='replay'||!game;if(game?.page)$('sourceLink').href=game.page;$('returnGame').hidden=!state.clip;$('prepStatus').textContent=preparationLabel();
 if(!state.scrubbing){$('timeline').value=String(clock.at);$('timelineTime').textContent=state.archive?timeLabel(clock.at)+' ET':'—';}
 $('playbackNote').textContent=state.mode==='live'?'Feed timing follows ESPN. The next picture is prepared before each cut.':state.picture==='external'?'This is the original provider player. Choose Replay video to use the shared seek bar and buffered switching.':state.picture==='native'?(game&&configFor(game).marks?.length?'Video follows your saved sync points. The current picture stays until the next frame is ready.':'Shared seek controls drive the original replay players. Cuts wait for confirmed playback; the provider does not report buffered seconds. Play alignment is estimated until you save sync points.'):'Recorded play-by-play only. Choose Replay video to test the footage.';
 renderSignal();
}
function renderGames(){
 $('gameCount').textContent=state.games.length;$('gamesHeading').textContent=state.mode==='replay'?'All of Week 7':'NFL games';$('feedStatus').textContent=state.mode==='replay'?'Recorded':state.feedError?'Feed unavailable':'ESPN';
 const markup=state.games.map(g=>{
 const playing=g.id===state.displayed,selected=g.id===state.selected;
 const label=deck.slots.get(g.id)?.video.inAd?'Provider ad':playing?'Watching':selected?(state.playbackFailure?.id===g.id?'Playback unavailable':state.started?'Preparing':'Selected'):g.state==='in'?(involved(g,saved.roster).length?'Your roster in action':rosterForGame(g,saved.roster).length?'Your matchup':g.redZone?'Red zone':'In progress'):g.state==='post'?'Final':'Later';
 return `<button class="game" data-game="${esc(g.id)}" aria-pressed="${playing}"><span class="game-row"><strong>${esc(g.name)}</strong><small>${g.teams.map(t=>esc(t.score||0)).join('–')}</small></span><span class="game-meta">${esc(g.detail)}</span><span class="game-state">${label}${state.mode==='replay'?' · '+(saved.recordings[g.id]?.url?'Custom source':sources.status(g.id)):''}</span></button>`;
 }).join('')||'<p class="empty-list">No games available. Replay lab works any day.</p>';if(markup!==state.gamesMarkup){state.gamesMarkup=markup;$('gameList').innerHTML=markup;}
}
function renderRoster(){
 const players=displayedGame()?involved(displayedGame(),saved.roster):[];$('teamName').textContent=saved.teamName;$('refreshRoster').hidden=!saved.leagueId;
 $('rosterNote').textContent=saved.teamId?`${saved.roster.length} starters · League ${saved.leagueId} · ESPN week ${saved.rosterWeek||'—'}`:'Choose a league franchise above, or edit the sample in Sources & sync.';
 $('rosterList').innerHTML=saved.roster.map(p=>`<div class="roster-item ${players.some(x=>x.name===p.name)?'active':''}"><span class="position">${esc(p.position)}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.team)}</small></div></div>`).join('')||'<p class="empty-list">No starters. The director follows the closest scoring threat.</p>';
}
function renderClips(){
 $('clipList').innerHTML=rankNFLClips(state.clips,saved.roster).map(c=>`<div class="clip"><button data-clip="${esc(c.id)}">▶ ${esc(c.title)}</button><small>${c.kind==='nfl'?'NFL.com · integrated video':'ESPN · direct video'}${state.played.has(c.id)?' · Played':''}</small><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Original highlight ↗</a></div>`).join('')||'<p class="empty-list">No published clips are available yet.</p>';
}
function render(){
 $('replayMode').setAttribute('aria-pressed',String(state.mode==='replay'));$('liveMode').setAttribute('aria-pressed',String(state.mode==='live'));$('transport').hidden=state.mode!=='replay';renderNow();renderGames();renderRoster();
}
async function playHighlight(clip,manual=true){
 const generation=++state.highlightGeneration;clearTimeout(highlightTimer);state.pendingClip={clip,manual};
 try{
  const source=clip.kind==='nfl'?await nflSources.resolve(clip):{url:clip.mediaUrl,type:'video/mp4',duration:clip.duration};
  if(generation!==state.highlightGeneration)return;
  if(!manual&&source.duration>45){state.played.add(clip.id);state.pendingClip=null;return;}
  const prepared=await deck.warm('clip:'+clip.id,source.url,0,{type:source.type,hold:true});
  if(!prepared||generation!==state.highlightGeneration){if(generation===state.highlightGeneration)state.pendingClip=null;return;}
  deck.setRunning(true);const ready=await deck.request('clip:'+clip.id,source.url,0,{type:source.type,isCurrent:()=>generation===state.highlightGeneration});
  if(generation!==state.highlightGeneration)return;
  if(!ready){state.pendingClip=null;finishHighlight();return;}
  state.clip=clip;state.manualClip=manual;state.pendingClip=null;stopExternal();$('signal').hidden=true;$('mediaDeck').hidden=false;$('playerSplash').hidden=true;
  state.played.add(clip.id);state.lastClip=performance.now();clearTimeout(highlightTimer);highlightTimer=setTimeout(()=>finishHighlight(),Math.min(120,source.duration||120)*1000+1000);renderNow();renderClips();
 }catch{if(generation===state.highlightGeneration){state.pendingClip=null;state.played.add(clip.id);if(state.clip)finishHighlight();status('This highlight is unavailable. Staying with the game.');}}
}
function finishHighlight({restore=true}={}){
 state.highlightGeneration++;state.pendingClip=null;clearTimeout(highlightTimer);
 if(!state.clip)return;state.returningTitle='Returning to the game…';state.clip=null;state.manualClip=false;state.requestTag=null;state.retryAt=0;deck.running=state.mode==='live'||state.intentRunning;if(deck.activeSlot){deck.activeSlot.video.pause();deck.activeSlot.video.muted=true;}if(state.picture==='signal'||state.picture==='external')deck.suspend();else deck.gate.cancel();
 if(restore){showPicture();renderNow();}
}
$('returnGame').onclick=()=>finishHighlight();$('autoClips').onchange=e=>{if(!e.target.checked&&state.clip&&!state.manualClip)finishHighlight();};
$('clipList').onclick=e=>{const b=e.target.closest('[data-clip]');if(b){const clip=state.clips.find(c=>c.id===b.dataset.clip);if(clip)playHighlight(clip);}};
async function espn(path,signal){const response=await fetch(BASE+path,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});if(!response.ok)throw new Error('ESPN unavailable');return response.json();}
async function livePoll(generation){
 if(generation!==state.generation||state.mode!=='live')return;feedController=new AbortController();const timeout=setTimeout(()=>feedController.abort(),8000);
 try{const games=normalizeScoreboard(await espn('scoreboard',feedController.signal));if(generation!==state.generation)return;state.games=games;state.lastFeed=Date.now();state.feedError='';direct();warmLive();render();}catch{if(generation===state.generation){state.feedError='Unavailable';$('feedStatus').textContent='Feed unavailable · auto held';}}
 finally{clearTimeout(timeout);if(generation===state.generation)feedTimer=setTimeout(()=>livePoll(generation),!document.hidden&&state.games.some(g=>g.state==='in')?5000:30000);}
}
async function warmLive(){
 if(state.mode!=='live'||!state.started)return;
 const candidates=rankGames(state.games,saved.roster,directorOptions()).filter(x=>x.game.id!==deck.active).slice(0,1);
 for(const {game} of candidates){const url=videoFor(game);if(url)deck.warm(game.id,url,()=>deck.slots.get(game.id)?.video.currentTime||0,{type:/\.m3u8(?:\?|$)/i.test(url)?'application/vnd.apple.mpegurl':'video/mp4'});}
}
async function liveClips(generation){
 if(generation!==state.generation||state.mode!=='live')return;clipController=new AbortController();const timeout=setTimeout(()=>clipController.abort(),15000);
 const merge=clips=>{if(generation===state.generation)state.clips=[...new Map([...state.clips,...clips].map(c=>[c.id,c])).values()].slice(-60);};
 try{
  const jobs=rankGames(state.games,saved.roster).slice(0,2).map(async({game})=>{const data=await espn('summary?event='+game.id,clipController.signal);merge(normalizeHighlights(data,game).filter(c=>c.kind==='clip'&&playable(c)));});
  if(!state.lastNFL||Date.now()-state.lastNFL>300000)jobs.push((async()=>{const response=await fetch('/api/nfl-highlights',{signal:clipController.signal,cache:'no-store'});if(!response.ok)return;const data=await response.json();if(generation!==state.generation)return;merge(data.clips||[]);state.lastNFL=Date.now();})());
  await Promise.allSettled(jobs);if(generation===state.generation&&state.side==='clips')renderClips();
 }finally{clearTimeout(timeout);if(generation===state.generation)clipTimer=setTimeout(()=>liveClips(generation),60000);}
}
function stopNetwork(){clearTimeout(feedTimer);clearTimeout(clipTimer);feedController?.abort();clipController?.abort();}
async function setMode(mode){
 if(mode===state.mode)return;state.playbackFailure=null;stopNetwork();finishHighlight({restore:false});deck.destroy();stopExternal();clock.setRunning(false,performance.now());state.generation++;state.mode=mode;state.auto=true;state.selected=null;state.displayed=null;state.lastFeed=0;state.played.clear();state.quietAt=null;state.started=mode==='live';state.intentRunning=mode==='live';state.clockWait=false;state.requestTag=null;state.retryAt=0;deck.setRate(mode==='live'?1:clock.rate);deck.setRunning(mode==='live');
 if(mode==='replay'){state.games=state.archive.sample(clock.at);state.clips=state.archiveClips||[];direct();}
 else{state.games=[];state.clips=[];state.lastNFL=0;await livePoll(state.generation);liveClips(state.generation);}
 render();renderClips();if(saved.leagueId)importLeague({refresh:true,announce:false});
}
$('replayMode').onclick=()=>setMode('replay');$('liveMode').onclick=()=>setMode('live');
function openSettings(){
 if(state.mode==='replay')setRunning(false);deck.setControls(true);
 const games=state.mode==='replay'?state.archive?.games||[]:state.games;
 $('sourceHeading').textContent=state.mode==='replay'?'Imported replays · optional overrides':'Live stream URLs';
 $('streamInputs').innerHTML=games.map(g=>`<div class="stream-row"><label for="stream-${esc(g.id)}">${esc(g.name)}${g.page?`<a href="${esc(g.page)}" target="_blank" rel="noopener noreferrer">Replay ↗</a>`:''}</label><input id="stream-${esc(g.id)}" data-game="${esc(g.id)}" type="url" value="${esc(videoFor(g)||'')}" placeholder="Imported automatically · optional source override"><small>${state.mode==='replay'?`${timeLabel(g.start)} ET kickoff · ${configFor(g).marks?.length||0} sync points · ${sources.status(g.id)}`:'Direct MP4, WebM or native HLS'}</small></div>`).join('');
 $('manualRoster').value=saved.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n');$('settingsError').textContent='';
 const game=activeGame();$('syncDetails').hidden=state.mode!=='replay'||!game||!!state.clip;
 if(game){$('syncQuarter').value=String(game.period||1);$('syncGameClock').value=game.clock||'15:00';$('syncDescription').textContent=`${game.name} · test clock ${timeLabel(clock.at)} ET`;$('syncTime').value=formatDuration(deck.currentTime??targetFor(game));$('syncMarks').textContent=`${configFor(game).marks?.length||0} sync marks saved for this recording.`;}
 $('settingsDialog').showModal();syncPreview();
}
function syncPreview(){const show=$('settingsDialog').open&&$('syncDetails').open&&!$('syncDetails').hidden&&deck.active===state.selected;$('syncPreview').hidden=!show;if(show){$('syncPreview').append($('mediaDeck'));deck.setControls(true);}else $('player').append($('mediaDeck'));}
$('syncDetails').ontoggle=syncPreview;
$('settingsDialog').onclose=()=>{$('player').append($('mediaDeck'));$('syncPreview').hidden=true;deck.setControls(false);};
function formatDuration(seconds){const value=Math.max(0,Math.floor(seconds));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;}
function parseDuration(text){const parts=text.trim().split(':').map(Number);if(!parts.length||parts.length>3||parts.some(p=>!Number.isFinite(p)||p<0))throw new Error('Use m:ss or h:mm:ss.');return parts.reduce((a,n)=>a*60+n,0);}
$('alignVideo').onclick=()=>{if(!deck.active||deck.active.startsWith('clip:'))return;cancelSelection();state.selected=deck.active;openSettings();$('syncDetails').open=true;syncPreview();};
$('settingsButton').onclick=openSettings;$('roomSettings').onclick=openSettings;$('closeSettings').onclick=()=>{$('settingsDialog').close();deck.setControls(false);};
$('addSync').onclick=()=>{try{const game=activeGame(),play=observedPlay(game,Number($('syncQuarter').value),$('syncGameClock').value,clock.at-game.start);saved.recordings[game.id]=addSyncMark(saved.recordings[game.id]||{},play[0],deck.active===game.id&&deck.currentTime!==null?deck.currentTime:parseDuration($('syncTime').value));persist();clock.seek(game.start+play[0],performance.now());state.games=state.archive.sample(clock.at);$('syncMarks').textContent=`${configFor(game).marks.length} observed sync points saved.`;deck.cancelPending();state.requestTag=null;renderNow();}catch(error){$('settingsError').textContent=error.message;}};
$('clearSync').onclick=()=>{const game=activeGame();saved.recordings[game.id]={...configFor(game),marks:[]};persist();$('syncMarks').textContent='Sync points reset. Using estimated alignment for the edited replay.';};
$('settingsForm').onsubmit=e=>{e.preventDefault();try{
 const roster=parseRoster($('manualRoster').value),recordings={...saved.recordings},streams={...saved.streams};
 for(const input of $('streamInputs').querySelectorAll('input')){const game=(state.archive?.games||[]).find(g=>g.id===input.dataset.game)||state.games.find(g=>g.id===input.dataset.game);const url=safeVideo(input.value.trim());if(state.mode==='replay')recordings[game.id]={...recordings[game.id],url};else streams[gameKey(game)]=url;}
 const changed=JSON.stringify(roster)!==JSON.stringify(saved.roster.map(({name,team,position})=>({name,team,position})));
 saved={...saved,recordings,streams,roster,...(changed?{teamName:'My roster',teamId:''}:{})};persist();$('settingsDialog').close();state.requestTag=null;deck.destroy();deck.setControls(false);deck.setMuted(saved.muted);deck.setRunning(state.mode==='live'||clock.running);if(changed)franchiseOptions();direct(true);render();notice('Sources and sync settings saved.');
 }catch(error){$('settingsError').textContent=error.message;}};
$('fullscreenButton').onclick=async()=>{
 const room=$('watchRoom');try{if(document.fullscreenElement){await document.exitFullscreen();}else if(room.classList.contains('theater')){room.classList.remove('theater');document.body.style.overflow='';}else if(room.requestFullscreen){const fallback=setTimeout(()=>{if(!document.fullscreenElement){room.classList.add('theater');document.body.style.overflow='hidden';fullscreenLabel();}},700);try{await room.requestFullscreen();}finally{clearTimeout(fallback);}}else{room.classList.add('theater');document.body.style.overflow='hidden';}}catch{room.classList.add('theater');document.body.style.overflow='hidden';}fullscreenLabel();
};
function fullscreenLabel(){const active=!!document.fullscreenElement||$('watchRoom').classList.contains('theater');$('fullscreenButton').textContent=active?'Exit full screen ↙':'Full screen ↗';$('fullscreenButton').setAttribute('aria-label',active?'Exit fullscreen':'Enter fullscreen');}
document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement){$('watchRoom').classList.remove('theater');document.body.style.overflow='';}fullscreenLabel();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('watchRoom').classList.contains('theater')){$('watchRoom').classList.remove('theater');document.body.style.overflow='';fullscreenLabel();}});
function preparationLabel(){
 const ready=deck.snapshot().players.filter(p=>p.ready&&!p.active),imported=sources.records.size;
 const native=ready.filter(p=>Number.isFinite(p.bufferSeconds));return `${state.mode==='replay'?imported+'/14 replays imported · ':''}${ready.length} ready ahead${native.length?' · '+Math.floor(Math.min(...native.map(p=>p.bufferSeconds)))+'s buffered':ready.length?' · playback confirmed':''}`;
}
async function warmAhead(){
 if(state.mode!=='replay'||state.picture!=='native'||!state.started||!state.intentRunning||!state.archive||!deck.active||state.clockWait||state.playbackFailure||state.pendingClip||deck.gate.pending)return;
 const options=directorOptions(),ranked=rankGames(state.games,saved.roster,options).filter(x=>x.game.id!==deck.active);
 const future=forecastGames(state.archive,clock.at,saved.roster,deck.active,45,options);
 // Favor roster games, keep one candidate warm, and leave the third slot for a clip.
 const candidates=[...ranked.filter(x=>x.players.length),...future.filter(x=>x.players.length),...ranked,...future];
 const candidate=candidates.find(x=>x.game.id!==deck.active);if(!candidate)return;
 const nextClip=automaticClips()[0];if(nextClip&&!nflSources.get(nextClip.id))nflSources.resolve(nextClip).catch(()=>{});
 const version=state.seekVersion,generation=state.generation;
 try{const game=candidate.game,source=await resolveVideo(game);if(version!==state.seekVersion||generation!==state.generation||deck.gate.pending)return;await deck.warm(game.id,source.url,()=>mediaTime(game,clock.at,configFor(game)),{type:source.type,duration:source.duration});}catch{}
}
$('retryVideo').onclick=()=>{state.playbackFailure=null;state.requestTag=null;state.retryAt=0;deck.cancelPending();deck.retry();if(activeGame()&&state.mode==='replay')sources.invalidate(activeGame().id);if(!deck.active)setRunning(true);else showPicture();};
$('splashPlay').onclick=()=>setRunning(true);
$('downloadDiagnostics').onclick=()=>{
 const report={version:'fantasy-stream-3',failure:state.playbackFailure,week:7,at:clock.at,franchise:saved.teamName,policy:saved.rosterOnly?'roster-only':'roster-redzone',selected:state.selected,imported:sources.records.size,sourceErrors:[...sources.errors].map(([id,error])=>({id,message:error.message})),pendingSources:[...sources.pending.keys()],alignment:state.archive.games.map(g=>({id:g.id,points:configFor(g).marks||[],estimated:!configFor(g).marks?.length})),...deck.snapshot()};
 const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fantasy-stream-playback.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
function tick(now){
 if($('settingsDialog').open&&$('syncDetails').open&&deck.currentTime!==null)$('syncTime').value=formatDuration(deck.currentTime);
 const clockGame=state.archive?.games.find(g=>g.id===deck.active);
 if(state.mode==='replay'&&state.picture==='native'&&clock.running&&!state.clip&&clockGame&&!state.clockWait&&!state.rosterIdle){if(deck.activeSlot.video.inAd)clock.last=now;else clock.seek(Math.min(clock.end,wallTime(clockGame,deck.currentTime,configFor(clockGame))),now);}
 else clock.tick(now);
 if(!document.hidden&&state.archive&&state.mode==='replay'&&now-state.lastDecision>=250){
  state.lastDecision=now;state.games=state.archive.sample(clock.at);direct();
  if(now-state.lastWarm>4000&&state.picture==='native'&&state.started){state.lastWarm=now;warmAhead();}
  if(now-state.lastRender>500){state.lastRender=now;if(deck.running)deck.activeSlot?.video.checkStall?.();renderNow();renderGames();if(state.side==='roster')renderRoster();}
 }
 requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){setRunning(false);}else{clock.last=performance.now();renderNow();}});
window.addEventListener('pagehide',()=>{clearTimeout(state.noticeTimer);clearTimeout(highlightTimer);clearTimeout(state.loadWatchdog);stopNetwork();sources.cancel();deck.destroy();stopExternal();});
window.addEventListener('pageshow',e=>{if(e.persisted){clock.last=performance.now();if(state.mode==='live'){livePoll(state.generation);liveClips(state.generation);}render();}});
async function init(){
 franchiseOptions();renderRoster();
 try{
  const [archiveResponse,highlightResponse]=await Promise.all([fetch('/week7.json'),fetch('/nfl-highlights.json')]);
  if(!archiveResponse.ok)throw new Error('Replay archive unavailable. Reload to try again.');
  state.archive=new ReplayArchive(await archiveResponse.json());state.games=state.archive.sample(state.archive.sessions[0].start);
  $('weekLabel').textContent=state.archive.data.title;$('sessionSelect').innerHTML=state.archive.sessions.map((s,i)=>`<option value="${i}">${esc(s.label)}</option>`).join('');
  const defaultSession=Math.max(0,state.archive.sessions.findIndex(s=>s.label.startsWith('Sunday')));setSession(defaultSession);const opening=state.archive.events.find(at=>at>=session().start&&at<=session().end&&state.archive.sample(at).filter(g=>g.state==='in').length>=3);if(opening)seekAll(opening);
  if(highlightResponse.ok){const library=await highlightResponse.json();state.stories=[];state.clips=library.clips||[];state.archiveClips=state.clips;}
  direct();render();renderClips();restoreConnection();sources.importAll(state.archive.games,[state.selected,...forecastGames(state.archive,clock.at,saved.roster,state.selected).map(x=>x.game.id)]);requestAnimationFrame(tick);
 }catch(error){status(error.message);$('signalPlay').textContent='The replay archive could not load.';}
}
init();
