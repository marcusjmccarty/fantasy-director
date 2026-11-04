import {StreamFinder} from './stream-finder.js';
import {PlayerPool} from './players.js';
import {safeVideo,streamType,teamColor,teamLogo} from './roster.js';
import {headToHead,benchList} from './scoreboard.js';
import {SPORTS,escapeHTML as esc,localDate,normalizeSportGames,normalizeSportPreferences,chooseSportGame,sportMatchup} from './sports-data.js';
const $=id=>document.getElementById(id),requested=new URLSearchParams(location.search).get('sport');
const sport=Object.hasOwn(SPORTS,requested)?requested:'nba',config=SPORTS[sport],storageKey='fantasy-stream-'+sport+'-v1';
let saved;try{saved=normalizeSportPreferences(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{saved=normalizeSportPreferences();}
const S={date:localDate(),gamesLoading:true,gamesError:false,games:[],history:[],season:null,playing:false,current:null,manual:false,lastSwitch:0,blocked:new Map(),filter:false,league:null,leagueError:'',leagueUpdated:0,leaguePending:false,leagueGeneration:0,gameGeneration:0,matchId:'',request:null,gameTimer:null,leagueTimer:null,fullRequest:0,fullWanted:false,rotations:new Map(),stripShown:null};
const streamFinder=new StreamFinder({fetcher:(...args)=>fetch(...args)});streamFinder.enabled=saved.autoDiscover;
const markup=new Map();function put(id,html){if(markup.get(id)!==html){markup.set(id,html);$(id).innerHTML=html;}}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(saved));$('storageWarning').hidden=true;}catch{$('storageWarning').hidden=false;}}
const pool=new PlayerPool($('layers'),{capacity:2,onReconnect:(key,detail)=>{const active=document.fullscreenElement||document.webkitFullscreenElement;if(key===pool.visible&&active&&active!==document.querySelector('.stage'))document.querySelector('.stage').classList.add('theater');if(detail?.failover)rotateSource(key);},onError:()=>{renderTransport();},onAudioLocked:()=>renderTransport()});
pool.setMuted(saved.muted);
const selectedTeam=()=>S.league?.teams.find(t=>t.id===saved.teamId);
const followed=()=>[...new Set((selectedTeam()?.players||[]).filter(p=>p.active).map(p=>p.teamId))];
const urls=game=>game?streamFinder.urls(game,[saved.streams[game.key]?.primary,saved.streams[game.key]?.backup],saved.streams[game.key]?.mode):[];
const currentGame=()=>S.games.find(g=>g.id===S.current);
const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2):'—';
const brief=n=>typeof n==='number'&&Number.isFinite(n)?String(Math.round(n*10)/10):'—';
const clockTime=d=>new Date(d).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function gameTime(g){return g.state==='pre'?clockTime(g.date):g.detail;}
const isToday=()=>S.date===localDate();
const gamecast=g=>`https://www.espn.com/${sport}/game/_/gameId/${encodeURIComponent(g.id)}`;
const teamGame=teamId=>S.games.find(g=>g.teams.some(t=>t.id===teamId));
const playersIn=g=>(selectedTeam()?.players||[]).filter(p=>p.active&&g.teams.some(t=>t.id===p.teamId));
const nickname=t=>t.nick||t.name||t.abbr;
const LENGTH={nba:[4,12],nhl:[3,20]};
// How far along a game is, for the thin bar on its tile.
function progress(g){
 if(g.state==='post')return 100;if(g.state!=='in'||!g.period)return null;
 if(sport==='mlb')return Math.min(100,Math.round((g.period-1+(/^(bot|mid)/i.test(g.detail)?.5:/^end/i.test(g.detail)?1:0))/9*100));
 const [periods,minutes]=LENGTH[sport];if(g.period>periods)return 100;
 const parts=String(g.clock||'').split(':').map(Number),left=parts.length>1?parts[0]+parts[1]/60:Number.isFinite(parts[0])?parts[0]/60:minutes;
 return Math.max(0,Math.min(100,Math.round(((g.period-1)*minutes+(minutes-Math.min(minutes,left||0)))/(periods*minutes)*100)));
}
function situation(g){
 if(g.state==='pre'){const verb={nba:'Tip-off',nhl:'Puck drop',mlb:'First pitch'}[sport],wait=Math.round((Date.parse(g.date)-Date.now())/60000);if(!Number.isFinite(wait))return verb+' later';if(wait<=0)return verb+' soon';if(wait<720)return `${verb} in ${wait>=60?Math.floor(wait/60)+'h ':''}${wait%60}m`;return verb+' '+new Date(g.date).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});}
 if(g.state==='hold')return g.detail||'Delayed';
 if(g.state==='post'){const [a,b]=g.teams,margin=Math.abs(Number(a.score)-Number(b.score)),winner=Number(a.score)>Number(b.score)?a:b,suffix=(/^Final\/(.+)$/i.exec(g.detail||'')||[])[1]||'',extra=suffix?' · '+(/^\d+$/.test(suffix)?suffix+' inn':suffix):'';return Number.isFinite(margin)&&margin>0?`${nickname(winner)} by ${margin}${extra}`:'Final';}if(g.onBreak)return 'Break · '+g.detail;
 const s=g.situation||{};
 if(sport==='mlb'&&Number.isInteger(s.outs)){const bases=[s.onFirst&&'1st',s.onSecond&&'2nd',s.onThird&&'3rd'].filter(Boolean);return `${s.outs} out${s.outs===1?'':'s'} · ${bases.length?'On '+bases.join(', '):'Bases empty'}`;}
 return 'In progress';
}
function streamChip(g){
 if(g.state==='post')return '';
 const links=saved.streams[g.key],available=urls(g).length>0;
 if(!available)return `<button type="button" class="g-stream none" data-add-stream="${esc(g.id)}" title="Add a stream for ${esc(g.name)}">+ Stream</button>`;
 const mode=links?.mode||'custom',own=mode==='custom'&&!!(links?.primary||links?.backup);
 const source=own?'Your link':['NTV','StreamCorner'].includes(mode)?mode:(streamFinder.options(g)[0]?.provider||'Stream');
 return `<button type="button" class="g-stream" data-add-stream="${esc(g.id)}" title="Change the stream for ${esc(g.name)}">${esc(source)}</button>`;
}
function dayLabel(){
 const diff=Math.round((Date.parse(S.date+'T12:00:00')-Date.parse(localDate()+'T12:00:00'))/864e5);
 return diff===0?'Today':diff===1?'Tomorrow':diff===-1?'Yesterday':new Date(S.date+'T12:00:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
}
function renderGuide(){
 const followedIds=followed(),order={in:0,pre:1,hold:2,post:3};
 const games=S.games.filter(g=>!S.filter||g.teams.some(t=>followedIds.includes(t.id))).slice().sort((a,b)=>order[a.state]-order[b.state]||Date.parse(a.date)-Date.parse(b.date));
 const live=S.games.filter(g=>g.state==='in').length;
 // The Live dot reports today's slate only; browsing another day keeps the last answer.
 if(isToday()&&!S.gamesLoading&&!S.gamesError){$('liveDot').classList.toggle('on',live>0);$('liveDot').parentElement?.setAttribute?.('title',live?`${live} ${config.label} game${live===1?'':'s'} live now`:`No ${config.label} games live right now`);}
 $('gameCount').textContent=live?live+' live':S.games.length?S.games.length+' games':'';$('dayLabel').textContent=dayLabel();$('today').hidden=isToday();
 $('allGames').setAttribute('aria-pressed',String(!S.filter));$('myGames').setAttribute('aria-pressed',String(S.filter));
 put('games',games.map(g=>{
  const available=urls(g).length>0,watching=S.current===g.id,mine=playersIn(g),selectable=available||g.state!=='post';
  const tag=watching?['ON AIR','onair']:g.state==='hold'?['DELAYED','amber']:g.state==='post'?['FINAL','final']:g.state==='pre'?['LATER','later']:g.onBreak?['BREAK','muted']:mine.length?['YOUR GAME','go']:['LIVE','live'];
  const known=g.state!=='pre',diff=known?Number(g.teams[0].score)-Number(g.teams[1].score):0;
  const rows=g.teams.map((t,i)=>{const logo=teamLogo(t,sport),trail=g.state==='post'&&known&&(i===0?diff<0:diff>0);
   return `<span class="g-team${trail?' trail':''}" title="${esc(t.name)}"><span class="team-logo">${logo?`<img src="${esc(logo)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="team-code">${esc(t.abbr)}</span><span class="team-name">${esc(nickname(t))}</span><b class="team-score">${known?esc(t.score??'—'):'—'}</b></span>`;}).join('');
  const pct=progress(g),line=`<span class="g-drive${g.state==='in'&&!g.onBreak?'':' quiet'}"><span>${esc(situation(g))}</span>${mine.length&&g.state!=='post'?`<span>${mine.length} yours</span>`:''}</span><span class="g-bar${pct===null?' idle':''}" aria-hidden="true">${pct===null?'':`<i style="width:${pct}%"></i>`}</span>`;
  const names=mine.map(p=>`<span class="${g.state==='in'&&!g.onBreak?'on':''}">${esc(p.name)}</span>`).join('')||(g.tv?`<span class="tv">${esc(g.tv)}</span>`:`<span>${esc(config.label)}</span>`);
  const cta=watching?'On screen':available?'Watch':'';
  const action=watching?'On screen':available?'Watch this game':g.state==='post'?'Game finished':'Add a stream to watch';
  return `<li class="tile${watching?' watching':''}${selectable?'':' off'}${mine.length?' mine':''}" style="--away:${teamColor(g.teams[0],sport)};--home:${teamColor(g.teams[1],sport)}"><button class="game" data-watch="${esc(g.id)}" aria-pressed="${watching}" aria-label="${esc(g.teams.map(t=>t.name).join(' at ')+'. '+action)}" ${selectable?'':'disabled'}><span class="g-status"><span class="tag ${tag[1]}">${tag[0]}</span><span class="g-when">${g.state==='post'?'':esc(gameTime(g))}</span></span><span class="g-matchup">${rows}</span>${line}</button><div class="g-footer"><span class="g-names">${names}</span>${streamChip(g)}${cta?`<span class="g-cta">${cta}</span>`:''}</div></li>`;
 }).join('')||`<li class="empty">${S.filter?(selectedTeam()?'None of this team’s starters have a game on this date.':'Connect ESPN and choose a fantasy team to filter its games.'):S.gamesLoading?'Loading '+config.label+' games…':S.gamesError?'Game updates are unavailable. Use Refresh to try again.':'No '+config.label+' games scheduled for this date. Use the arrows to choose another day.'}</li>`);
 // Keep the game on screen in view in the strip.
 if(S.current&&S.current!==S.stripShown){S.stripShown=S.current;for(const b of $('games').querySelectorAll?.('[data-watch]')||[])if(b.dataset.watch===S.current)b.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});}
 const open=S.games.filter(g=>g.state!=='post'),ready=open.filter(g=>urls(g).length).length;
 $('streamSummary').textContent=open.length?`${ready} of ${open.length} games ${isToday()?'today ':''}have a stream ready`:S.games.length?'Every game on this day is final':'No games on this day';
 $('streamsCount').textContent=ready?String(ready):'';
 const listed=S.games.filter(g=>g.state!=='post'||saved.streams[g.key]?.primary||saved.streams[g.key]?.backup).sort((a,b)=>order[a.state]-order[b.state]||Date.parse(a.date)-Date.parse(b.date));
 put('savedStreams',listed.map(g=>{const n=urls(g).length,links=saved.streams[g.key],own=!!(links?.primary||links?.backup),state=n?(own&&(links.mode||'custom')==='custom'?'Your link':'Stream ready')+(n>1?' · backup ready':''):'No stream yet';return `<div class="stream-row sport"><div class="stream-game"><span class="stream-logos">${g.teams.map(t=>{const src=teamLogo(t,sport);return src?`<img src="${esc(src)}" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer">`:'';}).join('')}</span><span class="stream-name"><b>${esc(g.teams.map(t=>t.abbr).join(' @ '))}</b><small>${esc(gameTime(g))} · <span class="source-state${n?' ok':''}">${esc(state)}</span></small></span></div><span class="stream-actions"><a href="${esc(gamecast(g))}" target="_blank" rel="noopener noreferrer" title="Open ESPN Gamecast">Gamecast ↗</a><button type="button" class="ghost" data-edit="${esc(g.id)}">${n?'Change':'Add link'}</button></span></div>`;}).join('')||`<p class="empty">${S.games.length?'Every game on this day is final.':'Choose a day with games to add stream links.'}</p>`);
}
function selectGame(id,{manual=true,url=null}={}){
 const game=S.games.find(g=>g.id===id);if(!game)return;const source=url||urls(game)[0];if(!source){openStream(id);return;}
 if(S.current!==id){S.lastSwitch=Date.now();S.manual=manual;}else if(manual)S.manual=true;
 const slot=pool.get(id);if(!slot||slot.url!==source){pool.open(id,{url:source,page:streamFinder.original(source),type:streamType(source),live:true,autoReconnect:saved.autoReconnect});}
 S.autoAttempted=true;S.current=id;S.playing=true;pool.setRunning(true,{resumeVisible:false});pool.show(id);$('overlay').hidden=true;renderGuide();renderTransport();
}
function setPlaying(on){S.autoAttempted=true;S.playing=on;pool.setRunning(on);if(on&&!pool.current)direct();renderTransport();}
function direct(){
 if(!S.playing||!saved.auto&&pool.current)return;
 const cutoff=Date.now()-saved.delay*1000,delayed=S.history.filter(h=>h.at<=cutoff).at(-1)||S.history[0];
 const games=delayed?.games||S.games,blocked=new Set([...S.blocked].filter(([,until])=>until>Date.now()).map(([id])=>id));
 const choice=chooseSportGame(games,{streams:Object.fromEntries(S.games.map(g=>[g.key,{primary:urls(g)[0],backup:urls(g)[1]}])),followed:followed(),currentId:S.current,manual:S.manual,blocked,lastSwitch:S.lastSwitch});
 if(choice&&choice.id!==S.current)selectGame(choice.id,{manual:false});
 // Keep the current source through a data outage or an empty slate. A stale
 // scoreboard never tears down a working video or returns the viewer home.
}
function renderTransport(){
 const p=pool.current,g=currentGame(),embed=p?.kind==='embed',slot=pool.get(S.current),stage=document.querySelector('.stage');
 $('playButton').textContent=S.playing?'Pause':'Play';$('playButton').setAttribute('aria-label',S.playing?'Pause':'Play');
 $('muteButton').textContent=saved.muted?'Turn sound on':'Mute sound';$('reloadStream').hidden=!p;$('nextStream').hidden=!g||urls(g).length<2;$('nextStream').disabled=!S.playing;
 $('openStream').hidden=!embed;$('openStream').href=embed?(slot.source?.page||slot.url):'#';$('embedHelp').hidden=!embed;
 $('watchTitle').textContent=g?.name||config.name+' channel';$('channelMode').textContent=g?.detail||config.label+' LIVE';$('pictureNote').textContent=saved.delay+' sec delay';
 $('gamecastLink').hidden=!g;$('gamecastLink').href=g?gamecast(g):'#';
 $('autoMode').textContent='Auto · '+(saved.auto?'On':'Off');$('autoMode').setAttribute('aria-pressed',String(saved.auto));
 $('autoChip').textContent=!saved.auto?'Manual':S.manual?'Your choice':'Automatic';$('autoChip').classList.toggle('on',saved.auto&&!S.manual);
 $('bug').hidden=!g;$('bugTag').dataset.state=g?.state||'';
 if(g){const [a,b]=g.teams;$('bugTag').textContent=g.state==='in'?(g.onBreak?'BREAK':'LIVE'):g.state==='post'?'FINAL':g.state==='hold'?'DELAYED':'LATER';put('bugGame',g.state==='pre'?`${esc(a.abbr)} <span class="at">@</span> ${esc(b.abbr)}`:`${esc(a.abbr)} <b>${esc(a.score??'')}</b> – <b>${esc(b.score??'')}</b> ${esc(b.abbr)}`);$('bugClock').textContent=gameTime(g);}
 const yours=g?playersIn(g):[];$('lower').hidden=!yours.length;put('lowerMain',yours.map(p=>`<span>${esc(p.name)}<i>${esc(p.position)}</i></span>`).join(''));
 $('watchStatus').textContent=!p?(S.playing?'Waiting for a live game with a saved stream.':'Finding streams. Choose a game to begin.'):!S.playing?'Paused · recovery waits until you resume.':S.manual?'Your choice · Auto resumes at a reported break.':selectedTeam()?'Following '+selectedTeam().name+' at game breaks.':'Following available games at reported breaks.';
 $('streamHealth').hidden=!p?.reconnecting;$('streamHealth').textContent=p?.recoveryMessage||'';
 $('unmute').hidden=!p?.audioLocked||saved.muted||!S.playing;
 $('fullButton').textContent=document.fullscreenElement||document.webkitFullscreenElement||stage.classList.contains('theater')?'Exit full screen':'Full screen';
 if(!p){$('overlay').hidden=false;$('ovTitle').textContent=S.games.length?'Every game. Your way.':S.gamesLoading?'Getting your games ready…':S.gamesError?'Game updates are unavailable.':'No games on this date.';$('ovText').textContent=S.games.length?'We look for matching streams automatically. Choose any game above, or connect ESPN to follow your fantasy players.':S.gamesLoading?'Connecting to ESPN for this day’s schedule.':S.gamesError?'Your streams and fantasy connection are saved. Refresh the guide to retry.':'Use the arrows beside the date to browse another day. Your saved streams and fantasy connection stay here.';$('addFirstStream').hidden=!S.games.length;}
}
function openStream(id){
 if(!S.games.length){$('scheduleStatus').textContent='Choose a date with scheduled games first.';return;}
 put('streamGame',S.games.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join(''));$('streamGame').value=id||S.current||S.games[0].id;fillStream();$('streamError').textContent='';$('streamDialog').showModal();
}
function fillStream(){const g=S.games.find(g=>g.id===$('streamGame').value),links=saved.streams[g?.key]||{};$('streamURL').value=links.primary||'';$('backupURL').value=links.backup||'';renderSourceOptions(g);}
$('streamGame').onchange=fillStream;$('closeStream').onclick=()=>$('streamDialog').close();
function renderSourceOptions(g){
 if(!g)return;const links=saved.streams[g.key]||{},mode=links.mode||'custom',providers=[...new Set(streamFinder.options(g).map(x=>x.provider))];
 const choices=[['auto','Auto'],...['NTV','StreamCorner'].map(p=>[p,p]),...(links.primary?[['custom','My link']]:[])];
 $('streamSourceOptions').innerHTML='<div class="seg" role="group" aria-label="Play this game from">'+choices.map(([id,label])=>`<button type="button" data-source-mode="${esc(id)}" ${['NTV','StreamCorner'].includes(id)&&!providers.includes(id)?'disabled title="No match on this site yet"':''} aria-pressed="${(mode==='custom'&&!links.primary?'auto':mode)===id}">${esc(label)}</button>`).join('')+'</div>';
}
async function applyStream(g,request){
 const links=saved.streams[g.key];if(!links)return;const old=pool.get(g.id),date=S.date;
 if(links.mode==='custom')await Promise.all([links.primary,links.backup].filter(Boolean).map(u=>streamFinder.resolve(u)));
 if(request!==S.streamSaveRequest||date!==S.date)return;
 if(S.current===g.id&&pool.get(g.id)===old&&old?.url!==urls(g)[0]){pool.close(g.id);if(S.playing&&urls(g).length)selectGame(g.id,{manual:S.manual});else S.current=null;}
 renderGuide();renderTransport();
}
$('streamSourceOptions').onclick=async event=>{const button=event.target.closest('[data-source-mode]'),g=S.games.find(g=>g.id===$('streamGame').value);if(!button||!g)return;const mode=button.dataset.sourceMode;if(!['custom','auto','NTV','StreamCorner'].includes(mode))return;saved.streams[g.key]={...saved.streams[g.key],mode};persist();renderSourceOptions(g);await applyStream(g,S.streamSaveRequest=(S.streamSaveRequest||0)+1);};
$('streamForm').onsubmit=async event=>{event.preventDefault();try{
 const g=S.games.find(g=>g.id===$('streamGame').value);if(!g)throw new Error('This game is no longer listed.');
 const primary=safeVideo($('streamURL').value.trim()),backup=safeVideo($('backupURL').value.trim()),old=saved.streams[g.key]||{};
 saved.streams[g.key]={primary,backup,mode:primary!==old.primary||backup!==old.backup?'custom':old.mode||'custom'};persist();$('streamDialog').close();
 await applyStream(g,S.streamSaveRequest=(S.streamSaveRequest||0)+1);void refreshStreamLinks();renderGuide();renderTransport();
}catch(error){$('streamError').textContent=error.message;}};
$('games').onclick=event=>{const add=event.target.closest('[data-add-stream]'),watch=event.target.closest('[data-watch]');if(add){openStream(add.dataset.addStream);return;}if(watch&&!watch.disabled)selectGame(watch.dataset.watch);};
$('savedStreams').onclick=event=>{const edit=event.target.closest('[data-edit]');if(edit)openStream(edit.dataset.edit);};
function openStreams(){renderGuide();if(!$('streamsDetails').open)$('streamsDetails').showModal();}
$('streamsButton').onclick=openStreams;$('closeStreams').onclick=$('doneStreams').onclick=()=>$('streamsDetails').close();
$('refreshStreams').onclick=()=>{streamFinder.cancel();loadGames();};
const stripStep=dir=>$('games').scrollBy?.({left:dir*Math.max(240,($('games').clientWidth||800)*.8),behavior:'smooth'});
$('stripPrev').onclick=()=>stripStep(-1);$('stripNext').onclick=()=>stripStep(1);
$('games').addEventListener?.('wheel',e=>{const list=$('games');if(Math.abs(e.deltaY)<=Math.abs(e.deltaX)||list.scrollWidth<=list.clientWidth)return;e.preventDefault();list.scrollLeft+=e.deltaY;},{passive:false});
$('headerScore').onclick=e=>{e.preventDefault();$('scoreboardTitle').focus();};
$('addFirstStream').onclick=()=>openStream();$('playButton').onclick=()=>setPlaying(!S.playing);$('reloadStream').onclick=()=>{if(S.playing)pool.current?.reload?.();};
function rotateSource(id,manual=false){if(!S.playing||id!==S.current||!manual&&Date.now()<(S.rotations.get(id)||0))return;const g=currentGame(),links=urls(g),alternate=links.length>1?links[(links.indexOf(pool.get(id)?.url)+1)%links.length]:null;if(!g||!alternate)return;S.rotations.set(id,Date.now()+60000);selectGame(g.id,{url:alternate,manual:S.manual});}
$('nextStream').onclick=()=>rotateSource(S.current,true);
$('muteButton').onclick=()=>{saved.muted=!saved.muted;pool.setMuted(saved.muted);if(!saved.muted)pool.retryAudio();persist();renderTransport();};$('unmute').onclick=()=>{saved.muted=false;pool.setMuted(false);pool.retryAudio();persist();renderTransport();};
$('autoMode').onclick=()=>{saved.auto=!saved.auto;S.manual=false;persist();direct();renderTransport();};
$('allGames').onclick=()=>{S.filter=false;renderGuide();};$('myGames').onclick=()=>{S.filter=true;renderGuide();};
async function loadGames(){
 const generation=++S.gameGeneration,date=S.date;clearTimeout(S.gameTimer);S.request?.abort();const controller=new AbortController();S.request=controller;const timeout=setTimeout(()=>controller.abort(),15000);
 S.gamesLoading=true;S.gamesError=false;$('scheduleStatus').textContent='Refreshing…';renderTransport();
 try{const r=await fetch('/api/sports?sport='+sport+'&date='+date,{signal:controller.signal,cache:'no-store'}),data=await r.json();if(generation!==S.gameGeneration)return;if(!r.ok)throw new Error(data.error||'Game feed unavailable');if(data.sport!==sport||data.date!==date)throw new Error('Unexpected schedule response');S.gamesError=false;S.gamesLoading=false;S.games=normalizeSportGames(data,sport);S.season=data.season||S.season;S.history.push({at:Date.now(),games:S.games});S.history=S.history.filter(h=>Date.now()-h.at<660000);$('scheduleStatus').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});renderGuide();direct();renderTransport();if(S.discoveryReady)void refreshStreamLinks();}
 catch(error){if(generation===S.gameGeneration){S.gamesError=true;S.gamesLoading=false;$('scheduleStatus').textContent=(S.games.length?'Showing last update · ':'Updates delayed · ')+'retrying';renderGuide();renderTransport();}}
 finally{clearTimeout(timeout);if(generation===S.gameGeneration){S.request=null;S.gameTimer=setTimeout(loadGames,S.games.some(g=>g.state==='in')?15000:60000);}}
}
function changeDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))return;streamFinder.cancel();S.date=value;$('gameDate').value=value;S.history=[];S.games=[];S.gamesLoading=true;renderGuide();loadGames();}
$('gameDate').onchange=event=>changeDate(event.target.value);$('gameDate').onclick=event=>{try{event.target.showPicker?.();}catch{}};
for(const [id,offset] of [['previousDay',-1],['nextDay',1]])$(id).onclick=()=>{const date=new Date(S.date+'T12:00:00');date.setDate(date.getDate()+offset);changeDate(localDate(date));};
$('today').onclick=()=>changeDate(localDate());$('refreshGames').onclick=()=>{loadGames();if(saved.leagueId)loadLeague();};
const defaultSeason=()=>sport==='mlb'?new Date().getFullYear():new Date().getFullYear()+(new Date().getMonth()>=6?1:0);
function openLeague(){
 $('leagueId').value=saved.leagueId;$('swid').value=saved.swid;$('s2').value=saved.s2;$('leagueSeason').value=saved.leagueSeason||S.season||defaultSeason();$('leagueTitle').textContent='Fantasy team · '+config.label;$('leagueError').textContent='';
 $('leagueImport').open=!saved.leagueId||!!S.leagueError;$('leagueDialog').dataset.connected=String(!!saved.leagueId);renderFantasy();if(!$('leagueDialog').open)$('leagueDialog').showModal();
}
for(const id of ['connectFirst','fantasyTeamButton','connectFromBoard','chooseTeam'])$(id).onclick=openLeague;
$('closeLeague').onclick=()=>$('leagueDialog').close();
$('leagueForm').onsubmit=async event=>{event.preventDefault();
 const typed=$('leagueId').value.trim(),leagueId=/leagueId=(\d{1,12})/i.exec(typed)?.[1]||typed,season=Number(/seasonId=(\d{4})/i.exec(typed)?.[1]||$('leagueSeason').value),swid=$('swid').value.trim(),s2=$('s2').value.trim();
 if(!/^\d{1,12}$/.test(leagueId)){$('leagueImport').open=true;$('leagueError').textContent='Enter your league ID, or paste your league’s web address.';$('leagueId').focus?.();return;}
 if(!Number.isInteger(season)||season<2018||season>2035){$('leagueImport').open=true;$('leagueError').textContent='Enter a season between 2018 and 2035.';return;}
 $('leagueId').value=leagueId;$('leagueSeason').value=season;
 // Nothing changed: Done just closes. Anything new reconnects.
 if(S.league&&!S.leagueError&&leagueId===saved.leagueId&&season===Number(saved.leagueSeason)&&swid===saved.swid&&s2===saved.s2){$('leagueDialog').close();return;}
 await loadLeague({leagueId,swid,s2,season});};
async function loadLeague(input=null){
 if(!input&&!saved.leagueId)return;const explicit=!!input;input||={leagueId:saved.leagueId,swid:saved.swid,s2:saved.s2,season:saved.leagueSeason||S.season||defaultSeason()};
 const generation=++S.leagueGeneration;clearTimeout(S.leagueTimer);S.leaguePending=true;$('importLeague').disabled=true;$('leagueError').textContent='';renderFantasy();
 try{const r=await fetch('/api/sports/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,sport}),signal:AbortSignal.timeout(30000),cache:'no-store'}),data=await r.json();if(generation!==S.leagueGeneration)return;if(!r.ok){if(r.status===401){$('leagueImport').open=true;$('privateLeague').open=true;}throw new Error(data.error||'Could not load this league.');}if(data.leagueId!==input.leagueId||data.sport!==sport||!Array.isArray(data.teams))throw new Error('Unexpected league response.');
  const previous=saved.leagueId===input.leagueId?saved.teamId:'';S.league=data;S.leagueError='';S.leagueUpdated=Date.now();saved.leagueId=input.leagueId;saved.swid=input.swid;saved.s2=input.s2;saved.leagueSeason=input.season;saved.teamId=data.teams.find(t=>t.id===previous)?.id||data.teams.find(t=>t.id===data.ownedTeamId)?.id||'';persist();$('leagueDialog').dataset.connected='true';if(explicit){$('leagueImport').open=false;if(saved.teamId)$('leagueDialog').close();else $('scoreTeam').focus?.();}renderGuide();
 }catch(error){if(generation===S.leagueGeneration){S.leagueError=error.message;$('leagueError').textContent=error.message;}}
 finally{if(generation===S.leagueGeneration){S.leaguePending=false;$('importLeague').disabled=false;renderFantasy();if(saved.leagueId)S.leagueTimer=setTimeout(()=>loadLeague(),30000);}}
}
function playerStatus(p){
 // Game status is only meaningful for today's scoring day.
 const g=isToday()?teamGame(p.teamId):null,game=!isToday()?p.position:!g?'No game':g.state==='in'?(g.onBreak?'Break · ':'')+g.detail:g.state==='pre'?clockTime(g.date):g.state==='post'?'Final':'Delayed';
 return [game,p.injury].filter(Boolean).join(' · ');
}
function playing(p){const g=isToday()?teamGame(p.teamId):null;return g?.state==='in'&&!g.onBreak;}
function renderFantasy(){
 const league=S.league,match=sportMatchup(league,saved.teamId,S.matchId),points=!!league?.isPoints;$('scoreTeam').disabled=!league?.teams.length;
 put('scoreTeam','<option value="">'+(league?'Choose your team…':'Connect ESPN to choose a team')+'</option>'+(league?.teams||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''));$('scoreTeam').value=saved.teamId;
 $('retryFantasy').hidden=!S.leagueError;$('retryFantasy').disabled=S.leaguePending;
 const espn=league&&saved.teamId?`https://fantasy.espn.com/${config.fantasy}/team?leagueId=${encodeURIComponent(saved.leagueId)}&teamId=${encodeURIComponent(saved.teamId)}&seasonId=${encodeURIComponent(league.season)}`:'';
 $('leagueMeta').textContent=league&&points&&league.scoringPeriod?'Day '+league.scoringPeriod:'';$('leagueMeta').title=league?league.name+' · '+(points?'player points are for scoring day '+league.scoringPeriod+'; totals are the whole ESPN matchup':league.scoringType==='ROTO'?'rotisserie league':'category league'):'';
 $('leagueState').textContent=league?'Connected · '+league.name:S.leaguePending?'Connecting to ESPN…':saved.leagueId?'League '+saved.leagueId+' · not loaded':'Not connected';
 put('leagueSummary',league?esc(league.teams.length+' teams · '+league.season+' season')+(espn?` · <a href="${esc(espn)}" target="_blank" rel="noopener noreferrer">Open on ESPN ↗</a>`:''):'Connect to show your lineup and matchup');$('leagueAction').textContent=league?'Change':'Connect';
 $('importLeague').textContent=league&&!S.leagueError?'Done':'Connect';
 $('fantasyStatus').textContent=S.leagueError?(S.leagueUpdated?'Last good update '+new Date(S.leagueUpdated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'. ':'')+S.leagueError:S.leaguePending&&!league?'Getting your league from ESPN…':!league?'Connect a league to see players and your matchup.':!saved.teamId?'Choose your team using Fantasy team in the top bar.':'Updated '+new Date(S.leagueUpdated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · every 30 seconds';
 // Only say something when it needs attention; a healthy matchup speaks for itself.
 $('fantasyStatus').hidden=!S.leagueError&&!(league&&!saved.teamId);$('fantasyStatus').classList.toggle('sport-error',!!S.leagueError);
 const matches=match?.matches||[];$('matchupPicker').hidden=matches.length<2;put('matchupSelect',matches.map(m=>{const other=m.home?.teamId===saved.teamId?m.away:m.home;return `<option value="${esc(m.id)}">${esc(league.teams.find(t=>t.id===other?.teamId)?.name||'Bye')}</option>`;}).join(''));$('matchupSelect').value=match?.matchId||'';
 let status='Your team vs. your opponent',state='';
 if(match){if(!match.opponent)status=league.scoringType==='ROTO'?'Season standings on ESPN':'No opponent this matchup';else if(points&&match.yourPoints!==null&&match.opponentPoints!==null){const diff=match.yourPoints-match.opponentPoints;state=diff>0?'ahead':diff<0?'behind':'tied';status=diff===0?'All square':(diff>0?'Ahead by ':'Behind by ')+fmt(Math.abs(diff));}else status=points?'Matchup points':'Category matchup';}
 $('matchupStatus').textContent=status;
 const board=$('scoreboard'),connect=!league&&!saved.leagueId;board.dataset.connect=String(connect);board.dataset.empty=String(!connect&&!match);board.dataset.state=state;
 $('placeholderTitle').textContent=!league?(S.leagueError?'Your league is unavailable':'Getting your league…'):'Choose a team to follow';
 $('placeholderText').textContent=!league?(S.leagueError||'Your lineup appears here in a moment.'):'Pick your franchise and its lineup appears here.';$('chooseTeam').hidden=!league&&!S.leagueError;
 // The scorebug: your total in gold, theirs in violet, a bar for the share.
 $('fantasyTitle').textContent=match?.yours?.name||'Your team';$('opponentTitle').textContent=match?(match.opponent?.name||'No opponent'):'Your opponent';$('fantasyTitle').title=$('fantasyTitle').textContent;$('opponentTitle').title=$('opponentTitle').textContent;
 $('fantasyTotal').textContent=points&&match?fmt(match.yourPoints):'—';$('opponentTotal').textContent=points&&match?.opponent?fmt(match.opponentPoints):'—';
 const mine=match?.yourPoints,theirs=match?.opponentPoints,share=points&&Number.isFinite(mine)&&Number.isFinite(theirs)&&mine+theirs>0?mine/(mine+theirs)*100:50;$('matchupBar').setAttribute('style','width:'+share.toFixed(1)+'%');
 const scored=points&&!!match?.opponent&&Number.isFinite(mine)&&Number.isFinite(theirs);
 $('headerScore').hidden=!scored;$('headerScore').dataset.state=state;$('headerScore').title=status;put('headerScore',scored?`<span>You</span><b>${brief(mine)}</b><i>–</i><b>${brief(theirs)}</b>`:'');
 // Starters slot by slot, then the bench, which never counts.
 const row=p=>({slot:p.slot,name:p.name,team:p.team||'FA',status:playerStatus(p),active:p.active&&playing(p),points:points?p.points:null,...(p.active?{}:{bench:true})});
 const lineup=t=>t?{...t,players:t.players.map(row)}:null;
 put('fantasyPlayers',match?headToHead(lineup(match.yours),lineup(match.opponent)):'');put('fantasyBench',match?benchList(lineup(match.yours),lineup(match.opponent),{points}):'');
 $('fantasyTable').hidden=!match;$('fantasyTable').classList.toggle('solo',!match?.opponent);$('fantasyTable').classList.toggle('nopoints',!points);
}
$('scoreTeam').onchange=event=>{if(!S.league?.teams.some(t=>t.id===event.target.value))return;saved.teamId=event.target.value;S.matchId='';persist();renderFantasy();renderGuide();};$('matchupSelect').onchange=event=>{S.matchId=event.target.value;renderFantasy();};$('retryFantasy').onclick=()=>{if(saved.leagueId)loadLeague();else openLeague();};
async function refreshStreamLinks(){
 if(!S.games.length||streamFinder.pending)return;const date=S.date,generation=S.gameGeneration;
 streamFinder.enabled=saved.autoDiscover;const task=streamFinder.refresh(S.games,sport,Object.values(saved.streams).flatMap(x=>[x.primary,x.backup]).filter(Boolean)),discovery=streamFinder.generation;await task;
 if(date!==S.date||generation!==S.gameGeneration||discovery!==streamFinder.generation)return;$('discoveryStatus').textContent=streamFinder.status;renderGuide();renderTransport();
 if(!S.autoAttempted&&saved.leagueId&&saved.teamId&&S.games.some(g=>g.state==='in'&&urls(g).length))setPlaying(true);
}
$('autoDiscover').checked=saved.autoDiscover;$('autoDiscover').onchange=e=>{saved.autoDiscover=e.target.checked;streamFinder.enabled=saved.autoDiscover;streamFinder.cancel();persist();void refreshStreamLinks();renderGuide();};
$('settingsButton').onclick=()=>$('settings').showModal();$('closeSettings').onclick=()=>$('settings').close();$('autoReconnect').checked=saved.autoReconnect;$('delay').value=saved.delay;
$('autoReconnect').onchange=event=>{saved.autoReconnect=event.target.checked;for(const slot of pool.slots.values())slot.player.setAutoReconnect?.(saved.autoReconnect);persist();};$('delay').onchange=event=>{saved.delay=Math.max(0,Math.min(600,Number(event.target.value)||0));event.target.value=saved.delay;persist();renderTransport();};
$('fullButton').onclick=async()=>{const stage=document.querySelector('.stage'),active=document.fullscreenElement||document.webkitFullscreenElement,request=++S.fullRequest;if(active||stage.classList.contains('theater')||S.fullWanted){S.fullWanted=false;stage.classList.remove('theater');try{if(active)await(document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen());}catch{}renderTransport();return;}S.fullWanted=true;stage.classList.add('theater');renderTransport();try{const fn=stage.requestFullscreen||stage.webkitRequestFullscreen;if(fn)await fn.call(stage,{navigationUI:'hide'});if(request!==S.fullRequest&&!S.fullWanted&&document.fullscreenElement===stage)await document.exitFullscreen();}catch{}renderTransport();};
for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,()=>{const stage=document.querySelector('.stage');if(document.fullscreenElement||document.webkitFullscreenElement)stage.classList.remove('theater');else if(!stage.classList.contains('theater'))S.fullWanted=false;renderTransport();});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){S.fullWanted=false;S.fullRequest++;document.querySelector('.stage').classList.remove('theater');renderTransport();return;}
 const target=event.target;if(event.metaKey||event.ctrlKey||event.altKey||target?.closest?.('input,textarea,select,dialog,[contenteditable]'))return;
 if(target?.closest?.('button,a,summary')&&(event.key===' '||event.key==='Enter'))return;
 if(event.key===' '||event.key==='k'){event.preventDefault();setPlaying(!S.playing);}else if(event.key==='m')$('muteButton').click();else if(event.key==='f')$('fullButton').click();
});
function openFromHash(){const hash=location.hash||'';if(!['#streams','#team','#settings'].includes(hash))return;for(const id of ['streamsDetails','leagueDialog','settings'])if($(id).open)$(id).close();if(hash==='#streams')openStreams();else if(hash==='#team')openLeague();else if(hash==='#settings'&&!$('settings').open)$('settings').showModal();}
window.addEventListener('pagehide',()=>{S.playing=false;pool.destroy();clearTimeout(S.gameTimer);clearTimeout(S.leagueTimer);S.request?.abort();});
function tick(){if(S.playing){pool.current?.checkHealth?.({active:pool.visible===S.current,online:navigator.onLine!==false,foreground:document.visibilityState!=='hidden'});if(document.visibilityState!=='hidden')direct();}renderTransport();}
for(const a of document.querySelectorAll('[data-sport]'))if(a.dataset.sport===sport)a.setAttribute('aria-current','page');
document.title='Fantasy Stream · '+config.label;S.discoveryReady=true;setInterval(refreshStreamLinks,15000);$('gameDate').value=S.date;
renderGuide();renderFantasy();renderTransport();loadGames();if(saved.leagueId)loadLeague();
setInterval(tick,1000);window.addEventListener('hashchange',openFromHash);openFromHash();
