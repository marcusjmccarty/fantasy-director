import {ReplayArchive,ReplayClock,timeLabel,mediaTime,addSyncMark} from './replay-engine.js';
import {MediaDeck} from './media-deck.js';
import {HighlightPlayer} from './highlight-player.js';
import {normalizeScoreboard} from './adapters.js';
import {normalizeHighlights,playable} from './highlights.js';
import {chooseGame,rankGames,involved,parseRoster,safeVideo,gameKey} from './director.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const SAMPLE=[{name:'A.J. Brown',team:'PHI',position:'WR'},{name:'Jonathan Taylor',team:'IND',position:'RB'}];
let saved={roster:SAMPLE,teamName:'Sample roster',teamId:'',leagueId:'',streams:{},recordings:{},leagueCache:null,muted:true};
try{
 const old=JSON.parse(localStorage.getItem('fd-simple-v2')||'null');
 if(old&&Array.isArray(old.roster)){saved={...saved,...old};saved.roster=parseRoster(old.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n'));saved.recordings=old.recordings||{};}
}catch{}
const state={mode:'replay',picture:'signal',archive:null,session:0,games:[],selected:null,displayed:null,auto:true,started:false,league:saved.leagueCache,loadingLeague:false,side:'games',generation:0,lastFeed:0,feedError:'',clip:null,manualClip:false,clips:[],stories:[],played:new Set(),quietAt:null,lastClip:-Infinity,changedAt:0,switches:0,externalId:null,noticeTimer:null,lastRender:0,lastWarm:0,lastDecision:0,forceSeek:false};
const clock=new ReplayClock();
let feedTimer,clipTimer,feedController,clipController,seekTimer;
function persist(){try{localStorage.setItem('fd-simple-v2',JSON.stringify(saved));}catch{notice('Browser storage is unavailable. Your changes work for this visit.');}}
function notice(message){$('roomNotice').textContent=message;$('roomNotice').hidden=false;clearTimeout(state.noticeTimer);state.noticeTimer=setTimeout(()=>$('roomNotice').hidden=true,6000);}
function status(message){$('playbackStatus').textContent=message;}
const deck=new MediaDeck($('mediaDeck'),{onCommit:key=>{
 if(key.startsWith('clip:'))return;
 state.displayed=key;state.switches++;renderNow();
},onStatus:status,onEnd:key=>{if(key.startsWith('clip:'))finishHighlight();}});
const highlight=new HighlightPlayer($('highlightHost'),{ended:()=>finishHighlight(),status});
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
 saved={...saved,roster:team.players,teamName:team.name,teamId:team.id,leagueId:state.league.leagueId,season:state.league.season,rosterWeek:state.league.week,syncedAt:Date.now(),leagueCache:state.league};
 persist();$('franchiseSelect').value=team.id;$('connectBar').hidden=true;state.played.clear();state.quietAt=null;
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
 state.started=state.started||running;if(running)deck.retry();clock.setRunning(running,performance.now());deck.setRunning(running);if(!running)highlight.pause();if(running&&state.clip?.youtubeId)finishHighlight();direct();render();
}
function seekAll(at){
 const s=session();if(!s)return;finishHighlight();deck.cancelPending();deck.retry();state.forceSeek=true;clock.seek(Math.max(s.start,Math.min(s.end,at)),performance.now());state.played.clear();state.quietAt=null;state.lastClip=-Infinity;state.games=state.archive.sample(clock.at);
 direct(true);render();if(state.picture==='external')status('Timeline moved. The external replay cannot seek with it.');
}
$('sessionSelect').onchange=e=>setSession(Number(e.target.value));
$('timeline').oninput=e=>{$('timelineTime').textContent=timeLabel(Number(e.target.value))+' ET';clearTimeout(seekTimer);seekTimer=setTimeout(()=>seekAll(Number(e.target.value)),120);};
$('timeline').onchange=e=>{clearTimeout(seekTimer);seekAll(Number(e.target.value));};
$('playButton').onclick=()=>setRunning(!clock.running);
$('skipBack').onclick=()=>seekAll(clock.at-30);
$('restartTest').onclick=()=>seekAll(session().start);
$('nextSwitch').onclick=()=>{state.auto=true;$('autoDirector').checked=true;state.started=true;seekAll(state.archive.nextSwitch(clock.at,saved.roster,state.selected,session().end));};
$('playbackRate').onchange=e=>{clock.tick(performance.now());clock.rate=Number(e.target.value);if(state.picture==='native'&&clock.rate>4){clock.rate=4;e.target.value='4';notice('Synced recordings support up to 4×. Timeline tests support 60×.');}deck.setRate(clock.rate);};
$('muteButton').onclick=()=>{saved.muted=!saved.muted;deck.setMuted(saved.muted);highlight.setMuted(saved.muted);persist();renderNow();};
function configFor(game){return saved.recordings[game.id]||{};}
function videoFor(game){return state.mode==='replay'?configFor(game).url:saved.streams[gameKey(game)];}
function targetFor(game){return state.mode==='replay'?mediaTime(game,clock.at,configFor(game)):deck.slots.get(game.id)?.video.currentTime||0;}
function stopExternal(){if($('externalFrame').hasAttribute('src'))$('externalFrame').removeAttribute('src');$('externalFrame').hidden=true;state.externalId=null;}
function changePicture(picture){
 finishHighlight();deck.destroy();stopExternal();state.picture=picture;state.displayed=null;
 if(picture==='native'&&clock.rate>4){clock.rate=1;$('playbackRate').value='1';}deck.setRate(clock.rate);deck.setRunning(clock.running);deck.setMuted(saved.muted);
 if(picture==='external'){state.auto=false;$('autoDirector').checked=false;setRunning(false);notice('External replays are manual. Their player cannot report readiness or follow the shared seek bar.');}
 showPicture();render();
}
$('pictureMode').onchange=e=>changePicture(e.target.value);
function showPicture(){
 const game=activeGame();if(!game||state.clip)return;
 const picture=state.mode==='live'?'native':state.picture;
 $('signal').hidden=picture!=='signal';$('mediaDeck').hidden=picture!=='native';$('externalFrame').hidden=picture!=='external';
 if(picture==='signal'){state.displayed=game.id;status(`Recorded feed · ${state.archive?.data.coverage.games||14} games · ${state.switches} switches`);return;}
 if(picture==='external'){
  if(state.externalId!==game.id){$('externalFrame').src=game.embed;state.externalId=game.id;state.displayed=game.id;}
  status('External player · manual seek · playback readiness unavailable');return;
 }
 const url=videoFor(game);
 if(!url){$('signal').hidden=false;$('mediaDeck').hidden=!deck.active;status('Add a direct recording in Sources & sync to enable synchronized video.');return;}
 if(!state.started){$('signal').hidden=false;$('mediaDeck').hidden=true;status('Press Play test to prepare synchronized video.');return;}
 if(state.mode==='replay'&&!clock.running&&deck.active===game.id&&!state.forceSeek)return;
 state.forceSeek=false;deck.request(game.id,url,()=>targetFor(game));
}
function direct(force=false){
 if(state.auto&&(state.mode==='replay'||Date.now()-state.lastFeed<20000)){
  const pick=chooseGame(state.games,saved.roster,force?null:state.selected,state.changedAt,performance.now());
  if(pick&&pick.game.id!==state.selected){state.selected=pick.game.id;state.changedAt=performance.now();if(state.picture==='signal')state.switches++;}
 }
 if(!activeGame())state.selected=state.games.find(g=>g.state==='in')?.id||state.games[0]?.id;
 const pick=rankGames(state.games,saved.roster)[0];
 if(pick?.urgent){state.quietAt=null;if(state.clip&&!state.manualClip)finishHighlight();}else if(state.quietAt===null)state.quietAt=performance.now();
 if(state.auto&&state.started&&(state.mode==='live'||clock.running)&&!document.hidden&&(state.mode==='live'||clock.rate<=4)&&$('autoClips').checked&&!state.clip&&state.quietAt!==null&&performance.now()-state.quietAt>5000&&performance.now()-state.lastClip>120000){
  const clip=state.clips.find(c=>!state.played.has(c.id)&&(c.youtubeId||playable(c)));
  if(clip)playHighlight(clip,false);
 }
 if(!state.clip)showPicture();
 if(force)state.lastWarm=0;
}
$('autoDirector').onchange=e=>{
 if(state.picture==='external'&&state.mode==='replay'&&e.target.checked){e.target.checked=false;notice('Choose Timeline test or Synced recordings for automatic cuts. External embeds cannot confirm video readiness.');return;}
 state.auto=e.target.checked;direct(true);render();
};
$('gameList').onclick=e=>{
 const b=e.target.closest('[data-game]');if(!b)return;const game=state.games.find(g=>g.id===b.dataset.game);if(!game)return;
 state.auto=false;state.started=true;finishHighlight();state.selected=game.id;
 if(state.mode==='replay'&&(clock.at<game.start||clock.at>game.end)){
  const index=state.archive.sessions.findIndex(s=>s.gameIds.includes(game.id));setSession(index,{seek:false});clock.seek(game.start,performance.now());state.games=state.archive.sample(clock.at);
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
 $('gameTitle').textContent=state.clip?state.clip.title:game?.name||'Last week. Any time.';
 $('modeCaption').textContent=state.clip?'OFFICIAL HIGHLIGHT':state.mode==='replay'?'WEEK 7 REPLAY LAB':'LIVE DIRECTOR';
 $('reason').textContent=state.clip?'Returns to the game when priority action resumes.':!game?'Loading the NFL slate…':!state.auto?'Pinned to this game.':roster.length?`${roster.map(p=>p.name).join(', ')} · possession priority`:`Roster quiet · following the closest scoring threat.`;
 $('autoDirector').checked=state.auto;$('playButton').textContent=clock.running?'Pause':'Play test';$('muteButton').textContent=saved.muted?'Unmute':'Mute';$('muteButton').setAttribute('aria-pressed',String(saved.muted));
 $('returnGame').hidden=!state.clip;$('sourceLink').hidden=state.mode!=='replay'||!game;if(game?.page)$('sourceLink').href=game.page;
 $('timeline').value=String(clock.at);$('timelineTime').textContent=state.archive?timeLabel(clock.at)+' ET':'—';
 $('playbackNote').textContent=state.mode==='live'?'Live possession is inferred from ESPN’s feed. Source and feed latency can vary.':state.picture==='external'?'All 14 full-game embeds are imported. Their own controls handle playback; shared seeking and automatic buffered cuts are unavailable for these external players.':state.picture==='native'?'One clock seeks every configured recording. Only the active game and two candidates load. Set sync marks for edited recordings. Current footage stays visible while the next source loads.':'Recorded possessions and field position from every game, Oct 22–26. Seek any time or use Next switch. The field view tests decisions without downloading video.';
 renderSignal();
}
function renderGames(){
 $('gameCount').textContent=state.games.length;$('gamesHeading').textContent=state.mode==='replay'?'All of Week 7':'NFL games';$('feedStatus').textContent=state.mode==='replay'?'Recorded':state.feedError?'Feed unavailable':'ESPN';
 $('gameList').innerHTML=state.games.map(g=>{
 const playing=g.id===state.displayed,selected=g.id===state.selected;
 const label=playing?'Watching':selected?'Preparing':g.state==='in'?(involved(g,saved.roster).length?'Your roster':g.redZone?'Red zone':'In progress'):g.state==='post'?'Final':'Later';
 return `<button class="game" data-game="${esc(g.id)}" aria-pressed="${playing}"><span class="game-row"><strong>${esc(g.name)}</strong><small>${g.teams.map(t=>esc(t.score||0)).join('–')}</small></span><span class="game-meta">${esc(g.detail)}</span><span class="game-state">${label}${state.mode==='replay'?' · '+(saved.recordings[g.id]?.url?'Synced source':'Replay imported'):''}</span></button>`;
 }).join('')||'<p class="empty-list">No games available. Replay lab works any day.</p>';
}
function renderRoster(){
 const players=displayedGame()?involved(displayedGame(),saved.roster):[];$('teamName').textContent=saved.teamName;$('refreshRoster').hidden=!saved.leagueId;
 $('rosterNote').textContent=saved.teamId?`${saved.roster.length} starters · League ${saved.leagueId} · ESPN week ${saved.rosterWeek||'—'}`:'Choose a league franchise above, or edit the sample in Sources & sync.';
 $('rosterList').innerHTML=saved.roster.map(p=>`<div class="roster-item ${players.some(x=>x.name===p.name)?'active':''}"><span class="position">${esc(p.position)}</span><div><strong>${esc(p.name)}</strong><small>${esc(p.team)}</small></div></div>`).join('')||'<p class="empty-list">No starters. The director follows the closest scoring threat.</p>';
}
function renderClips(){
 $('clipList').innerHTML=[...state.clips.map(c=>`<div class="clip"><button data-clip="${esc(c.id)}">▶ ${esc(c.title)}</button><small>${c.youtubeId?'NFL · YouTube player':'ESPN · direct video'}${state.played.has(c.id)?' · Played':''}</small><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Original highlight ↗</a></div>`),...state.stories.map(c=>`<div class="clip"><a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title)} ↗</a><small>NFL story · opens at NFL.com</small></div>`)].join('')||'<p class="empty-list">No published clips available for this slate.</p>';
}
function render(){
 $('replayMode').setAttribute('aria-pressed',String(state.mode==='replay'));$('liveMode').setAttribute('aria-pressed',String(state.mode==='live'));$('transport').hidden=state.mode!=='replay';renderNow();renderGames();renderRoster();
}
async function playHighlight(clip,manual=true){
 if(state.picture==='external'){stopExternal();}
 finishHighlight({restore:false});state.clip=clip;state.manualClip=manual;state.lastClip=performance.now();state.played.add(clip.id);deck.suspend();
 $('signal').hidden=true;$('externalFrame').hidden=true;$('mediaDeck').hidden=true;
 if(clip.youtubeId)highlight.play(clip,saved.muted);
 else if(playable(clip)){$('mediaDeck').hidden=false;deck.setRunning(true);deck.request('clip:'+clip.id,clip.mediaUrl,0).then(ready=>{if(!ready&&state.clip===clip)finishHighlight();});}
 else{state.clip=null;showPicture();return;}
 renderNow();renderClips();
}
function finishHighlight({restore=true}={}){
 if(!state.clip)return;highlight.stop();state.clip=null;state.manualClip=false;deck.setRunning(state.mode==='live'||clock.running);deck.cancelPending();
 if(restore){showPicture();renderNow();}
}
$('returnGame').onclick=()=>finishHighlight();$('autoClips').onchange=e=>{if(!e.target.checked&&state.clip&&!state.manualClip)finishHighlight();};
$('clipList').onclick=e=>{const b=e.target.closest('[data-clip]');if(b){const clip=state.clips.find(c=>c.id===b.dataset.clip);if(clip)playHighlight(clip);}};
async function espn(path,signal){const response=await fetch(BASE+path,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});if(!response.ok)throw new Error('ESPN unavailable');return response.json();}
async function livePoll(generation){
 if(generation!==state.generation||state.mode!=='live')return;feedController=new AbortController();const timeout=setTimeout(()=>feedController.abort(),8000);
 try{const games=normalizeScoreboard(await espn('scoreboard',feedController.signal));if(generation!==state.generation)return;state.games=games;state.lastFeed=Date.now();state.feedError='';direct();render();}catch{if(generation===state.generation){state.feedError='Unavailable';$('feedStatus').textContent='Feed unavailable · auto held';}}
 finally{clearTimeout(timeout);if(generation===state.generation)feedTimer=setTimeout(()=>livePoll(generation),!document.hidden&&state.games.some(g=>g.state==='in')?5000:30000);}
}
async function liveClips(generation){
 if(generation!==state.generation||state.mode!=='live')return;clipController=new AbortController();const timeout=setTimeout(()=>clipController.abort(),15000);
 try{const ranked=rankGames(state.games,saved.roster).slice(0,2);for(const {game} of ranked){const data=await espn('summary?event='+game.id,clipController.signal);if(generation!==state.generation)return;const clips=normalizeHighlights(data,game).filter(c=>c.kind==='clip'&&playable(c));state.clips=[...new Map([...state.clips,...clips].map(c=>[c.id,c])).values()].slice(-20);}if(state.side==='clips')renderClips();}catch{}
 finally{clearTimeout(timeout);if(generation===state.generation)clipTimer=setTimeout(()=>liveClips(generation),60000);}
}
function stopNetwork(){clearTimeout(feedTimer);clearTimeout(clipTimer);feedController?.abort();clipController?.abort();}
async function setMode(mode){
 if(mode===state.mode)return;stopNetwork();finishHighlight({restore:false});deck.destroy();stopExternal();clock.setRunning(false,performance.now());state.generation++;state.mode=mode;state.auto=true;state.selected=null;state.displayed=null;state.lastFeed=0;state.played.clear();state.quietAt=null;state.started=mode==='live';deck.setRunning(mode==='live');
 if(mode==='replay'){state.games=state.archive.sample(clock.at);state.clips=state.archiveClips||[];direct();}
 else{state.games=[];state.clips=[];await livePoll(state.generation);liveClips(state.generation);}
 render();renderClips();if(saved.leagueId)importLeague({refresh:true,announce:false});
}
$('replayMode').onclick=()=>setMode('replay');$('liveMode').onclick=()=>setMode('live');
function openSettings(){
 if(state.mode==='replay')setRunning(false);
 const games=state.mode==='replay'?state.archive?.games||[]:state.games;
 $('sourceHeading').textContent=state.mode==='replay'?'Recordings · Week 7':'Live stream URLs';
 $('streamInputs').innerHTML=games.map(g=>`<div class="stream-row"><label for="stream-${esc(g.id)}">${esc(g.name)}${g.page?`<a href="${esc(g.page)}" target="_blank" rel="noopener noreferrer">Replay ↗</a>`:''}</label><input id="stream-${esc(g.id)}" data-game="${esc(g.id)}" type="url" value="${esc(videoFor(g)||'')}" placeholder="https://…/recording.mp4"><small>${state.mode==='replay'?`${timeLabel(g.start)} ET kickoff · ${configFor(g).marks?.length||0} sync marks`:'Direct MP4, WebM or native HLS'}</small></div>`).join('');
 $('manualRoster').value=saved.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n');$('settingsError').textContent='';
 const game=activeGame();$('syncDetails').hidden=state.mode!=='replay'||!game;
 if(game){$('syncDescription').textContent=`${game.name} · test clock ${timeLabel(clock.at)} ET`;$('syncTime').value=formatDuration(deck.currentTime??targetFor(game));$('syncMarks').textContent=`${configFor(game).marks?.length||0} sync marks saved for this recording.`;}
 $('settingsDialog').showModal();
}
function formatDuration(seconds){const value=Math.max(0,Math.floor(seconds));return `${Math.floor(value/60)}:${String(value%60).padStart(2,'0')}`;}
function parseDuration(text){const parts=text.trim().split(':').map(Number);if(!parts.length||parts.length>3||parts.some(p=>!Number.isFinite(p)||p<0))throw new Error('Use m:ss or h:mm:ss.');return parts.reduce((a,n)=>a*60+n,0);}
$('settingsButton').onclick=openSettings;$('roomSettings').onclick=openSettings;$('closeSettings').onclick=()=>$('settingsDialog').close();
$('addSync').onclick=()=>{try{const game=activeGame();saved.recordings[game.id]=addSyncMark(configFor(game),clock.at-game.start,parseDuration($('syncTime').value));persist();$('syncMarks').textContent=`${configFor(game).marks.length} sync marks saved.`;deck.cancelPending();}catch(error){$('settingsError').textContent=error.message;}};
$('clearSync').onclick=()=>{const game=activeGame();saved.recordings[game.id]={...configFor(game),marks:[]};persist();$('syncMarks').textContent='Sync marks reset. Recording zero is aligned to kickoff.';};
$('settingsForm').onsubmit=e=>{e.preventDefault();try{
 const roster=parseRoster($('manualRoster').value),recordings={...saved.recordings},streams={...saved.streams};
 for(const input of $('streamInputs').querySelectorAll('input')){const game=(state.archive?.games||[]).find(g=>g.id===input.dataset.game)||state.games.find(g=>g.id===input.dataset.game);const url=safeVideo(input.value.trim());if(state.mode==='replay')recordings[game.id]={...recordings[game.id],url};else streams[gameKey(game)]=url;}
 const changed=JSON.stringify(roster)!==JSON.stringify(saved.roster.map(({name,team,position})=>({name,team,position})));
 saved={...saved,recordings,streams,roster,...(changed?{teamName:'My roster',teamId:''}:{})};persist();$('settingsDialog').close();deck.destroy();deck.setMuted(saved.muted);deck.setRunning(state.mode==='live'||clock.running);if(changed)franchiseOptions();direct(true);render();notice('Sources and sync settings saved.');
 }catch(error){$('settingsError').textContent=error.message;}};
$('fullscreenButton').onclick=async()=>{
 const room=$('watchRoom');try{if(document.fullscreenElement){await document.exitFullscreen();}else if(room.classList.contains('theater')){room.classList.remove('theater');document.body.style.overflow='';}else if(room.requestFullscreen){const fallback=setTimeout(()=>{if(!document.fullscreenElement){room.classList.add('theater');document.body.style.overflow='hidden';fullscreenLabel();}},700);try{await room.requestFullscreen();}finally{clearTimeout(fallback);}}else{room.classList.add('theater');document.body.style.overflow='hidden';}}catch{room.classList.add('theater');document.body.style.overflow='hidden';}fullscreenLabel();
};
function fullscreenLabel(){const active=!!document.fullscreenElement||$('watchRoom').classList.contains('theater');$('fullscreenButton').textContent=active?'Exit full screen ↙':'Full screen ↗';$('fullscreenButton').setAttribute('aria-label',active?'Exit fullscreen':'Enter fullscreen');}
document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement){$('watchRoom').classList.remove('theater');document.body.style.overflow='';}fullscreenLabel();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('watchRoom').classList.contains('theater')){$('watchRoom').classList.remove('theater');document.body.style.overflow='';fullscreenLabel();}});
function tick(now){
 clock.tick(now);
 if(!document.hidden&&state.archive&&state.mode==='replay'&&now-state.lastDecision>=250){
  state.lastDecision=now;
  state.games=state.archive.sample(clock.at);direct();
  if(state.picture==='native'&&!state.clip&&state.started){const game=displayedGame();if(game&&deck.active===game.id)deck.sync(mediaTime(game,clock.at,configFor(game)));}
  if(now-state.lastWarm>2000&&state.picture==='native'&&state.started&&clock.running){
   state.lastWarm=now;const future=state.archive.sample(clock.at+5);for(const {game} of rankGames(future,saved.roster).slice(0,2)){const url=videoFor(game);if(url)deck.warm(game.id,url,()=>mediaTime(game,clock.at,configFor(game)));}
  }
  if(now-state.lastRender>500){state.lastRender=now;renderNow();renderGames();if(state.side==='roster')renderRoster();}
 }
 requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clock.setRunning(false,performance.now());deck.setRunning(false);highlight.pause();}else{clock.last=performance.now();renderNow();}});
window.addEventListener('pagehide',()=>{stopNetwork();deck.destroy();highlight.stop();stopExternal();});
window.addEventListener('pageshow',e=>{if(e.persisted){clock.last=performance.now();if(state.mode==='live'){livePoll(state.generation);liveClips(state.generation);}render();}});
async function init(){
 franchiseOptions();renderRoster();
 try{
  const [archiveResponse,highlightResponse]=await Promise.all([fetch('/week7.json'),fetch('/nfl-highlights.json')]);
  if(!archiveResponse.ok)throw new Error('Replay archive unavailable. Reload to try again.');
  state.archive=new ReplayArchive(await archiveResponse.json());state.games=state.archive.sample(state.archive.sessions[0].start);
  $('weekLabel').textContent=state.archive.data.title;$('sessionSelect').innerHTML=state.archive.sessions.map((s,i)=>`<option value="${i}">${esc(s.label)}</option>`).join('');
  const defaultSession=Math.max(0,state.archive.sessions.findIndex(s=>s.label.startsWith('Sunday')));setSession(defaultSession);const opening=state.archive.events.find(at=>at>=session().start&&at<=session().end&&state.archive.sample(at).filter(g=>g.state==='in').length>=3);if(opening)seekAll(opening);
  if(highlightResponse.ok){const library=await highlightResponse.json();state.stories=library.stories;state.clips=library.embeds;state.archiveClips=library.embeds;}
  direct();render();renderClips();restoreConnection();requestAnimationFrame(tick);
 }catch(error){status(error.message);$('signalPlay').textContent='The replay archive could not load.';}
}
init();
