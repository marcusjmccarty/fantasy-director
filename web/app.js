import {SOURCES,scenarios} from './replays.js';
import {normalizeScoreboard} from './adapters.js';
import {normalizeHighlights,playable} from './highlights.js';
import {chooseGame,involved,parseRoster,safeVideo,gameKey} from './director.js';
const $=id=>document.getElementById(id),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SAMPLE=[{name:'A.J. Brown',team:'PHI',position:'WR'},{name:'Jonathan Taylor',team:'IND',position:'RB'}];
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
let saved={roster:SAMPLE,teamName:'Sample roster',streams:{},leagueId:'',teamId:'',season:2026};
try{const old=JSON.parse(localStorage.getItem('fd-simple-v2')||'null');if(old){saved={...saved,...old};saved.roster=parseRoster(old.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n'));saved.streams=Object.fromEntries(Object.entries(old.streams||{}).map(([key,v])=>[key,safeVideo(v)]));}}catch{}
let state={mode:'replay',step:0,running:false,auto:true,games:[],currentId:'replay-phi',loaded:'',playerStarted:false,clip:null,clipManual:false,clips:[],played:new Set(),quietAt:null,lastClip:-Infinity,changedAt:0,lastFeed:0,feedError:'',generation:0,pendingLeague:null,failedURL:'',side:'games'};
let importInFlight=false;
let testTimer,feedTimer,clipTimer,clipTimeout,toastTimer,feedController,clipController;
state.games=scenarios(0);
function persist(){try{localStorage.setItem('fd-simple-v2',JSON.stringify(saved));}catch{notice('Settings are applied for this visit; browser storage is unavailable.');}}
function notice(text){$('notice').textContent=text;$('notice').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('notice').hidden=true,6000);}
function activeGame(){return state.games.find(g=>g.id===state.currentId);}
function showSide(name){state.side=name;for(const n of ['games','roster','clips']){$(n+'Panel').hidden=n!==name;$(n+'Tab').setAttribute('aria-selected',n===name);} }
for(const name of ['games','roster','clips']){$(name+'Tab').onclick=()=>showSide(name);$(name+'Tab').onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const tabs=['games','roster','clips'];const next=tabs[(tabs.indexOf(name)+(e.key==='ArrowRight'?1:2))%3];showSide(next);$(next+'Tab').focus();};}
$('connectionButton').onclick=()=>{$('connectBar').hidden=!$('connectBar').hidden;if(!$('connectBar').hidden)$('leagueId').focus();};
$('leagueId').value=saved.leagueId;if(saved.teamId)$('connectBar').hidden=true;
async function importLeague(refresh=false){if(importInFlight)return;const leagueId=refresh?saved.leagueId:$('leagueId').value.trim();if(!/^\d{1,12}$/.test(leagueId)){$('importStatus').textContent='Enter the numeric league ID from ESPN.';return;}
 importInFlight=true;$('leagueForm').setAttribute('aria-busy','true');$('importStatus').classList.remove('error');$('importButton').disabled=true;$('refreshRoster').disabled=true;$('importButton').textContent='Importing…';$('importStatus').textContent='Getting your teams from ESPN…';$('teamPicker').hidden=true;
 try{const response=await fetch('/api/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId}),signal:AbortSignal.timeout(15000)});const type=response.headers.get('Content-Type')||'';if(!type.includes('application/json'))throw new Error('Your session needs refreshing. Reload this page, then import again.');const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not import this league.');state.pendingLeague=data;
 const selected=data.teams.find(t=>t.id===(leagueId===saved.leagueId?saved.teamId:null))||data.teams.find(t=>t.id===data.ownedTeamId)||(data.teams.length===1?data.teams[0]:null);
 if(selected){applyTeam(data,selected);return;}
 $('teamSelect').innerHTML=data.teams.map(t=>`<option value="${escape(t.id)}">${escape(t.name)}</option>`).join('');$('teamPicker').hidden=false;$('importStatus').textContent=`${data.teams.length} teams found. Choose yours once.`;
 }catch(e){$('connectBar').hidden=false;$('importStatus').classList.add('error');$('importStatus').textContent=e.name==='TimeoutError'?'ESPN took too long. Please try again.':e.message;}
 finally{importInFlight=false;$('leagueForm').setAttribute('aria-busy','false');$('importButton').disabled=false;$('refreshRoster').disabled=false;$('importButton').textContent='Import roster';}}
$('leagueForm').onsubmit=e=>{e.preventDefault();importLeague();};$('refreshRoster').onclick=()=>importLeague(true);
$('useTeam').onclick=()=>{const data=state.pendingLeague;const team=data?.teams.find(t=>t.id===$('teamSelect').value);if(team)applyTeam(data,team);};
function applyTeam(data,team){$('leagueId').value=data.leagueId;saved={...saved,syncedAt:Date.now(),roster:team.players,teamName:team.name,leagueId:data.leagueId,season:data.season,teamId:team.id};persist();$('connectBar').hidden=true;$('teamPicker').hidden=true;$('importStatus').textContent=`${team.players.length} starters imported.`;state.pendingLeague=null;direct();render();showSide('roster');notice(`${team.name}: ${team.players.length} starters imported.`);}
function unload(video){video.pause();video.removeAttribute('src');video.load();video.hidden=true;}
function clearGame(){if($('gameFrame').hasAttribute('src'))$('gameFrame').removeAttribute('src');$('gameFrame').hidden=true;if($('gameVideo').hasAttribute('src'))unload($('gameVideo'));state.loaded='';}
async function startVideo(video){video.muted=true;try{await video.play();$('playVideo').hidden=true;}catch{$('playVideo').hidden=false;}}
function sourceFor(g){return state.mode==='replay'?g?.embed:g&&saved.streams[gameKey(g)];}
function loadPlayer(){
 const g=activeGame(),url=sourceFor(g);$('returnLive').hidden=!state.clip;
 if(state.clip){$('playerEmpty').hidden=true;return;}
 $('clipVideo').hidden=true;
 if(!state.playerStarted||!url){clearGame();$('playerEmpty').hidden=false;$('playerEmpty').querySelector('h1').textContent=state.mode==='replay'?'Ready when you are.':'Connect a game stream.';$('playerEmpty').querySelector('p').textContent=state.mode==='replay'?'Two full-game replays are ready to test.':'Choose Settings to add a compatible video URL.';$('loadReplay').textContent=state.mode==='replay'?'Load replay':'Stream settings';return;}
 if(state.failedURL===url){$('playerEmpty').hidden=false;$('playerEmpty').querySelector('h1').textContent='This video is unavailable.';$('playerEmpty').querySelector('p').textContent='Check your stream URL in Settings.';$('loadReplay').textContent='Stream settings';return;}
 $('playerEmpty').hidden=true;if(state.loaded===url)return;clearGame();state.loaded=url;$('playVideo').hidden=true;
 if(state.mode==='replay'){$('gameFrame').src=url;$('gameFrame').hidden=false;}
 else {if(/\.m3u8(?:\?|$)/i.test(url)&&!$('gameVideo').canPlayType('application/vnd.apple.mpegurl')){state.failedURL=url;notice('This HLS source needs a browser with native HLS support, such as Safari.');loadPlayer();return;}$('gameVideo').src=url;$('gameVideo').hidden=false;startVideo($('gameVideo'));}
}
$('loadReplay').onclick=()=>{if(state.mode==='replay'&&!state.failedURL){state.playerStarted=true;loadPlayer();}else openSettings();};
$('gameVideo').onerror=()=>{if(state.loaded&&state.mode==='live'){state.failedURL=state.loaded;loadPlayer();}};
$('playVideo').onclick=()=>startVideo(state.clip?$('clipVideo'):$('gameVideo'));
function finishClip(){clearTimeout(clipTimeout);state.clip=null;unload($('clipVideo'));$('playVideo').hidden=true;loadPlayer();}
$('returnLive').onclick=()=>{finishClip();render();};$('clipVideo').onended=()=>{finishClip();render();};$('clipVideo').onerror=()=>{if(state.clip){notice('This highlight is unavailable. Returning to the game.');finishClip();render();}};
function playClip(clip,manual=false){if(!playable(clip)){notice('This highlight is available at the ESPN link.');return;}finishClip();clearGame();state.clip=clip;state.clipManual=manual;state.played.add(clip.id);state.lastClip=Date.now();$('clipVideo').src=clip.mediaUrl;$('clipVideo').hidden=false;startVideo($('clipVideo'));clipTimeout=setTimeout(()=>{if(state.clip){finishClip();render();}},Math.min(120000,Math.max(20000,(clip.duration+15)*1000)));render();}
function stale(){return !state.lastFeed||Date.now()-state.lastFeed>(state.games.some(g=>g.state==='in')?20000:90000);}
function direct(){if(!state.auto)return;if(state.mode==='live'&&stale())return;
 const pick=chooseGame(state.games,saved.roster,state.currentId,state.changedAt,Date.now());
 if(pick){if(state.currentId!==pick.game.id){state.currentId=pick.game.id;state.changedAt=Date.now();}if(pick.urgent&&state.clip&&!state.clipManual)finishClip();}
 if(!pick||!pick.urgent){if(state.quietAt===null)state.quietAt=Date.now();}else state.quietAt=null;
 if($('autoClips').checked&&state.playerStarted&&!state.clip&&(state.mode==='live'||state.running)&&state.quietAt!==null&&Date.now()-state.quietAt>2000&&Date.now()-state.lastClip>(state.mode==='replay'?20000:120000)){
 const clip=state.clips.find(c=>!state.played.has(c.id)&&playable(c)&&c.duration>0&&c.duration<=90);if(clip)playClip(clip);
 }}
function render(){const g=activeGame(),test=state.mode==='replay',players=g?involved(g,saved.roster):[];
 $('replayMode').setAttribute('aria-pressed',test);$('liveMode').setAttribute('aria-pressed',!test);$('autoDirector').checked=state.auto;$('testBar').hidden=!test;
 $('modeCaption').textContent=state.clip?'HIGHLIGHT':test?'REPLAY TEST':g?.state==='in'?'LIVE GAME':'SELECTED GAME';
 $('gameTitle').textContent=state.clip?state.clip.title:g?(test?g.name:g.name.replace(' @ ',' at ')):'No game selected';
 $('reason').textContent=state.clip?'The game returns when this highlight ends.':!g?'Waiting for the NFL slate.':!state.auto?'Pinned to this game. Turn Auto director on to follow the action.':players.length?`${players.map(p=>p.name).join(', ')} · ${players[0].position==='D/ST'?'defense':'offense'} has possession.`:g.statusName==='STATUS_HALFTIME'?'Quiet moment. A highlight can play here.':g.state!=='in'?g.detail:`Roster quiet · ${g.yardsToGoal??'unknown'} yards to the end zone.`;
 $('connectionButton').textContent=saved.teamId?saved.teamName:'Connect roster';$('connectionButton').title=saved.teamName;
 $('teamName').textContent=saved.teamName;$('refreshRoster').hidden=!saved.teamId;$('rosterNote').textContent=saved.teamId?`${saved.roster.length} starters · League ${saved.leagueId}${saved.syncedAt?' · Synced '+new Date(saved.syncedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):''}`:saved.teamName==='Sample roster'?'Import your team above to replace these players.':'Your manually entered starters.';
 $('rosterList').innerHTML=saved.roster.map(p=>`<div class="roster-item ${players.some(a=>a.name===p.name)?'active':''}"><span class="position">${escape(p.position)}</span><div><strong>${escape(p.name)}</strong><small>${escape(p.team)}</small></div></div>`).join('')||'<p class="empty-list">No starters selected. Auto director will follow scoring threats.</p>';
 $('gamesHeading').textContent=test?'Test games':'NFL games';$('feedStatus').textContent=test?'Week 7 replays':state.feedError?'Feed unavailable':!state.lastFeed?'Loading…':stale()?'Stale data':'ESPN';
 $('gameList').innerHTML=state.games.map(game=>`<button class="game" data-game="${escape(game.id)}" aria-pressed="${state.currentId===game.id}"><strong>${escape(test?game.name:game.name)}</strong><span class="game-meta">${test?'Full-game replay · Week 7':escape(game.detail)+' · '+game.teams.map(t=>escape(t.score)).join(' – ')}</span><span class="game-state">${game.id===state.currentId?'Selected':test?'Replay ready':game.redZone?'Red zone':game.state==='in'?'In progress':'Scheduled'}</span></button>`).join('')||'<p class="empty-list">No games available. Replay test works any day.</p>';
 $('clipList').innerHTML=state.clips.slice(0,6).map(c=>`<div class="clip"><button data-clip="${escape(c.id)}">${playable(c)?'▶ ':''}${escape(c.title)}${state.played.has(c.id)?' · Played':''}</button><a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">Watch on ESPN ↗</a></div>`).join('')||'<p class="empty-list">Loading published highlights. Only playable clips enter the automatic queue.</p>';
 $('testStep').textContent=`${state.step+1} of 5`;$('startTest').textContent=state.running?'Pause test':'Start test';
 $('playerNote').hidden=!test;$('sourceLink').hidden=!test||!g;$('playbackNote').hidden=!test;if(test&&g)$('sourceLink').href=g.page;
 loadPlayer();
}
$('gameList').onclick=e=>{const b=e.target.closest('[data-game]');if(!b)return;state.currentId=b.dataset.game;state.auto=false;state.playerStarted=true;finishClip();render();};
$('clipList').onclick=e=>{const b=e.target.closest('[data-clip]');if(b){const c=state.clips.find(x=>x.id===b.dataset.clip);if(c)playClip(c,true);}};
$('autoDirector').onchange=e=>{state.auto=e.target.checked;if(state.auto){finishClip();direct();}render();};
$('autoClips').onchange=e=>{if(!e.target.checked&&state.clip&&!state.clipManual){finishClip();render();}};
function stepTest(next){state.step=next;state.games=scenarios(next);state.quietAt=null;direct();render();}
function scheduleTest(){clearTimeout(testTimer);if(state.running)testTimer=setTimeout(()=>{stepTest((state.step+1)%5);scheduleTest();},18000);}
$('startTest').onclick=()=>{state.running=!state.running;state.playerStarted=true;if(state.running){state.auto=true;direct();}scheduleTest();render();};
$('nextTest').onclick=()=>{state.playerStarted=true;state.auto=true;stepTest((state.step+1)%5);scheduleTest();};
$('restartTest').onclick=()=>{state.auto=true;state.played.clear();state.lastClip=-Infinity;finishClip();stepTest(0);scheduleTest();};
async function json(path,signal){const response=await fetch(BASE+path,{signal,credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'});if(!response.ok)throw new Error('ESPN unavailable');return response.json();}
async function livePoll(generation){if(generation!==state.generation||state.mode!=='live')return;feedController=new AbortController();const timeout=setTimeout(()=>feedController.abort(),8000);try{const games=normalizeScoreboard(await json('scoreboard',feedController.signal));if(generation!==state.generation)return;state.games=games;state.lastFeed=Date.now();state.feedError='';if(!activeGame())state.currentId=games.find(g=>g.state==='in')?.id||games[0]?.id;direct();render();}catch{if(generation===state.generation){state.feedError='Unavailable';$('feedStatus').textContent='Feed unavailable · auto held';}}finally{clearTimeout(timeout);if(generation===state.generation)feedTimer=setTimeout(()=>livePoll(generation),!document.hidden&&state.games.some(g=>g.state==='in')?5000:30000);}}
async function fetchClips(generation){clipController=new AbortController();const timeout=setTimeout(()=>clipController.abort(),15000);try{
 let games=state.games;if(state.mode==='replay'){games=normalizeScoreboard(await json('scoreboard?dates=2026&seasontype=2&week=7',clipController.signal)).filter(g=>g.teams.some(t=>['PHI','IND'].includes(t.abbreviation)));}
 const eligible=games.filter(g=>g.state==='in'||g.state==='post');
 const incoming=[];for(const g of eligible.slice(0,2)){const raw=await json('summary?event='+encodeURIComponent(g.id),clipController.signal);incoming.push(...normalizeHighlights(raw,g).filter(c=>c.kind==='clip'));}
 if(generation!==state.generation)return;state.clips=[...new Map([...state.clips,...incoming].map(c=>[c.id,c])).values()].slice(0,24);render();if(!state.clips.length)$('clipList').innerHTML='<p class="empty-list">No published highlights are available for these games yet.</p>';
 }catch{if(generation===state.generation&&!state.clips.length)$('clipList').innerHTML='<p class="empty-list">Highlights are temporarily unavailable. The game replays are still ready.</p>';}
 finally{clearTimeout(timeout);if(generation===state.generation&&state.mode==='live')clipTimer=setTimeout(()=>fetchClips(generation),30000);}}
function stopNetwork(){clearTimeout(feedTimer);clearTimeout(clipTimer);feedController?.abort();clipController?.abort();}
function mode(name){if(state.mode===name)return;stopNetwork();clearTimeout(testTimer);finishClip();clearGame();state.generation++;state.mode=name;state.running=false;state.playerStarted=false;state.auto=true;state.step=0;state.games=name==='replay'?scenarios(0):[];state.currentId=state.games[0]?.id;state.lastFeed=0;state.clips=[];state.played.clear();state.quietAt=null;state.failedURL='';render();if(name==='live')livePoll(state.generation);fetchClips(state.generation);}
$('replayMode').onclick=()=>mode('replay');$('liveMode').onclick=()=>mode('live');
function openSettings(){const games=state.mode==='live'&&state.games.length?state.games:SOURCES;$('streamInputs').innerHTML=games.map(g=>`<div class="stream-row"><label for="stream-${escape(g.id)}">${escape(g.name)}</label><input id="stream-${escape(g.id)}" data-key="${escape(gameKey(g))}" type="url" value="${escape(saved.streams[gameKey(g)]||'')}" placeholder="https://…/stream.m3u8"></div>`).join('');$('manualRoster').value=saved.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n');$('settingsError').textContent='';$('settingsDialog').showModal();}
$('settingsButton').onclick=openSettings;$('closeSettings').onclick=()=>$('settingsDialog').close();
$('settingsForm').onsubmit=e=>{e.preventDefault();try{const roster=parseRoster($('manualRoster').value),streams={...saved.streams};for(const field of $('streamInputs').querySelectorAll('input'))streams[field.dataset.key]=safeVideo(field.value.trim());const changed=JSON.stringify(roster)!==JSON.stringify(saved.roster.map(({name,team,position})=>({name,team,position})));saved={...saved,roster,streams,...(changed?{teamName:'My roster',teamId:'',leagueId:''}:{})};persist();state.failedURL='';state.loaded='';if(state.mode==='live')state.playerStarted=true;$('settingsDialog').close();direct();render();notice('Settings saved.');}catch(err){$('settingsError').textContent=err.message;}};
setInterval(()=>{if(document.hidden)return;const before=state.currentId,clip=state.clip?.id;if(state.mode==='live'||state.running)direct();if(before!==state.currentId||clip!==state.clip?.id)render();if(state.mode==='live'&&stale())$('feedStatus').textContent=state.lastFeed?'Stale data · auto held':'Connecting…';},1000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(testTimer);else scheduleTest();});
window.addEventListener('pagehide',()=>{stopNetwork();clearTimeout(testTimer);clearTimeout(clipTimeout);clearGame();$('clipVideo').pause();});
window.addEventListener('pageshow',e=>{if(e.persisted){state.generation++;if(state.mode==='live')livePoll(state.generation);fetchClips(state.generation);loadPlayer();scheduleTest();}});
render();fetchClips(state.generation);
// Restore a saved team or import the owner's configured connection on a fresh visit.
// Only the server can advertise a private connection, after checking the signed-in visitor.
async function restoreConnection(){
 try{
  const response=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(5000)});
  if(!response.ok)return;const session=await response.json();
  if(importInFlight)return;
  if(saved.teamId&&saved.leagueId){await importLeague(true);return;}
  if(session.savedLeagueId&&!$('leagueId').value&&saved.teamName==='Sample roster'){
   $('leagueId').value=session.savedLeagueId;await importLeague();
  }
 }catch{/* The form remains available if session discovery is interrupted. */}
}
restoreConnection();
