import {PlayerPool} from './players.js';
import {safeVideo,streamType} from './roster.js';
import {SPORTS,escapeHTML as esc,localDate,normalizeSportGames,normalizeSportPreferences,chooseSportGame,sportMatchup} from './sports-data.js';
const $=id=>document.getElementById(id),requested=new URLSearchParams(location.search).get('sport');
const sport=Object.hasOwn(SPORTS,requested)?requested:'nba',config=SPORTS[sport],storageKey='fantasy-stream-'+sport+'-v1';
let saved;try{saved=normalizeSportPreferences(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{saved=normalizeSportPreferences();}
const S={date:localDate(),gamesLoading:true,gamesError:false,games:[],history:[],season:null,playing:false,current:null,manual:false,lastSwitch:0,blocked:new Map(),filter:false,league:null,leagueError:'',leagueUpdated:0,leaguePending:false,leagueGeneration:0,gameGeneration:0,matchId:'',request:null,gameTimer:null,leagueTimer:null,fullRequest:0,fullWanted:false,rotations:new Map()};
const markup=new Map();function put(id,html){if(markup.get(id)!==html){markup.set(id,html);$(id).innerHTML=html;}}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(saved));$('storageWarning').hidden=true;}catch{$('storageWarning').hidden=false;}}
const pool=new PlayerPool($('layers'),{capacity:2,onReconnect:(key,detail)=>{const active=document.fullscreenElement||document.webkitFullscreenElement;if(key===pool.visible&&active&&active!==document.querySelector('.stage'))document.querySelector('.stage').classList.add('theater');if(detail?.failover)rotateSource(key);},onError:()=>{renderTransport();},onAudioLocked:()=>renderTransport()});
pool.setMuted(saved.muted);
const selectedTeam=()=>S.league?.teams.find(t=>t.id===saved.teamId);
const followed=()=>[...new Set((selectedTeam()?.players||[]).filter(p=>p.active).map(p=>p.teamId))];
const urls=game=>[...new Set([saved.streams[game?.key]?.primary,saved.streams[game?.key]?.backup].filter(Boolean))];
const currentGame=()=>S.games.find(g=>g.id===S.current);
const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2):'—';
function gameTime(g){return g.state==='pre'?new Date(g.date).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):g.detail;}
function renderGuide(){
 const followedIds=followed(),games=S.games.filter(g=>!S.filter||g.teams.some(t=>followedIds.includes(t.id))).slice().sort((a,b)=>({in:0,pre:1,hold:2,post:3}[a.state]-{in:0,pre:1,hold:2,post:3}[b.state])||Date.parse(a.date)-Date.parse(b.date));
 $('gamesHead').textContent=S.date===localDate()?'Today’s games':'Game guide';$('gameCount').textContent=S.games.filter(g=>g.state==='in').length+' live';
 $('allGames').setAttribute('aria-pressed',String(!S.filter));$('myGames').setAttribute('aria-pressed',String(S.filter));
 put('games',games.map(g=>{const available=urls(g).length>0,watching=S.current===g.id,mine=g.teams.some(t=>followedIds.includes(t.id));return `<li class="sport-game-row"><button class="game ${watching?'watching':''}" data-watch="${g.id}" aria-label="${esc(available?'Watch '+g.name:'Add stream for '+g.name)}" aria-pressed="${watching}"><span class="g-status"><span class="tag ${g.state==='in'?'go':'muted'}">${watching?'ON SCREEN':g.state==='in'?'LIVE':g.state==='post'?'FINAL':g.state==='hold'?'DELAYED':'UPCOMING'}</span><span class="g-when">${esc(gameTime(g))}</span></span><span class="g-matchup">${g.teams.map(t=>`<span class="g-team"><span class="team-code">${esc(t.abbr)}</span><span class="team-name">${esc(t.name)}</span><b class="team-score">${g.state==='pre'?'—':t.score??'—'}</b></span>`).join('')}</span><span class="g-footer"><span class="g-names">${mine?'YOUR PLAYERS':available?'STREAM SAVED':config.label}</span><span class="g-cta">${available?'Watch ↗':'Add stream +'}</span></span></button><div class="sport-game-actions"><button data-edit="${g.id}">Edit link</button><a href="https://www.espn.com/${sport}/game/_/gameId/${g.id}" target="_blank" rel="noopener noreferrer">Gamecast ↗</a></div></li>`;}).join('')||`<li class="empty">${S.filter?(selectedTeam()?'None of this team’s starters have a game on this date.':'Connect ESPN and choose a fantasy team to filter its games.'):S.gamesLoading?'Loading '+config.label+' games…':S.gamesError?'Game updates are unavailable. Use Refresh games to try again.':'No '+config.label+' games scheduled for this date. Choose another day above.'}</li>`);
 $('streamSummary').textContent=S.games.filter(g=>urls(g).length).length+' of '+S.games.length+' games have links';
 put('savedStreams',S.games.map(g=>`<div class="sport-link-item"><span>${esc(g.name)}<small>${urls(g).length?'Stream saved'+(urls(g).length>1?' · Backup ready':''):'No stream linked'}</small></span><button data-edit="${g.id}">${urls(g).length?'Edit':'Add'} link</button></div>`).join('')||'<p class="muted">Choose a date with scheduled games to add stream links.</p>');
}
function selectGame(id,{manual=true,url=null}={}){
 const game=S.games.find(g=>g.id===id);if(!game)return;const source=url||urls(game)[0];if(!source){openStream(id);return;}
 if(S.current!==id){S.lastSwitch=Date.now();S.manual=manual;}else if(manual)S.manual=true;
 const slot=pool.get(id);if(!slot||slot.url!==source){pool.open(id,{url:source,type:streamType(source),live:true,autoReconnect:saved.autoReconnect});}
 S.current=id;S.playing=true;pool.setRunning(true,{resumeVisible:false});pool.show(id);$('overlay').hidden=true;renderGuide();renderTransport();
}
function setPlaying(on){S.playing=on;pool.setRunning(on);if(on&&!pool.current)direct();renderTransport();}
function direct(){
 if(!S.playing||!saved.auto&&pool.current)return;
 const cutoff=Date.now()-saved.delay*1000,delayed=S.history.filter(h=>h.at<=cutoff).at(-1)||S.history[0];
 const games=delayed?.games||S.games,blocked=new Set([...S.blocked].filter(([,until])=>until>Date.now()).map(([id])=>id));
 const choice=chooseSportGame(games,{streams:saved.streams,followed:followed(),currentId:S.current,manual:S.manual,blocked,lastSwitch:S.lastSwitch});
 if(choice&&choice.id!==S.current)selectGame(choice.id,{manual:false});
 // Keep the current source through a data outage or an empty slate. A stale
 // scoreboard never tears down a working video or returns the viewer home.
}
function renderTransport(){
 const p=pool.current,g=currentGame(),embed=p?.kind==='embed',slot=pool.get(S.current),stage=document.querySelector('.stage');
 $('playButton').textContent=S.playing?'Pause':'Play';$('playButton').setAttribute('aria-label',S.playing?'Pause':'Play');
 $('muteButton').textContent=saved.muted?'Turn sound on':'Mute sound';$('reloadStream').hidden=!p;$('nextStream').hidden=!g||urls(g).length<2;$('nextStream').disabled=!S.playing;
 $('openStream').hidden=!embed;$('openStream').href=embed?slot.url:'#';$('embedHelp').hidden=!embed;
 $('watchTitle').textContent=g?.name||config.name+' channel';$('channelMode').textContent=g?.detail||config.label+' LIVE';$('pictureNote').textContent=saved.delay+' sec stream delay';
 $('autoMode').textContent='Auto · '+(saved.auto?'On':'Off');$('autoMode').setAttribute('aria-pressed',String(saved.auto));
 $('watchStatus').textContent=!p?(S.playing?'Waiting for a live game with a saved stream.':'Add a stream to begin. No broadcast is supplied.'):!S.playing?'Paused · recovery waits until you resume.':S.manual?'Your choice · Auto resumes at a reported break.':selectedTeam()?'Following '+selectedTeam().name+' at game breaks.':'Following available games at reported breaks.';
 $('streamHealth').hidden=!p?.reconnecting;$('streamHealth').textContent=p?.recoveryMessage||'';
 $('unmute').hidden=!p?.audioLocked||saved.muted||!S.playing;
 $('fullButton').textContent=document.fullscreenElement||document.webkitFullscreenElement||stage.classList.contains('theater')?'Exit full screen':'Full screen';
 if(!p){$('overlay').hidden=false;$('ovTitle').textContent=S.games.length?'Every game. Your way.':S.gamesLoading?'Getting your games ready…':S.gamesError?'Game updates are unavailable.':'No games on this date.';$('ovText').textContent=S.games.length?'Choose a game from the guide and add your stream. Connect ESPN to follow your fantasy players.':S.gamesLoading?'Connecting to ESPN for this day’s schedule.':S.gamesError?'Your streams and fantasy connection are saved. Refresh the guide to retry.':'Use the date picker to browse another day. Your saved streams and fantasy connection stay here.';$('addFirstStream').hidden=!S.games.length;}
}
function openStream(id){
 if(!S.games.length){$('scheduleStatus').textContent='Choose a date with scheduled games first.';return;}
 put('streamGame',S.games.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join(''));$('streamGame').value=id||S.current||S.games[0].id;fillStream();$('streamError').textContent='';$('streamDialog').showModal();
}
function fillStream(){const g=S.games.find(g=>g.id===$('streamGame').value),links=saved.streams[g?.key]||{};$('streamURL').value=links.primary||'';$('backupURL').value=links.backup||'';}
$('streamGame').onchange=fillStream;$('closeStream').onclick=()=>$('streamDialog').close();
$('streamForm').onsubmit=event=>{event.preventDefault();try{const g=S.games.find(g=>g.id===$('streamGame').value);if(!g)throw new Error('This game is no longer listed.');const primary=safeVideo($('streamURL').value.trim()),backup=safeVideo($('backupURL').value.trim());saved.streams[g.key]={primary,backup};persist();$('streamDialog').close();if(S.current===g.id){const old=pool.get(g.id);if(![primary,backup].includes(old?.url)){pool.close(g.id);if(primary||backup){if(S.playing)selectGame(g.id);else S.current=null;}else S.current=null;}}renderGuide();renderTransport();}catch(error){$('streamError').textContent=error.message;}};
for(const id of ['games','savedStreams'])$(id).onclick=event=>{const edit=event.target.closest('[data-edit]'),watch=event.target.closest('[data-watch]');if(edit)openStream(edit.dataset.edit);else if(watch)selectGame(watch.dataset.watch);};
$('addFirstStream').onclick=()=>openStream();$('playButton').onclick=()=>setPlaying(!S.playing);$('reloadStream').onclick=()=>{if(S.playing)pool.current?.reload?.();};
function rotateSource(id,manual=false){if(!S.playing||id!==S.current||!manual&&Date.now()<(S.rotations.get(id)||0))return;const g=currentGame(),alternate=urls(g).find(url=>url!==pool.get(id)?.url);if(!g||!alternate)return;S.rotations.set(id,Date.now()+60000);selectGame(g.id,{url:alternate,manual:S.manual});}
$('nextStream').onclick=()=>rotateSource(S.current,true);
$('muteButton').onclick=()=>{saved.muted=!saved.muted;pool.setMuted(saved.muted);if(!saved.muted)pool.retryAudio();persist();renderTransport();};$('unmute').onclick=()=>{saved.muted=false;pool.setMuted(false);pool.retryAudio();persist();renderTransport();};
$('autoMode').onclick=()=>{saved.auto=!saved.auto;S.manual=false;persist();direct();renderTransport();};
$('allGames').onclick=()=>{S.filter=false;renderGuide();};$('myGames').onclick=()=>{S.filter=true;renderGuide();};
async function loadGames(){
 const generation=++S.gameGeneration,date=S.date;clearTimeout(S.gameTimer);S.request?.abort();const controller=new AbortController();S.request=controller;const timeout=setTimeout(()=>controller.abort(),15000);
 S.gamesLoading=true;S.gamesError=false;$('scheduleStatus').textContent='Refreshing '+config.label+' games…';renderTransport();
 try{const r=await fetch('/api/sports?sport='+sport+'&date='+date,{signal:controller.signal,cache:'no-store'}),data=await r.json();if(generation!==S.gameGeneration)return;if(!r.ok)throw new Error(data.error||'Game feed unavailable');if(data.sport!==sport||data.date!==date)throw new Error('Unexpected schedule response');S.gamesError=false;S.gamesLoading=false;S.games=normalizeSportGames(data,sport);S.season=data.season||S.season;S.history.push({at:Date.now(),games:S.games});S.history=S.history.filter(h=>Date.now()-h.at<660000);$('scheduleStatus').textContent=S.games.length+' games · Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});renderGuide();direct();renderTransport();}
 catch(error){if(generation===S.gameGeneration){S.gamesError=true;S.gamesLoading=false;$('scheduleStatus').textContent='Game updates delayed · '+(S.games.length?'Showing last update. ':'')+'Retrying automatically.';renderGuide();renderTransport();}}
 finally{clearTimeout(timeout);if(generation===S.gameGeneration){S.request=null;S.gameTimer=setTimeout(loadGames,S.games.some(g=>g.state==='in')?15000:60000);}}
}
function changeDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))return;S.date=value;$('gameDate').value=value;S.history=[];S.games=[];renderGuide();loadGames();}
$('gameDate').onchange=event=>changeDate(event.target.value);
for(const [id,offset] of [['previousDay',-1],['nextDay',1]])$(id).onclick=()=>{const date=new Date(S.date+'T12:00:00');date.setDate(date.getDate()+offset);changeDate(localDate(date));};
$('today').onclick=()=>changeDate(localDate());$('refreshGames').onclick=loadGames;
function openLeague(){
 $('leagueId').value=saved.leagueId;$('swid').value=saved.swid;$('s2').value=saved.s2;$('leagueSeason').value=saved.leagueSeason||S.season||(sport==='mlb'?new Date().getFullYear():new Date().getFullYear()+(new Date().getMonth()>=6?1:0));$('leagueTitle').textContent='Connect ESPN '+config.name;$('leagueError').textContent='';$('leagueDialog').showModal();
}
$('connectFirst').onclick=openLeague;$('connectLeague').onclick=openLeague;$('closeLeague').onclick=()=>$('leagueDialog').close();
$('leagueForm').onsubmit=async event=>{event.preventDefault();const input={leagueId:$('leagueId').value.trim(),swid:$('swid').value.trim(),s2:$('s2').value.trim(),season:Number($('leagueSeason').value)};await loadLeague(input);};
async function loadLeague(input=null){
 if(!input&&!saved.leagueId)return;const explicit=!!input;input||={leagueId:saved.leagueId,swid:saved.swid,s2:saved.s2,season:saved.leagueSeason||S.season||(sport==='mlb'?new Date().getFullYear():new Date().getFullYear()+(new Date().getMonth()>=6?1:0))};
 const generation=++S.leagueGeneration;clearTimeout(S.leagueTimer);S.leaguePending=true;$('importLeague').disabled=true;$('leagueError').textContent='';renderFantasy();
 try{const r=await fetch('/api/sports/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,sport}),signal:AbortSignal.timeout(30000),cache:'no-store'}),data=await r.json();if(generation!==S.leagueGeneration)return;if(!r.ok){if(r.status===401)$('privateLeague').open=true;throw new Error(data.error||'Could not load this league.');}if(data.leagueId!==input.leagueId||data.sport!==sport||!Array.isArray(data.teams))throw new Error('Unexpected league response.');
  const previous=saved.leagueId===input.leagueId?saved.teamId:'';S.league=data;S.leagueError='';S.leagueUpdated=Date.now();saved.leagueId=input.leagueId;saved.swid=input.swid;saved.s2=input.s2;saved.leagueSeason=input.season;saved.teamId=data.teams.find(t=>t.id===previous)?.id||data.teams.find(t=>t.id===data.ownedTeamId)?.id||'';persist();if(explicit)$('leagueDialog').close();renderGuide();
 }catch(error){if(generation===S.leagueGeneration){S.leagueError=error.message;$('leagueError').textContent=error.message;}}
 finally{if(generation===S.leagueGeneration){S.leaguePending=false;$('importLeague').disabled=false;renderFantasy();if(saved.leagueId)S.leagueTimer=setTimeout(()=>loadLeague(),30000);}}
}
function renderFantasy(){
 const league=S.league,match=sportMatchup(league,saved.teamId,S.matchId);$('scoreTeam').disabled=!league?.teams.length;
 put('scoreTeam','<option value="">'+(league?'Choose your team…':'Connect ESPN to choose a team')+'</option>'+(league?.teams||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''));$('scoreTeam').value=saved.teamId;
 $('connectLeague').textContent=saved.leagueId?'ESPN connection':'Connect ESPN';$('retryFantasy').hidden=!S.leagueError;$('retryFantasy').disabled=S.leaguePending;
 $('leagueMeta').textContent=league?league.name+' · '+league.season+' · '+(league.isPoints?'Points league':league.scoringType==='ROTO'?'Rotisserie league':'Category league'):'ESPN fantasy '+config.name.toLowerCase();
 $('fantasyStatus').textContent=S.leagueError?(S.leagueUpdated?'Last good update '+new Date(S.leagueUpdated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'. ':'')+S.leagueError:S.leaguePending?'Getting your league from ESPN…':!league?'Connect a league to see players and your matchup.':!saved.teamId?'Choose your fantasy team above.':'Updated '+new Date(S.leagueUpdated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · Every 30 seconds';
 $('fantasyStatus').classList.toggle('sport-error',!!S.leagueError);
 const matches=match?.matches||[];$('matchupPicker').hidden=matches.length<2;put('matchupSelect',matches.map(m=>{const other=m.home?.teamId===saved.teamId?m.away:m.home;return `<option value="${esc(m.id)}">${esc(league.teams.find(t=>t.id===other?.teamId)?.name||'Bye')}</option>`;}).join(''));$('matchupSelect').value=match?.matchId||'';
 let status='Your team vs. your opponent';if(match){if(!match.opponent)status=league.scoringType==='ROTO'?'Season standings on ESPN':'No opponent for this matchup';else if(league.isPoints&&match.yourPoints!==null&&match.opponentPoints!==null){const diff=match.yourPoints-match.opponentPoints;status=diff===0?'Tied':(diff>0?'Ahead by ':'Behind by ')+fmt(Math.abs(diff));}else status=league.isPoints?'Matchup points':'Category matchup';}$('matchupStatus').textContent=status;
 const teamHTML=(team,total,opponent)=>`<section class="fantasy-board ${opponent?'opponent-fantasy':'your-fantasy'}"><span class="eyebrow">${opponent?'OPPONENT':'FOLLOWING'}</span><h3>${esc(team?.name||'No opponent scheduled')}</h3><div class="sb-total"><strong>${league.isPoints?fmt(total):'—'}</strong><span>${league.isPoints?'MATCHUP POINTS':'CATEGORY LEAGUE'}<small>${league.isPoints?'Official ESPN total':'See full categories on ESPN'}</small></span></div>${team?`<table class="sport-score-table"><thead><tr><th>Slot</th><th>Player</th><th>${league.isPoints?'DAY PTS':'Status'}</th></tr></thead><tbody>${team.players.slice().sort((a,b)=>Number(b.active)-Number(a.active)).map(p=>`<tr class="${p.active?'':'reserve'}"><td>${esc(p.slot)}</td><th scope="row">${esc(p.name)}<small>${esc(p.team||'Free agent')} · ${esc(p.position)}${p.injury?' · '+esc(p.injury):''}</small></th><td>${league.isPoints?fmt(p.points):p.active?'Active':'Reserve'}</td></tr>`).join('')}</tbody></table>`:'<p class="sb-caption">Your roster remains available on the left.</p>'}</section>`;
 put('fantasyBoard',match?'<div class="score-center-body matchup-board">'+teamHTML(match.yours,match.yourPoints,false)+teamHTML(match.opponent,match.opponentPoints,true)+'</div>':'<div class="sport-empty"><strong>'+(league?'Choose a team to follow.':'Bring your fantasy team into the game.')+'</strong>'+(league?'Switch between any franchise without losing your saved streams.':'Connect your ESPN league to see your roster, opponent and official matchup totals here.')+'</div>');
 $('fantasyNote').hidden=!match;if(match){const href=`https://fantasy.espn.com/${config.fantasy}/team?leagueId=${saved.leagueId}&teamId=${saved.teamId}&seasonId=${league.season}`;$('fantasyNote').innerHTML=(league.isPoints?'Player rows show scoring day '+league.scoringPeriod+'. Matchup totals include the full ESPN matchup; bench points do not add to your score. Missing stats show —.':'This league uses categories or rotisserie scoring; we do not convert them into invented fantasy points.')+` <a href="${href}" target="_blank" rel="noopener noreferrer">Open on ESPN ↗</a>`;}
}
$('scoreTeam').onchange=event=>{if(!S.league?.teams.some(t=>t.id===event.target.value))return;saved.teamId=event.target.value;S.matchId='';persist();renderFantasy();renderGuide();};$('matchupSelect').onchange=event=>{S.matchId=event.target.value;renderFantasy();};$('retryFantasy').onclick=()=>{if(saved.leagueId)loadLeague();else openLeague();};
$('settingsButton').onclick=()=>$('settings').showModal();$('closeSettings').onclick=()=>$('settings').close();$('autoReconnect').checked=saved.autoReconnect;$('delay').value=saved.delay;
$('autoReconnect').onchange=event=>{saved.autoReconnect=event.target.checked;for(const slot of pool.slots.values())slot.player.setAutoReconnect?.(saved.autoReconnect);persist();};$('delay').onchange=event=>{saved.delay=Math.max(0,Math.min(600,Number(event.target.value)||0));event.target.value=saved.delay;persist();renderTransport();};
$('fullButton').onclick=async()=>{const stage=document.querySelector('.stage'),active=document.fullscreenElement||document.webkitFullscreenElement,request=++S.fullRequest;if(active||stage.classList.contains('theater')||S.fullWanted){S.fullWanted=false;stage.classList.remove('theater');try{if(active)await(document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen());}catch{}renderTransport();return;}S.fullWanted=true;stage.classList.add('theater');renderTransport();try{const fn=stage.requestFullscreen||stage.webkitRequestFullscreen;if(fn)await fn.call(stage,{navigationUI:'hide'});if(request!==S.fullRequest&&!S.fullWanted&&document.fullscreenElement===stage)await document.exitFullscreen();}catch{}renderTransport();};
for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,()=>{const stage=document.querySelector('.stage');if(document.fullscreenElement||document.webkitFullscreenElement)stage.classList.remove('theater');else if(!stage.classList.contains('theater'))S.fullWanted=false;renderTransport();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){S.fullWanted=false;S.fullRequest++;document.querySelector('.stage').classList.remove('theater');renderTransport();}});
window.addEventListener('pagehide',()=>{S.playing=false;pool.destroy();clearTimeout(S.gameTimer);clearTimeout(S.leagueTimer);S.request?.abort();});
function tick(){if(S.playing){pool.current?.checkHealth?.({active:pool.visible===S.current,online:navigator.onLine!==false,foreground:document.visibilityState!=='hidden'});if(document.visibilityState!=='hidden')direct();}renderTransport();}
for(const a of document.querySelectorAll('[data-sport]'))if(a.dataset.sport===sport)a.setAttribute('aria-current','page');
document.title='Fantasy Stream · '+config.label;$('sportTitle').textContent=config.name;$('gameDate').value=S.date;
renderGuide();renderFantasy();renderTransport();loadGames();if(saved.leagueId)loadLeague();
setInterval(tick,1000);
