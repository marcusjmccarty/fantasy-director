import {normalizeScoreboard} from './adapters.js';
import {normalizeHighlights,playable,relevance} from './highlights.js';
import {SAMPLE_ROSTER,involved,chooseGame,parseRoster,safeVideo,gameKey,simulation} from './director.js';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const BASE='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
let settings={roster:SAMPLE_ROSTER,streams:{},highlight:'',custom:false};
try{const stored=JSON.parse(localStorage.getItem('fantasy-director-web-v1')||'null');if(stored){settings={roster:parseRoster(stored.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n')),streams:Object.fromEntries(Object.entries(stored.streams||{}).map(([key,url])=>[key,safeVideo(url)])),highlight:safeVideo(stored.highlight||''),custom:true};}}catch{}
const state={mode:'test',auto:true,autoHighlights:true,seconds:0,paused:false,games:simulation(0),currentId:'test-0',changedAt:0,clips:[],seen:new Set(),replay:null,replayManual:false,quietSince:null,lastReplay:-Infinity,muted:true,loaded:'',failedUrl:'',lastFeed:0,feedError:'',highlightError:'',generation:0,summaryIndex:0};
const testClips=[{id:'sample-1',title:'A drive to the end zone',gameName:'CHI @ GB',mediaUrl:'assets/rehearsal.webm',duration:6,sample:true},{id:'sample-2',title:'A little room to run',gameName:'IND @ HOU',mediaUrl:'assets/rehearsal.webm',duration:6,sample:true},{id:'sample-3',title:'Inside the red zone',gameName:'SEA @ SF',mediaUrl:'assets/rehearsal.webm',duration:6,sample:true}];
state.clips=[...testClips];
let feedTimer,summaryTimer,feedAbort,summaryAbort,replayTimeout,noticeTimeout,lastTick=performance.now();
const stale=()=>!state.lastFeed||Date.now()-state.lastFeed>(state.games.some(g=>g.state==='in')?20000:90000);
const roster=()=>state.mode==='test'?SAMPLE_ROSTER:settings.roster;
const current=()=>state.games.find(g=>g.id===state.currentId);
function notify(message){$('notice').textContent=message;$('notice').hidden=false;clearTimeout(noticeTimeout);noticeTimeout=setTimeout(()=>$('notice').hidden=true,5000);}
function compatible(url){return !/\.m3u8(?:\?|$)/i.test(url)||!!$('liveVideo').canPlayType('application/vnd.apple.mpegurl');}
function unload(video){video.pause();video.removeAttribute('src');video.load();video.hidden=true;}
function showSetup(){
 $('rosterInput').value=settings.roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n');$('customHighlight').value=settings.highlight;$('setupError').textContent='';
 const games=state.games.length?state.games:simulation(0);
 $('streamFields').innerHTML=games.map(g=>`<div class="stream-field"><label for="url-${esc(g.id)}">${esc(g.name)}</label><input type="url" id="url-${esc(g.id)}" data-key="${esc(gameKey(g))}" value="${esc(settings.streams[gameKey(g)]||'')}" placeholder="https://…/stream.mp4" aria-label="${esc(g.name)} video URL"></div>`).join('');
 $('setupDialog').showModal();
}
$('setupButton').onclick=showSetup;$('connectButton').onclick=showSetup;$('editRoster').onclick=showSetup;$('closeSetup').onclick=()=>$('setupDialog').close();
$('setupDialog').onclick=e=>{if(e.target===$('setupDialog')&&e.offsetX>=0&&e.offsetY>=0){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}};
$('setupForm').onsubmit=e=>{e.preventDefault();try{
 const newSettings={...settings,roster:parseRoster($('rosterInput').value),streams:{...settings.streams},highlight:safeVideo($('customHighlight').value.trim()),custom:true};
 for(const input of $('streamFields').querySelectorAll('input'))newSettings.streams[input.dataset.key]=safeVideo(input.value.trim());
 try{localStorage.setItem('fantasy-director-web-v1',JSON.stringify(newSettings));}catch{notify('Setup applied for this visit; browser storage is unavailable.');}
 settings=newSettings;$('setupDialog').close();state.loaded='';state.failedUrl='';if(state.mode==='live'){addCustomClip();direct();}render();notify(state.mode==='test'?'Setup saved for Live mode. Test Sunday uses its sample roster.':'Setup saved.');
 }catch(err){$('setupError').textContent=err.message;}};
$('clearSetup').onclick=()=>{settings={roster:[],streams:{},highlight:'',custom:true};try{localStorage.removeItem('fantasy-director-web-v1');}catch{}$('rosterInput').value='';$('customHighlight').value='';for(const input of $('streamFields').querySelectorAll('input'))input.value='';state.loaded='';if(state.mode==='live'){stopReplay();state.clips=state.clips.filter(c=>!c.custom);direct();render();}notify('Setup reset.');};
function addCustomClip(){state.clips=state.clips.filter(c=>!c.custom);if(settings.highlight)state.clips.unshift({id:'custom:'+settings.highlight,title:'Your highlight',gameName:'CUSTOM REPLAY',mediaUrl:settings.highlight,duration:0,custom:true});}
function direct(){
 if(state.mode==='live'&&stale()){if(state.replay&&!state.replayManual)stopReplay();return;}
 const pick=chooseGame(state.games,roster(),state.currentId,state.changedAt,Date.now());
 if(state.auto&&pick){if(state.currentId!==pick.game.id){state.currentId=pick.game.id;state.changedAt=Date.now();}if(state.replay&&!state.replayManual&&pick.urgent)stopReplay();}
 const quiet=!pick||!pick.urgent;
 if(!quiet)state.quietSince=null;else if(state.quietSince===null)state.quietSince=Date.now();
 const cooldown=state.mode==='test'?10000:120000;
 if(state.auto&&state.autoHighlights&&!state.replay&&quiet&&state.quietSince!==null&&Date.now()-state.quietSince>=2000&&Date.now()-state.lastReplay>=cooldown){
 const clip=state.clips.find(c=>!state.seen.has(c.id)&&c.mediaUrl&&(c.sample||c.custom||playable(c))&&c.duration<=90&&compatible(c.mediaUrl));
 if(clip)playClip(clip,false);
 }
}
async function playVideo(video){video.muted=state.muted;try{await video.play();$('playPrompt').hidden=true;}catch{$('playPrompt').hidden=false;}}
function setStage(){
 const g=current();const test=state.mode==='test';
 $('fieldScene').hidden=!test||!!state.replay;$('replayVideo').hidden=!state.replay;$('returnButton').hidden=!state.replay;
 if(state.replay){$('liveVideo').pause();$('liveVideo').hidden=true;$('emptyPlayer').hidden=true;$('playerBadge').textContent='REPLAY';$('playerClock').textContent=state.replay.sample?'SAMPLE CLIP':state.replay.gameName;return;}
 $('playerBadge').textContent=test?'TEST SUNDAY':'LIVE MODE';$('playerClock').textContent=g?g.detail:'WAITING FOR GAMES';
 if(test){unloadLive();$('emptyPlayer').hidden=true;if(g){$('endA').textContent=g.teams[0].abbreviation;$('endB').textContent=g.teams[1].abbreviation;const x=8+.84*(100-(g.yardsToGoal??50));$('playMarker').style.left=x+'%';$('scrimmage').style.left=x+'%';}return;}
 const url=g&&settings.streams[gameKey(g)];
 if(!url){unloadLive();$('emptyPlayer').hidden=false;$('emptyTitle').textContent=g?`${g.name.replace(' @ ',' at ')}`:'Your next game goes here.';$('emptyText').textContent=g?'Connect a compatible video URL to watch this game here. Game selection works independently of video.':'The live NFL slate will appear here when available.';return;}
 if(url===state.failedUrl){$('emptyPlayer').hidden=false;$('liveVideo').hidden=true;$('emptyTitle').textContent='Stream unavailable';$('emptyText').textContent='The video may have expired or require provider-specific playback. Check the URL in Setup.';return;}
 if(!compatible(url)){unloadLive();$('emptyPlayer').hidden=false;$('emptyTitle').textContent='This browser cannot play this HLS stream.';$('emptyText').textContent='Try Safari, or use a compatible MP4 / WebM source in Setup.';return;}
 $('emptyPlayer').hidden=true;$('liveVideo').hidden=false;
 if(state.loaded!==url){state.loaded=url;$('liveVideo').src=url;playVideo($('liveVideo'));}
}
function unloadLive(){if(state.loaded){unload($('liveVideo'));state.loaded='';}else $('liveVideo').hidden=true;}
function playClip(clip,manual=true){if(!clip.mediaUrl||(!clip.sample&&!clip.custom&&!playable(clip))){notify('This clip is available through its ESPN link.');return;}
 if(!compatible(clip.mediaUrl)){notify('This HLS replay needs a browser with native HLS support, such as Safari.');return;}
 clearTimeout(replayTimeout);state.replay=clip;state.replayManual=manual;state.seen.add(clip.id);state.lastReplay=Date.now();$('replayVideo').src=clip.mediaUrl;$('replayVideo').hidden=false;playVideo($('replayVideo'));replayTimeout=setTimeout(()=>{notify('Replay timed out. Returning to the game.');stopReplay();render();},Math.min(120,Math.max(20,(clip.duration||90)+15))*1000);render();}
function stopReplay(){clearTimeout(replayTimeout);if(!state.replay)return;state.replay=null;unload($('replayVideo'));$('playPrompt').hidden=true;if(state.loaded)playVideo($('liveVideo'));}
$('replayVideo').onended=()=>{stopReplay();render();};$('replayVideo').onerror=()=>{if(state.replay){notify('Replay unavailable. Returning to the game.');stopReplay();render();}};
$('liveVideo').onerror=()=>{if(state.loaded){state.failedUrl=state.loaded;notify('This stream could not play. Check its URL and access in Setup.');$('playPrompt').hidden=true;$('emptyPlayer').hidden=false;$('emptyTitle').textContent='Stream unavailable';$('emptyText').textContent='The video may have expired or require provider-specific playback. Check the URL in Setup.';}};
$('returnButton').onclick=()=>{stopReplay();render();};
$('playButton').onclick=()=>playVideo(state.replay?$('replayVideo'):$('liveVideo'));
$('soundButton').onclick=()=>{state.muted=!state.muted;$('liveVideo').muted=state.muted;$('replayVideo').muted=state.muted;$('soundButton').textContent=state.muted?'Sound off':'Sound on';$('soundButton').setAttribute('aria-label',state.muted?'Enable sound':'Mute sound');};
$('fullscreenButton').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('stage').requestFullscreen)await $('stage').requestFullscreen();else notify('Use your browser’s fullscreen control.');}catch{notify('Fullscreen is unavailable in this preview.');}};
$('autoButton').onclick=()=>{state.auto=!state.auto;if(state.auto){stopReplay();direct();}render();};$('autoHighlights').onchange=e=>{state.autoHighlights=e.target.checked;if(!state.autoHighlights&&state.replay&&!state.replayManual){stopReplay();render();}};
function render(){
 const g=current(),test=state.mode==='test',players=g?involved(g,roster()):[],pick=chooseGame(state.games,roster(),state.currentId,state.changedAt,Date.now());
 $('nowLabel').textContent=state.replay?'NOW REPLAYING':test||g&&settings.streams[gameKey(g)]?'NOW WATCHING':'SELECTED GAME';
 $('nowGame').innerHTML=state.replay?esc(state.replay.title):g?`${esc(g.teams[0].abbreviation)} <span>at</span> ${esc(g.teams[1].abbreviation)}`:'No game selected';
 $('nowScore').textContent=state.replay?'':g?`${g.teams[0].score} — ${g.teams[1].score}`:'';
 $('reason').textContent=state.replay?'Return to live action when this replay ends.':!g?'Waiting for the game slate.':!state.auto?'Pinned to this game. Resume Auto director to follow the action.':players.length?`${players.map(p=>p.name).join(', ')} · ${players[0].position==='D/ST'?'defense':'offense'} has possession.`:g.state!=='in'?g.detail:pick?.game.id===g.id&&g.yardsToGoal!==null?`Roster quiet · ${g.yardsToGoal} yards from the end zone.`:'A quiet moment around the league.';
 $('autoButton').setAttribute('aria-pressed',String(state.auto));$('autoButton').innerHTML=`<span class="dot"></span>${state.auto?'Auto director':'Resume auto'}`;
 $('directorDetail').textContent=state.replay?'Replay in progress':!state.auto?'Game pinned':players.length?'Following your roster':pick?'Closest scoring threat':'Waiting for action';
 $('rosterKind').textContent=test||!settings.custom?'/ SAMPLE':'/ STARTERS';
 const active=new Set(players.map(p=>p.name));$('roster').innerHTML=roster().length?roster().map(p=>`<span class="roster-player ${active.has(p.name)?'active':''}"><small>${esc(p.position)}</small>${esc(p.name)}</span>`).join(''):'<span class="hint">Add starters in Setup. Following scoring threats.</span>';
 $('slateMeta').textContent=`${state.games.length} ${test?'SIMULATED GAMES':'GAMES'}`;
 $('games').innerHTML=state.games.length?state.games.map(game=>`<button class="game-card ${game.id===state.currentId?'current':''}" data-game="${esc(game.id)}" aria-label="Watch ${esc(game.name)}" aria-pressed="${game.id===state.currentId}"><div class="game-top"><span>${game.id===state.currentId?(test||settings.streams[gameKey(game)]?'● WATCHING':'● SELECTED'):esc(game.detail)}</span><span>${game.redZone?'RED ZONE':involved(game,roster()).length?'MY ROSTER':''}</span></div>${game.teams.map(t=>`<div class="team-score"><span>${esc(t.abbreviation)}${game.possession===t.id?'<span class="possession">◂</span>':''}</span><span>${esc(t.score)}</span></div>`).join('')}<div class="game-detail">${esc(game.downDistance||game.detail)}${game.yardsToGoal!==null?' · '+game.yardsToGoal+' YDS TO GOAL':''}</div></button>`).join(''):'<div class="no-content">No games available yet. Test Sunday works any day of the week.</div>';
 $('highlights').innerHTML=state.clips.length?state.clips.slice(0,6).map(c=>`<div><button class="highlight-card" data-clip="${esc(c.id)}"><span class="highlight-thumb">${state.replay?.id===c.id?'Ⅱ':'▶'}</span><span><strong>${esc(c.title)}</strong><small>${c.sample?'SAMPLE · ':''}${esc(c.gameName)} · ${state.seen.has(c.id)?'PLAYED':c.duration?c.duration+' SEC':'REPLAY'}</small></span></button>${c.url?`<a class="text-button" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">Watch on ESPN ↗</a>`:''}</div>`).join(''):`<div class="no-content">${state.highlightError||'Published highlights will appear here when available.'}</div>`;
 $('highlightNote').textContent=test?'Sample replays play during quiet moments. Priority live action brings you back.':'Playable clips queue automatically during quiet moments. Some highlights are only available on ESPN.';
 $('sessionTitle').textContent=test?'Sunday, on your terms.':'Your personal game day.';
 $('testControls').hidden=!test;$('testMode').classList.toggle('selected',test);$('liveMode').classList.toggle('selected',!test);$('testMode').setAttribute('aria-pressed',test);$('liveMode').setAttribute('aria-pressed',!test);renderStatus();setStage();
}
function renderStatus(){const test=state.mode==='test';$('feedStatus').textContent=test?'SIMULATED GAMES':state.feedError?'FEED UNAVAILABLE · AUTO HELD':!state.lastFeed?'CONNECTING TO ESPN':stale()?'STALE FEED · AUTO HELD':`ESPN · CHECKED ${Math.floor((Date.now()-state.lastFeed)/1000)}S AGO`;$('testTime').textContent=`${String(Math.floor(state.seconds/60)).padStart(2,'0')}:${String(Math.floor(state.seconds%60)).padStart(2,'0')} / 01:12`;$('pauseTest').textContent=state.paused?'▶ Play':'Ⅱ Pause';$('pauseTest').setAttribute('aria-label',state.paused?'Resume simulation':'Pause simulation');}
$('games').onclick=e=>{const b=e.target.closest('[data-game]');if(!b)return;state.auto=false;state.currentId=b.dataset.game;stopReplay();render();};
$('highlights').onclick=e=>{const b=e.target.closest('[data-clip]');if(!b)return;const c=state.clips.find(c=>c.id===b.dataset.clip);if(c)playClip(c);};
function stopNetwork(){clearTimeout(feedTimer);clearTimeout(summaryTimer);feedAbort?.abort();summaryAbort?.abort();}
async function getJSON(path,signal){const response=await fetch(BASE+path,{signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw new Error('ESPN temporarily unavailable');return response.json();}
async function pollFeed(generation){
 if(generation!==state.generation||state.mode!=='live')return;feedAbort=new AbortController();const timeout=setTimeout(()=>feedAbort?.abort(),8000);
 try{const games=normalizeScoreboard(await getJSON('scoreboard',feedAbort.signal));if(generation!==state.generation)return;state.games=games;state.lastFeed=Date.now();state.feedError='';if(!current())state.currentId=games.find(g=>g.state==='in')?.id||games[0]?.id||null;direct();render();}
 catch{if(generation===state.generation){state.feedError='ESPN feed unavailable';renderStatus();}}
 finally{clearTimeout(timeout);if(generation===state.generation)feedTimer=setTimeout(()=>pollFeed(generation),document.hidden?30000:state.games.some(g=>g.state==='in')?5000:30000);}
}
async function pollHighlights(generation){
 if(generation!==state.generation||state.mode!=='live')return;
 const candidates=state.games.filter(g=>g.state==='in'||g.state==='post');
 if(candidates.length){summaryAbort=new AbortController();const timeout=setTimeout(()=>summaryAbort?.abort(),8000);try{
 const game=candidates[state.summaryIndex++%candidates.length],raw=await getJSON('summary?event='+encodeURIComponent(game.id),summaryAbort.signal);if(generation!==state.generation)return;
 const incoming=normalizeHighlights(raw,game).filter(c=>c.kind==='clip');const merged=new Map(state.clips.map(c=>[c.id,c]));for(const c of incoming)merged.set(c.id,c);
 const rs=roster().map(p=>({...p,id:'',teamId:state.games.flatMap(g=>g.teams).find(t=>t.abbreviation===p.team)?.id||''}));
 state.clips=[...merged.values()].sort((a,b)=>{const rank=c=>({player:0,team:1,league:2}[relevance({...c,athleteIds:c.athleteIds||[],teamIds:c.teamIds||[]},rs).tier]);return rank(a)-rank(b)||(b.publishedAt||0)-(a.publishedAt||0);}).slice(0,30);state.highlightError='';render();
 }catch{if(generation===state.generation){state.highlightError='Highlights are temporarily unavailable. Retrying automatically.';if(!state.clips.length)render();}}finally{clearTimeout(timeout);}}
 if(generation===state.generation)summaryTimer=setTimeout(()=>pollHighlights(generation),document.hidden?60000:12000);
}
function switchMode(mode){if(state.mode===mode)return;stopNetwork();stopReplay();unloadLive();state.generation++;state.mode=mode;state.auto=true;state.quietSince=null;state.lastReplay=-Infinity;state.seen.clear();state.clips=mode==='test'?[...testClips]:[];state.currentId=null;state.lastFeed=0;state.feedError='';state.seconds=0;state.paused=false;state.games=mode==='test'?simulation(0):[];state.currentId=state.games[0]?.id;state.loaded='';lastTick=performance.now();if(mode==='live'){addCustomClip();pollFeed(state.generation);pollHighlights(state.generation);}render();}
$('testMode').onclick=()=>switchMode('test');$('liveMode').onclick=()=>switchMode('live');
$('pauseTest').onclick=()=>{state.paused=!state.paused;lastTick=performance.now();renderStatus();};
function seekTest(seconds){state.seconds=seconds;state.games=simulation(seconds);state.quietSince=null;stopReplay();direct();render();}
$('nextEvent').onclick=()=>{seekTest((Math.floor(state.seconds/12)+1)*12%72);};
$('resetTest').onclick=()=>{state.auto=true;state.seen.clear();state.lastReplay=-Infinity;state.paused=false;seekTest(0);lastTick=performance.now();};
setInterval(()=>{const now=performance.now(),delta=Math.min(1.5,(now-lastTick)/1000);lastTick=now;if(document.hidden)return;
 if(state.mode==='test'&&!state.paused){const previous=Math.floor(state.seconds/12);state.seconds+=delta;if(state.seconds>=72){state.seconds=0;state.seen.clear();state.lastReplay=-Infinity;state.quietSince=null;}if(Math.floor(state.seconds/12)!==previous){state.games=simulation(state.seconds);direct();render();}}
 const prevId=state.currentId,prevReplay=state.replay?.id;if(state.mode!=='test'||!state.paused)direct();if(prevId!==state.currentId||prevReplay!==state.replay?.id)render();renderStatus();
},1000);
window.addEventListener('pagehide',()=>{stopNetwork();$('liveVideo').pause();$('replayVideo').pause();});
window.addEventListener('pageshow',e=>{if(e.persisted&&state.mode==='live'){state.generation++;pollFeed(state.generation);pollHighlights(state.generation);}});
document.addEventListener('visibilitychange',()=>{lastTick=performance.now();});
render();
