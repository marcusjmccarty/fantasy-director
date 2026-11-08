import {StreamFinder,refusesFrame} from './stream-finder.js';
import {PlayerPool} from './players.js';
import {safeVideo,streamType,teamColor,teamLogo,forgetESPN} from './roster.js';
import {stripEnds,stripTabStop,stripKeys,mountGameTiles} from './strip.js';
import {headToHead,benchRows,matchupColumns,mountMatchupRows,nearStart} from './scoreboard.js';
import {mountChat,chatRoomFor} from './chat.js';
import {normalizeHighlights,mergeHighlights,highlightView,playable} from './highlights.js';
import {SPORTS,escapeHTML as esc,localDate,normalizeSportGames,normalizeSportPreferences,chooseSportGame,sportMatchup} from './sports-data.js';
const $=id=>document.getElementById(id),requested=new URLSearchParams(location.search).get('sport');
const sport=Object.hasOwn(SPORTS,requested)?requested:'nba',config=SPORTS[sport],storageKey='fantasy-stream-'+sport+'-v1';
let saved;try{saved=normalizeSportPreferences(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{saved=normalizeSportPreferences();}
const S={earlyOpen:new Set(),ovRun:null,streamOpener:null,mode:'live',date:localDate(),dateLocked:false,lookahead:null,pastDays:[],pastFor:'',pastLoading:false,pastComplete:false,pastRetryAt:0,stripTarget:null,stripStartedAt:0,resume:null,streamFieldsOpen:new Set(),streamSignature:null,streamsDirty:false,streamsPressed:false,streamSaves:new Map(),highlights:[],summaryAt:{},summaryPending:new Map(),clip:null,replays:null,replay:null,replayLoading:false,replayError:'',gamesLoading:true,gamesError:false,games:[],history:[],season:null,playing:false,current:null,manual:false,lastSwitch:0,blocked:new Map(),filter:false,league:null,leagueError:'',leagueUpdated:0,leaguePending:false,leagueGeneration:0,gameGeneration:0,matchId:'',request:null,gameTimer:null,leagueTimer:null,fullRequest:0,fullWanted:false,rotations:new Map(),stripShown:null};
// Website players are reloaded only on request now; a browser that saved the old default is reset once.
if(saved.prefsVersion<2){saved.autoReconnect=false;saved.prefsVersion=2;try{localStorage.setItem(storageKey,JSON.stringify(saved));}catch{}}
const streamFinder=new StreamFinder({fetcher:(...args)=>fetch(...args)});streamFinder.enabled=saved.autoDiscover;
// head is markup that rarely changes (the past days in the strip): when only what follows it changes, its first `kept` items stay in the page untouched.
// Writing text, even the same text, makes the browser lay the page out again.
const setText=(id,value)=>{const el=$(id);if(el.textContent!==String(value??''))el.textContent=value;};
const markup=new Map();function put(id,html,head='',kept=0){const last=markup.get(id),list=$(id);if(last?.html===html&&last.head===head)return;const was=id==='games'?document.activeElement?.dataset:null,keep=was?.watch?['watch',was.watch]:was?.pastReplay||was?.replay?['replay',was.pastReplay||was.replay]:was?.addStream?['addStream',was.addStream]:null;markup.set(id,{html,head});if(head&&last?.head===head&&list.insertAdjacentHTML&&list.children.length>=kept){while(list.children.length>kept)list.lastElementChild.remove();list.insertAdjacentHTML('beforeend',html);}else list.innerHTML=head+html;if(id==='games')stripSettled(keep);}
// The strip changed: a focused tile gets its focus back without moving the page (a past tile comes back as a replay tile after the mode swap).
function stripSettled(keep){const list=$('games');if(keep)for(const b of list.querySelectorAll?.('button')||[]){const d=b.dataset;if(!b.disabled&&(keep[0]==='replay'?d.replay===keep[1]||d.pastReplay===keep[1]:d[keep[0]]===keep[1])){b.focus?.({preventScroll:true});break;}}stripTabStop(list);stripEnds(list,$('stripPrev'),$('stripNext'));}
function persist(){try{localStorage.setItem(storageKey,JSON.stringify(saved));$('storageWarning').hidden=true;}catch{$('storageWarning').hidden=false;}}
const pool=new PlayerPool($('layers'),{capacity:2,onBeforeLeave:()=>{const stage=document.querySelector('.stage'),active=document.fullscreenElement||document.webkitFullscreenElement;if(active&&active!==stage){S.fullWanted=true;stage.classList.add('theater');}},onEnded:key=>{if(S.clip&&key==='hl:'+S.clip)leaveClip();},onError:(key,error)=>{if(S.clip&&key==='hl:'+S.clip)leaveClip();else if(String(key).startsWith('rp:'))failReplay(key,error?.message||'That replay could not be reached.');else renderTransport();},onReconnect:(key,detail)=>{const active=document.fullscreenElement||document.webkitFullscreenElement;if(key===pool.visible&&active&&active!==document.querySelector('.stage'))document.querySelector('.stage').classList.add('theater');if(detail?.failover)rotateSource(key);},onAudioLocked:()=>renderTransport()});
pool.setMuted(saved.muted);
const selectedTeam=()=>S.league?.teams.find(t=>t.id===saved.teamId);
const followed=()=>[...new Set((selectedTeam()?.players||[]).filter(p=>p.active).map(p=>p.teamId))];
const urls=game=>game?streamFinder.urls(game,[saved.streams[game.key]?.primary,saved.streams[game.key]?.backup],saved.streams[game.key]?.mode):[];
// A stream that refuses a frame opens in a new tab: it counts as found, never as something this page can play.
const inlineUrls=game=>urls(game).filter(u=>!refusesFrame(u));
const currentGame=()=>S.games.find(g=>g.id===S.current);
const fmt=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2):'—';
const brief=n=>typeof n==='number'&&Number.isFinite(n)?String(Math.round(n*10)/10):'—';
// Only errors this page threw carry words for the viewer; a parser, network or timeout error never does.
const plainError=(error,fallback)=>error?.name==='Error'?error.message:fallback;
const clockTime=d=>new Date(d).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
function gameTime(g){return g.state==='pre'?clockTime(g.date):g.detail;}
const isToday=()=>S.date===localDate();
const gamecast=g=>`https://www.espn.com/${sport}/game/_/gameId/${encodeURIComponent(g.id)}`;
const teamGame=teamId=>S.games.find(g=>g.teams.some(t=>t.id===teamId));
const playersIn=g=>(selectedTeam()?.players||[]).filter(p=>p.active&&g.teams.some(t=>t.id===p.teamId));
const nickname=t=>t.nick||t.name||t.abbr;
const LENGTH={nba:[4,12],nhl:[3,20]},START={nba:'Tip-off',nhl:'Puck drop',mlb:'First pitch'}[sport],LOAD_LIMIT=20000,CLICK_LIMIT=90000;
const touch=()=>!!window.matchMedia?.('(pointer:coarse)').matches;
// A saved stream or league: only then can the page promise they'll be here next time.
const hasSaved=()=>!!saved.leagueId||Object.values(saved.streams).some(s=>s.primary||s.backup);
const nounGames=n=>n===1?'game':'games',hasHave=(k,n)=>k===1||n===1?'has':'have';
// What a tile says out loud: the teams and their scores, then its state, then what pressing it does.
const tileLabel=(g,state,action)=>g.teams.map(t=>t.name+(g.state!=='pre'&&Number.isFinite(t.score)?' '+t.score:'')).join(' at ')+', '+state+'. '+action;
// How far along a game is, for the thin bar on its tile.
function progress(g){
 if(g.state==='post')return 100;if(g.state!=='in'||!g.period)return null;
 if(sport==='mlb')return Math.min(100,Math.round((g.period-1+(/^(bot|mid)/i.test(g.detail)?.5:/^end/i.test(g.detail)?1:0))/9*100));
 const [periods,minutes]=LENGTH[sport];if(g.period>periods)return 100;
 const parts=String(g.clock||'').split(':').map(Number),left=parts.length>1?parts[0]+parts[1]/60:Number.isFinite(parts[0])?parts[0]/60:minutes;
 return Math.max(0,Math.min(100,Math.round(((g.period-1)*minutes+(minutes-Math.min(minutes,left||0)))/(periods*minutes)*100)));
}
function situation(g){
 if(g.state==='pre'){const verb=START,wait=Math.round((Date.parse(g.date)-Date.now())/60000);if(!Number.isFinite(wait))return verb+' later';if(wait<=0)return verb+' soon';if(wait<720)return `${verb} in ${wait>=60?Math.floor(wait/60)+'h ':''}${wait%60}m`;return verb+' '+new Date(g.date).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});}
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
 const mode=links?.mode||'custom',own=mode==='custom'&&!!(links?.primary||links?.backup),away=!inlineUrls(g).length;
 const source=away?'Stream':own?'Your link':['NTV','StreamCorner'].includes(mode)?mode:(streamFinder.options(g)[0]?.provider||'Stream');
 return `<button type="button" class="g-stream" data-add-stream="${esc(g.id)}" title="${away?'Opens in a new tab. Change':'Change'} the stream for ${esc(g.name)}">${esc(source)}</button>`;
}
function dayLabel(){
 if(isToday())return '';
 const diff=Math.round((Date.parse(S.date+'T12:00:00')-Date.parse(localDate()+'T12:00:00'))/864e5);
 return (diff===1?'Tomorrow':new Date(S.date+'T12:00:00').toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'}))+(S.lookahead?' · next games':'');
}
// The week before today sits to the left of today's games, finals and all; a game with a listed replay opens it.
// A week with no finals is asked again in ten minutes, a day that failed in two. Each day has its own timeout, so a poll or Refresh cannot cancel it.
async function loadPastDays(){
 if(!S.replays&&!S.replayLoading&&Date.now()-(S.replaysAt||0)>60000)void loadReplays();
 const today=localDate();if(S.pastFor!==today){S.pastComplete=false;S.pastRetryAt=0;}   // past midnight, last night's finals belong in the run
 if(S.pastComplete||S.pastLoading||Date.now()<S.pastRetryAt)return;S.pastLoading=true;const had=S.pastDays;let failed=0;
 const days=await Promise.all([1,2,3,4,5,6,7].map(async n=>{const date=dayAfter(today,-n);try{const data=await fetchDay(date,AbortSignal.timeout(15000));return {date,games:normalizeSportGames(data,sport).filter(g=>g.state==='post')};}catch{failed++;return had.find(d=>d.date===date)||{date,games:[]};}}));
 const list=$('games'),fromEnd=list.scrollWidth-list.scrollLeft;
 S.pastDays=days.filter(d=>d.games.length).reverse();S.pastFor=today;S.pastComplete=!failed&&S.pastDays.length>0;S.pastRetryAt=Date.now()+(failed?120000:600000);S.pastLoading=false;if(!had.length)S.stripScrolled=false;renderGuide();
 // A day filled in later lands left of what the viewer is looking at: hold the picture still.
 if(had.length&&S.pastDays.length>had.length&&S.mode==='live')list.scrollLeft=list.scrollWidth-fromEnd;
}
// The replay of a final: both teams by nickname (sites and ESPN spell cities differently), closest date first, so a series doesn't cross wires.
const teamKey=name=>String(name||'').trim().toLowerCase().split(/\s+/).at(-1);
function replayFor(g){
 const keys=g.teams.map(t=>teamKey(t.name)),at=Date.parse(g.date);let best=null,gap=36*3600000;
 for(const r of S.replays?.games||[]){const off=Math.abs(Date.parse(r.date)-at);if(off<gap&&keys.includes(teamKey(r.away))&&keys.includes(teamKey(r.home))){best=r;gap=off;}}
 return best;
}
// The past week barely changes, so its tiles are built once per set of days, replay list and followed team.
const pastMemo={days:null,replays:null,error:'',who:'',today:false,html:'',kept:0};
function pastRun(today){
 const who=(selectedTeam()?.players||[]).filter(p=>p.active).map(p=>p.teamId+':'+p.name).join(),replays=S.replays?.games||null,error=S.replayError||'';
 if(pastMemo.days!==S.pastDays||pastMemo.replays!==replays||pastMemo.error!==error||pastMemo.who!==who||pastMemo.today!==today)Object.assign(pastMemo,{days:S.pastDays,replays,error,who,today,html:S.pastDays.map(d=>`<li class="week-label" aria-hidden="true">${esc(new Date(d.date+'T12:00:00').toLocaleDateString([],{weekday:'short'}))}</li>`+d.games.map(g=>pastTile(g,d.date)).join('')).join('')+(today?'<li class="week-label" aria-hidden="true">Today</li>':''),kept:S.pastDays.reduce((n,d)=>n+d.games.length+1,0)+(today?1:0)});
 return pastMemo;
}
function pastTile(g,date){
 const diff=Number(g.teams[0].score)-Number(g.teams[1].score),replay=replayFor(g);
 const rows=g.teams.map((t,i)=>{const logo=teamLogo(t,sport),trail=i===0?diff<0:diff>0;return `<span class="g-team${trail?' trail':''}" title="${esc(t.name)}"><span class="team-logo">${logo?`<img src="${esc(logo)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="team-code">${esc(t.abbr)}</span><span class="team-name">${esc(nickname(t))}</span><b class="team-score">${esc(t.score??'—')}</b></span>`;}).join('');
 const mine=playersIn(g),names=mine.map(p=>`<span>${esc(p.name)}</span>`).join('');
 return `<li class="tile past${mine.length?' mine':''}${replay?'':' off'}" style="--away:${teamColor(g.teams[0],sport)};--home:${teamColor(g.teams[1],sport)}"><button class="game" tabindex="-1" ${replay?`data-past-replay="${esc(replay.id)}"`:'aria-disabled="true"'} aria-label="${esc(tileLabel(g,'final, '+new Date(date+'T12:00:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}),replay?'Watch the replay':S.replayError?'Replay unavailable':'No replay yet'))}"><span class="g-status"><span class="tag final">FINAL</span><span class="g-when">${esc(new Date(date+'T12:00:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}))}</span></span><span class="g-matchup">${rows}</span><span class="g-drive quiet"><span>${esc(situation(g))}</span></span><span class="g-bar idle" aria-hidden="true"></span></button><div class="g-footer"><span class="g-names">${names||'<span>Final</span>'}</span><span class="g-cta">${replay?'Replay':S.replayError?'Replay unavailable':''}</span></div></li>`;
}
const STATE_ORDER={in:0,pre:1,hold:2,post:3};
function renderGuide(){
 if(S.mode==='replay'){renderReplayGuide();renderStreams();return;}
 const followedIds=followed(),order=STATE_ORDER;
 // Your games first, then live, upcoming and finals.
 const yours=g=>g.teams.some(t=>followedIds.includes(t.id))?0:1;
 const games=S.games.slice().sort((a,b)=>order[a.state]-order[b.state]||yours(a)-yours(b)||Date.parse(a.date)-Date.parse(b.date));
 const live=S.games.filter(g=>g.state==='in').length;
 // The Live dot reports today's slate only; browsing another day keeps the last answer.
 if(isToday()&&!S.gamesLoading&&!S.gamesError){$('liveDot').classList.toggle('on',live>0);$('liveDot').parentElement?.setAttribute?.('title',live?`${live} ${config.label} game${live===1?'':'s'} live now`:`No ${config.label} games live right now`);}
 setText('gameCount',live?live+' live':S.games.length?S.games.length+' games':'');setText('dayLabel',dayLabel());
 const past=isToday()&&S.pastDays.length?pastRun(games.length>0):'';
 const tiles=games.map(g=>{
  const available=urls(g).length>0,away=available&&!inlineUrls(g).length,watching=S.current===g.id,mine=playersIn(g),selectable=available||g.state!=='post';
  const tag=watching&&pool.get(g.id)?['ON AIR','onair']:g.state==='hold'?['DELAYED','amber']:g.state==='post'?['FINAL','final']:g.state==='pre'?['LATER','later']:g.onBreak?['BREAK','muted']:mine.length?['YOUR GAME','go']:['LIVE','live'];
  const known=g.state!=='pre',diff=known?Number(g.teams[0].score)-Number(g.teams[1].score):0;
  const rows=g.teams.map((t,i)=>{const logo=teamLogo(t,sport),trail=g.state==='post'&&known&&(i===0?diff<0:diff>0);
   return `<span class="g-team${trail?' trail':''}" title="${esc(t.name)}"><span class="team-logo">${logo?`<img src="${esc(logo)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="team-code">${esc(t.abbr)}</span><span class="team-name">${esc(nickname(t))}</span><b class="team-score">${known?esc(t.score??'—'):'—'}</b></span>`;}).join('');
  const pct=progress(g),line=`<span class="g-drive${g.state==='in'&&!g.onBreak?'':' quiet'}"><span>${esc(situation(g))}</span>${mine.length&&g.state!=='post'?`<span>${mine.length} yours</span>`:''}</span><span class="g-bar${pct===null?' idle':''}" aria-hidden="true">${pct===null?'':`<i style="width:${pct}%"></i>`}</span>`;
  const names=mine.map(p=>`<span class="${g.state==='in'&&!g.onBreak?'on':''}">${esc(p.name)}</span>`).join('')||(g.tv?`<span class="tv">${esc(g.tv)}</span>`:`<span>${esc(config.label)}</span>`);
  const onScreen=watching&&!!pool.get(g.id);
  const cta=onScreen?'On screen':g.state==='pre'?'':away?'Opens in new tab':available?'Watch':'';
  const action=onScreen?'On screen':g.state==='pre'&&available?'Starts later. See when':away?'Opens in a new tab':available?'Watch this game':g.state==='post'?'Game finished':'Add a stream to watch';
  return `<li class="tile${watching?' watching':''}${selectable?'':' off'}${mine.length?' mine':''}" style="--away:${teamColor(g.teams[0],sport)};--home:${teamColor(g.teams[1],sport)}"><button class="game" data-watch="${esc(g.id)}" aria-pressed="${watching}" aria-label="${esc(tileLabel(g,watching?'on air':g.state==='in'?(g.onBreak?'on a break':'live'):g.state==='pre'?'starts '+gameTime(g):g.state==='post'?'final':'delayed',action))}" ${selectable?'':'disabled'}><span class="g-status"><span class="tag ${tag[1]}">${tag[0]}</span><span class="g-when">${g.state==='post'?'':esc(gameTime(g))}</span></span><span class="g-matchup">${rows}</span>${line}</button><div class="g-footer"><span class="g-names">${names}</span>${streamChip(g)}${cta?`<span class="g-cta">${cta}</span>`:''}</div></li>`;
 }).join('');
 const off=games.length?'':offSeasonReplays();
 const none=games.length||off||past&&S.replays?.games?.length?'':`<li class="empty">${S.gamesError?'Game updates are unavailable. Trying again shortly.':S.gamesLoading?'Loading '+config.label+' games…':S.replayError?'No '+config.label+' games in the next week · replays are unavailable, trying again…':S.replayLoading?'No '+config.label+' games in the next week · finding replays…':'No '+config.label+' games in the next week.'}</li>`;
 if(games.length)put('games',tiles,past.html,past.kept);else put('games',off+(past?past.html:'')+none);
 if(!games.length)stripToNewest(!!(off||past));
 if(past&&games.length&&!S.stripScrolled){const first=$('games').querySelector?.('.tile:not(.past)');if(first?.offsetLeft!==undefined){$('games').scrollLeft=Math.max(0,first.offsetLeft-48);S.stripScrolled=true;S.stripTarget=null;}}
 // Keep the game on screen in view in the strip.
 if(S.current&&S.current!==S.stripShown){S.stripShown=S.current;for(const b of $('games').querySelectorAll?.('[data-watch]')||[])if(b.dataset.watch===S.current)b.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});}
 renderStreams();
}
// The Streams dialog answers in both modes: its button stays up in Replay.
function renderStreams(){
 const open=S.games.filter(g=>g.state!=='post'),ready=open.filter(g=>urls(g).length).length;
 setText('streamSummary',open.length?`${ready} of ${open.length} ${nounGames(open.length)} ${isToday()?'today':S.lookahead?'coming up':'that day'} ${hasHave(ready,open.length)} a stream ready`:S.games.length?'Every game on this day is final':isToday()?'No games this week':'No games on this date');
 setText('streamsCount',ready?String(ready):'');
 const listed=S.games.filter(g=>g.state!=='post'||saved.streams[g.key]?.primary||saved.streams[g.key]?.backup).sort((a,b)=>STATE_ORDER[a.state]-STATE_ORDER[b.state]||Date.parse(a.date)-Date.parse(b.date));
 renderStreamRows(listed);
}
// The Streams dialog: every game is a row with its source choice and link fields in place, as on the NFL page.
// The list is rebuilt only when something about it changed, and never under a field someone is typing in or a button still held down:
// a click released on nothing is lost. A focused button is rebuilt, and given its focus back.
function streamRow(g){
 const links=saved.streams[g.key]||{},showing=!!(links.primary||links.backup)||S.streamFieldsOpen.has(g.id);
 const logos=g.teams.map(t=>{const src=teamLogo(t,sport);return src?`<img src="${esc(src)}" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer">`:'';}).join('');
 return `<div class="stream-row" data-stream-game="${esc(g.id)}"><div class="stream-game"><span class="stream-logos">${logos}</span><span class="stream-name"><b>${esc(g.teams.map(t=>t.abbr).join(' @ '))}</b><small><span data-stream-time="${esc(g.id)}">${esc(gameTime(g))}</span> · <span class="source-state" data-source-state="${esc(g.id)}"></span> · <a href="${esc(gamecast(g))}" target="_blank" rel="noopener noreferrer">Gamecast ↗</a></small></span></div><div class="stream-source-options" data-sources="${esc(g.id)}"></div><div class="stream-fields" data-fields="${esc(g.id)}" ${showing?'':'hidden'}><label>Link<input type="text" data-key="${esc(g.id)}" value="${esc(links.primary||'')}" placeholder="Paste a link to the stream" aria-label="Stream for ${esc(g.name)}"></label><label>Backup <span class="muted">optional</span><input type="text" data-key="${esc(g.id)}" data-backup="true" value="${esc(links.backup||'')}" placeholder="https://…" aria-label="Backup stream for ${esc(g.name)}"></label></div></div>`;
}
function renderStreamRows(listed){
 const signature=JSON.stringify([S.date,listed.map(g=>[g.id,g.state,saved.streams[g.key]?.primary||'',saved.streams[g.key]?.backup||'',S.streamFieldsOpen.has(g.id)])]),active=document.activeElement;let refocus=null;
 if(signature!==S.streamSignature){
  if(S.streamsPressed||active?.matches?.('#savedStreams input')){S.streamsDirty=true;}
  else{if(active?.dataset?.sourceMode)refocus=`[data-source-game="${String(active.dataset.sourceGame).replace(/["\\]/g,'')}"][data-source-mode="${active.dataset.sourceMode}"]`;S.streamSignature=signature;S.streamsDirty=false;put('savedStreams',listed.map(streamRow).join('')||`<p class="empty">${S.games.length?'Every game on this day is final.':'No games to add streams for this week.'}</p>`);}
 }
 renderSourceOptions(listed);
 if(refocus)$('savedStreams').querySelector?.(refocus)?.focus?.();
}
function renderSourceOptions(listed=S.games){
 for(const g of listed){
  const box=$('savedStreams').querySelector?.(`[data-sources="${String(g.id).replace(/["\\]/g,'')}"]`);if(!box)continue;
  const links=saved.streams[g.key]||{},providers=[...new Set(streamFinder.options(g).map(x=>x.provider))],n=urls(g).length;
  const choices=[['auto','Auto'],...['NTV','StreamCorner'].filter(p=>providers.includes(p)).map(p=>[p,p]),['custom','My link']];
  const selected=(links.mode||'custom')==='custom'&&!links.primary&&!links.backup?'auto':links.mode||'custom';
  const state=selected==='custom'?'Your link'+(n>1?' · backup ready':''):providers.length?'Found on '+providers.join(' & ')+(n&&!inlineUrls(g).length?' · opens in a new tab':''):streamFinder.pending?'Searching…':n?'Stream ready':'No stream found yet';
  const built=box.querySelectorAll?.('[data-source-mode]')||[];
  // The buttons stay once built: replacing one under a press or a focus loses the click or the keyboard's place.
  if(built.length===choices.length)for(const b of built)b.setAttribute('aria-pressed',String(selected===b.dataset.sourceMode));
  else box.innerHTML=`<div class="seg" role="group" aria-label="Play ${esc(g.name)} from">`+choices.map(([id,label])=>`<button type="button" data-source-game="${esc(g.id)}" data-source-mode="${esc(id)}" aria-pressed="${selected===id}">${esc(label)}</button>`).join('')+'</div>';
  for(const line of $('savedStreams').querySelectorAll?.(`[data-stream-time="${String(g.id).replace(/["\\]/g,'')}"]`)||[])line.textContent=gameTime(g);
  for(const line of $('savedStreams').querySelectorAll?.(`[data-source-state="${String(g.id).replace(/["\\]/g,'')}"]`)||[]){line.textContent=state;line.classList.toggle('ok',n>0);}
 }
}
function selectGame(id,{manual=true,url=null}={}){
 const game=S.games.find(g=>g.id===id);if(!game)return;const source=url||inlineUrls(game)[0];if(!source&&!urls(game).length){openStream(id);return;}
 if(S.clip)leaveClip(false);
 // Before the start, or with a stream that refuses a frame, nothing loads: the screen says when, or offers the real page.
 if(!source||game.state==='pre'&&!S.earlyOpen.has(id)){if(S.current&&pool.get(S.current))pool.close(S.current);S.current=id;S.manual=true;S.lastSwitch=Date.now();S.autoAttempted=true;S.playing=false;pool.setRunning(false);$('overlay').hidden=false;renderGuide();renderTransport();return;}
 if(S.current!==id){S.lastSwitch=Date.now();S.manual=manual;}else if(manual)S.manual=true;
 const slot=pool.get(id);if(!slot||slot.url!==source){pool.open(id,{url:source,page:streamFinder.original(source),type:streamType(source),live:true,autoReconnect:saved.autoReconnect});}
 S.autoAttempted=true;S.current=id;S.playing=true;pool.setRunning(true,{resumeVisible:false});pool.show(id);$('overlay').hidden=true;renderGuide();renderTransport();
}
// Play with nothing on screen stays on Play unless a game is coming that the page can show itself: the status line says what to do instead.
function setPlaying(on){S.autoAttempted=true;S.playing=on;pool.setRunning(on);if(on&&!pool.current)direct();if(on&&!pool.current&&!S.clip&&!(S.mode==='live'&&S.games.some(g=>g.state!=='post'&&inlineUrls(g).length))){S.playing=false;pool.setRunning(false);}renderTransport();}
function direct(){
 if(S.mode!=='live'||S.clip||!S.playing||!saved.auto&&pool.current)return;
 const cutoff=Date.now()-saved.delay*1000,delayed=S.history.filter(h=>h.at<=cutoff).at(-1)||S.history[0];
 const games=delayed?.games||S.games,blocked=new Set([...S.blocked].filter(([,until])=>until>Date.now()).map(([id])=>id));
 const choice=chooseSportGame(games,{streams:Object.fromEntries(S.games.map(g=>[g.key,{primary:inlineUrls(g)[0],backup:inlineUrls(g)[1]}])),followed:followed(),currentId:S.current,manual:S.manual,blocked,lastSwitch:S.lastSwitch,stayThrough:pool.current?.kind==='embed'});
 if(choice&&choice.id!==S.current)selectGame(choice.id,{manual:false});
 // Keep the current source through a data outage or an empty slate. A stale
 // scoreboard never tears down a working video or returns the viewer home.
}
// What the first screen's main button plays: a game on now with a stream, else the newest replay.
function firstPick(){
 const live=S.mode==='live'?chooseSportGame(S.games,{streams:Object.fromEntries(S.games.map(g=>[g.key,{primary:urls(g)[0]}])),followed:followed()}):null;
 if(live)return {label:`Watch ${nickname(live.teams[0])} at ${nickname(live.teams[1])}`,run:()=>selectGame(live.id)};
 const newest=S.replays?.games?.[0];return newest?{label:'Watch the latest replay',run:()=>{setMode('replay');void selectReplay(newest.id);}}:null;
}
function showAction(action){S.ovRun=action?.run||null;$('watchFirst').hidden=!action;if(action)setText('watchFirst',action.label);}
function replayStatus(rp){const n=rp.sources?.length||0;return (rp.waited||0)>=45000&&!rp.started?(n>1?'If it hasn’t started, try another link.':'If it hasn’t started, try the new-tab link on the video.'):n>1?`Full game replay · link ${rp.index+1} of ${n}`:'Full game replay';}
function renderTransport(){
 const p=pool.current,g=currentGame(),embed=p?.kind==='embed',slot=pool.get(pool.visible),stage=document.querySelector('.stage');
 const clipOn=!!S.clip,chosen=!p&&!clipOn&&S.mode==='live'&&g?g:null,early=chosen?.state==='pre'&&!S.earlyOpen.has(chosen.id)?chosen:null,away=chosen&&!inlineUrls(chosen).length&&urls(chosen).length?chosen:null;
 setText('playButton',S.playing?'Pause':'Play');$('playButton').dataset.playing=String(S.playing);$('playButton').setAttribute('aria-label',S.playing?'Pause':'Play');
 setText('muteButton',saved.muted?'Turn sound on':'Mute sound');$('muteButton').hidden=embed&&!p.control?.active;$('reloadStream').hidden=typeof p?.reload!=='function';$('nextStream').hidden=!p||!g||inlineUrls(g).length<2;$('nextStream').disabled=!S.playing;
 $('openStream').hidden=!embed;$('openStream').href=embed?(slot?.source?.page||slot?.url||'#'):'#';$('embedHelp').hidden=!embed;
 const clip=S.clip?S.highlights.find(h=>h.id===S.clip):null,rp=S.mode==='replay'?S.replay:null,replayGame=rp?S.replays?.games.find(x=>x.id===rp.id):null;
 setText('watchTitle',clip?clip.title:replayGame?replayGame.title:g?.name||config.name+' channel');setText('channelMode',clip?'HIGHLIGHT':S.mode==='replay'?'REPLAY':g?gameTime(g):config.label+' LIVE');setText('pictureNote',clip||S.mode==='replay'?'':saved.delay+' sec delay');
 $('leaveClip').hidden=!clip;$('nextReplaySource').hidden=!(rp?.sources?.length>1);$('autoMode').hidden=!!clip||S.mode==='replay';
 $('gamecastLink').hidden=!g;$('gamecastLink').href=g?gamecast(g):'#';
 setText('autoMode','Automatic: '+(saved.auto?'on':'off'));$('autoMode').setAttribute('aria-pressed',String(saved.auto));
 setText('autoChip',!saved.auto?'Manual':S.manual?'Your choice':'Automatic');$('autoChip').classList.toggle('on',saved.auto&&!S.manual);$('autoChip').hidden=!!clip||S.mode==='replay';
 $('bug').hidden=!g||!!clip||!!rp;$('bugTag').dataset.state=g?.state||'';
 if(g){const [a,b]=g.teams;setText('bugTag',g.state==='in'?(g.onBreak?'BREAK':'LIVE'):g.state==='post'?'FINAL':g.state==='hold'?'DELAYED':'LATER');put('bugGame',g.state==='pre'?`${esc(a.abbr)} <span class="at">@</span> ${esc(b.abbr)}`:`${esc(a.abbr)} <b>${esc(a.score??'')}</b> – <b>${esc(b.score??'')}</b> ${esc(b.abbr)}`);setText('bugClock',gameTime(g));}
 const yours=g&&!clip&&!rp?playersIn(g):[];$('lower').hidden=!yours.length;put('lowerMain',yours.map(p=>`<span>${esc(p.name)}<i>${esc(p.position)}</i></span>`).join(''));
 setText('watchStatus',clip?'Highlight · the game comes back when it ends.':rp?(rp.loading?'Finding the replay video…':rp.error||replayStatus(rp)):S.mode==='replay'?'Pick a replay above.':early?'This game hasn’t started yet.':away?'This game opens in a new tab.':!p?(S.playing?'We’ll start when a game goes live.':'Pick a game above.'):!S.playing?'Paused.':S.manual?'Returns after the next break.':selectedTeam()?'Following '+selectedTeam().name+' at game breaks.':'Following available games at game breaks.');
 $('streamHealth').hidden=!p?.reconnecting;setText('streamHealth',p?.recoveryMessage||'');
 const wantsSound=!!p?.audioLocked&&!saved.muted&&S.playing;$('unmute').hidden=!wantsSound||p?.kind==='provider';$('soundHint').hidden=!wantsSound||p?.kind!=='provider';if(!$('soundHint').hidden)put('soundHint',`<b>${touch()?'Tap':'Click'} the video</b> once for sound`);
 setText('fullButton',document.fullscreenElement||document.webkitFullscreenElement||stage.classList.contains('theater')?'Exit full screen':'Full screen');
 const outside=!p&&rp?.sources?.[rp.index]&&opensOutside(rp.sources[rp.index])?rp.sources[rp.index]:null,page=away?streamFinder.original(urls(away)[0]):'',link=outside?.url||(!p?rp?.link:'')||page;
 $('playButton').hidden=!!(outside||rp?.link&&!p||away||early);
 $('ovOpen').hidden=!link;$('ovOpen').href=link||'#';$('ovBack').hidden=!(early||away);
 // A replay on its way gets a word: a dark frame should never look broken. It stops once footage reports, and steps aside for an ad.
 if(rp&&p&&!rp.started&&(p.kind!=='provider'||p.advances>0)){rp.started=true;renderGuide();}
 const starting=!!rp&&p?.kind==='provider'&&pool.visible==='rp:'+rp.id&&S.playing&&!p.inAd&&!p.error&&!rp.started,waited=rp?.waited||0;
 $('switching').hidden=!starting||waited>=45000;if(!$('switching').hidden)setText('switching',waited<12000?'Loading the replay video…':`Still loading · if it waits, ${touch()?'tap':'click'} the video to start it`);
 $('frameHelp').hidden=!starting||!touch()&&waited<LOAD_LIMIT;$('frameOpen').href=rp?.sources?.[rp.index]?.url||'#';
 if(!p&&S.mode==='replay'){$('overlay').hidden=false;setText('ovOpen','Watch replay ↗');setText('ovTitle',outside?'This replay opens on its own page.':rp?.loading?'Opening your replay…':rp?.link?'This replay won’t play inside the page on this device.':rp?.error?'That replay won’t open right now.':'Full game replays.');setText('ovText',outside?`This video won’t play inside another page. It opens in a new tab, from the first minute.${rp.sources.length>1?' Try another link for a second one.':''}`:rp?.loading?'Finding the video on the replay site.':rp?.link?'It opens in a new tab, from the first minute. The channel and scores stay here.':rp?.error?'Choose the game again to retry, or pick another one above.':S.replays?.games?.length?'Pick a game above to watch it from the first minute.':S.replayError||(S.replayLoading?'Finding the latest replays…':S.replays?.note||'No replays listed yet.'));showAction(rp?null:firstPick());$('connectFirst').hidden=true;return;}
 if(early||away){$('overlay').hidden=false;const when=early?new Date(early.date).toLocaleString([],{...(isToday()?{}:{weekday:'long'}),hour:'numeric',minute:'2-digit'}):'';setText('ovOpen',early?'Open the stream early ↗':'Watch in a new tab ↗');setText('ovTitle',early?`${START} ${isToday()?'at ':''}${when}`:`${chosen.name} opens in a new tab`);setText('ovText',early?(away?'This game hasn’t started yet. Its stream opens in a new tab when you’re ready.':'This game hasn’t started yet. We’ll put it on when it does, or you can open the stream now.'):'This stream won’t play inside our page, so it opens on its own site in a new tab. Scores stay here.');showAction(early&&!away?{label:'Open the stream early',run:()=>{S.earlyOpen.add(early.id);selectGame(early.id);}}:null);$('connectFirst').hidden=true;return;}
 $('connectFirst').hidden=false;
 if(!p){$('overlay').hidden=false;const pick=firstPick(),listed=isToday()&&!!S.replays?.games?.length,finding=isToday()&&(S.replayLoading||S.replays===null&&!S.replaysAt),keep=hasSaved()?' Your saved streams and fantasy connection will be here for the next game day.':'';setText('ovTitle',S.games.length?'Every game. Your way.':S.gamesError?'Game updates are unavailable.':S.gamesLoading?'Getting your games ready…':finding?'Finding replays…':isToday()?`No ${config.label} games this week.`:`No ${config.label} games on this date.`);setText('ovText',S.games.length?'Pick any game above and watch it here. Connect ESPN and the channel moves to your fantasy players’ games at the next break.':S.gamesError?'Trying again shortly.'+(hasSaved()?' Your streams and fantasy connection are saved.':''):S.gamesLoading?'Connecting to ESPN for this day’s schedule.':finding?'Looking for the latest full games.':!isToday()?'Pick another date, or switch to Replay.':listed?'Pick a full game replay from the row above.'+keep:'Check back when the next games are scheduled.'+keep);showAction(pick);}
}
// Add a stream: the Streams dialog, with that game's link field open and focused.
function openStream(id){
 if(!S.games.length){$('scheduleStatus').textContent='Choose a date with scheduled games first.';return;}
 const g=S.games.find(g=>g.id===id)||S.games.find(g=>g.id===S.current)||S.games.find(g=>g.state!=='post')||S.games[0];
 S.streamFieldsOpen.add(g.id);S.streamSignature=null;openStreams();
 const input=$('savedStreams').querySelector?.(`[data-fields="${String(g.id).replace(/["\\]/g,'')}"] input`);input?.scrollIntoView?.({block:'center'});input?.focus?.();
}
// Each game counts its own saves: a save on another row cannot cancel this one's swap.
const nextSave=g=>{const n=(S.streamSaves.get(g.id)||0)+1;S.streamSaves.set(g.id,n);return n;};
async function applyStream(g,request){
 const links=saved.streams[g.key];if(!links)return;const old=pool.get(g.id),date=S.date;
 if(links.mode==='custom')await Promise.all([links.primary,links.backup].filter(Boolean).map(u=>streamFinder.resolve(u)));
 if(request!==S.streamSaves.get(g.id)||date!==S.date)return;
 if(S.current===g.id&&pool.get(g.id)===old&&old?.url!==inlineUrls(g)[0]){pool.close(g.id);if((S.playing||!old)&&urls(g).length)selectGame(g.id,{manual:S.manual});else S.current=null;}
 renderGuide();renderTransport();
}
// A link typed in a row is saved when the field changes; the player follows if that game is on screen.
async function saveStreamLink(g,{primary,backup}){
 const old=saved.streams[g.key]||{},clean={primary:safeVideo(String(primary??old.primary??'').trim()),backup:safeVideo(String(backup??old.backup??'').trim())};
 const changed=clean.primary!==(old.primary||'')||clean.backup!==(old.backup||'');
 saved.streams[g.key]={...clean,mode:changed&&(clean.primary||clean.backup)?'custom':old.mode||'custom'};if(!clean.primary&&!clean.backup&&saved.streams[g.key].mode==='custom')saved.streams[g.key].mode='auto';
 persist();S.streamSignature=null;$('streamsError').textContent='';
 await applyStream(g,nextSave(g));void refreshStreamLinks();renderGuide();renderTransport();
}
$('savedStreams').onclick=async event=>{
 const button=event.target.closest?.('[data-source-game]');if(!button)return;const g=S.games.find(g=>g.id===button.dataset.sourceGame);if(!g)return;
 const mode=button.dataset.sourceMode;if(!['custom','auto','NTV','StreamCorner'].includes(mode))return;
 const links=saved.streams[g.key]||{},fields=$('savedStreams').querySelector?.(`[data-fields="${String(g.id).replace(/["\\]/g,'')}"]`);
 // With no link saved yet, My link only opens the fields; it takes effect once there is a link to play.
 if(mode==='custom'&&!links.primary&&!links.backup){if(S.streamFieldsOpen.has(g.id))S.streamFieldsOpen.delete(g.id);else S.streamFieldsOpen.add(g.id);S.streamSignature=null;renderGuide();if(S.streamFieldsOpen.has(g.id))$('savedStreams').querySelector?.(`[data-fields="${String(g.id).replace(/["\\]/g,'')}"] input`)?.focus?.();return;}
 if(fields)fields.hidden=mode!=='custom';
 saved.streams[g.key]={...links,mode};persist();renderSourceOptions([g]);await applyStream(g,nextSave(g));
};
$('savedStreams').onchange=async event=>{
 const input=event.target;if(!input?.dataset?.key)return;const g=S.games.find(g=>g.id===input.dataset.key);if(!g)return;
 try{await saveStreamLink(g,input.dataset.backup==='true'?{backup:input.value}:{primary:input.value});input.removeAttribute?.('aria-invalid');}
 catch(error){input.setAttribute?.('aria-invalid','true');$('streamsError').textContent=error.message;}
};
const streamsSettled=()=>{if(S.streamsDirty)setTimeout(()=>{if(!S.streamsPressed&&!document.activeElement?.matches?.('#savedStreams input'))renderGuide();},0);};
$('savedStreams').addEventListener?.('focusout',streamsSettled);
$('savedStreams').addEventListener?.('pointerdown',()=>{S.streamsPressed=true;});
for(const name of ['pointerup','pointercancel'])document.addEventListener(name,()=>{if(S.streamsPressed){S.streamsPressed=false;streamsSettled();}});
$('games').onclick=event=>{const past=event.target.closest('[data-past-replay]');if(past){setMode('replay');selectReplay(past.dataset.pastReplay);$('watchTitle').focus?.({preventScroll:true});return;}const replay=event.target.closest('[data-replay]');if(replay){selectReplay(replay.dataset.replay);$('watchTitle').focus?.({preventScroll:true});return;}const add=event.target.closest('[data-add-stream]'),watch=event.target.closest('[data-watch]');if(add){S.streamOpener=add.dataset.addStream;openStream(add.dataset.addStream);return;}if(watch&&!watch.disabled){selectGame(watch.dataset.watch);$('watchTitle').focus?.({preventScroll:true});}};
$('games').addEventListener?.('keydown',e=>stripKeys(e,$('games')));
function openStreams(){renderGuide();if(!$('streamsDetails').open)$('streamsDetails').showModal();}
$('streamsButton').onclick=()=>{S.streamOpener=null;openStreams();};$('closeStreams').onclick=$('doneStreams').onclick=()=>$('streamsDetails').close();
// The strip may have been rebuilt while the dialog was open: focus goes back to the chip that opened it, or failing that the Streams button.
$('streamsDetails').addEventListener?.('close',()=>{const chip=S.streamOpener&&[...($('games').querySelectorAll?.('[data-add-stream]')||[])].find(b=>b.dataset.addStream===S.streamOpener);S.streamOpener=null;(chip||$('streamsButton')).focus?.();});
$('refreshStreams').onclick=()=>{streamFinder.cancel();loadGames();};
// Quick clicks chain from the last target while its scroll is moving. The target expires by time, since not every browser has scrollend.
const stripStep=dir=>{const list=$('games');if(!list.scrollTo)return;const max=Math.max(0,list.scrollWidth-list.clientWidth),moving=S.stripTarget!==null&&Date.now()-S.stripStartedAt<700&&Math.abs(S.stripTarget-list.scrollLeft)>8,from=moving?Math.min(max,S.stripTarget):list.scrollLeft;S.stripStartedAt=Date.now();S.stripTarget=Math.max(0,Math.min(max,from+dir*Math.max(240,(list.clientWidth||800)*.8)));list.scrollTo({left:S.stripTarget,behavior:'smooth'});};
for(const name of ['scrollend','pointerdown','touchstart'])$('games').addEventListener?.(name,()=>{S.stripTarget=null;},{passive:true});
mountGameTiles({$,storage:localStorage});
mountMatchupRows({$});
$('stripPrev').onclick=()=>stripStep(-1);$('stripNext').onclick=()=>stripStep(1);$('games').addEventListener?.('scroll',()=>stripEnds($('games'),$('stripPrev'),$('stripNext')),{passive:true});
$('games').addEventListener?.('wheel',e=>{S.stripTarget=null;const list=$('games');if(Math.abs(e.deltaY)<=Math.abs(e.deltaX)||list.scrollWidth<=list.clientWidth)return;e.preventDefault();list.scrollLeft+=e.deltaY;},{passive:false});
const RAIL=[['matchup','matchupTab','matchupPanel'],['highlights','highlightsTab','highlightsPanel'],['chat','chatTab','chatPanel']];
function showPanel(tab){
 if(tab==='chat'&&$('chatTab').hidden)tab='matchup';for(const [name,tabId,panelId] of RAIL){const on=name===tab;$(tabId).setAttribute('aria-selected',String(on));$(tabId).tabIndex=on?0:-1;$(panelId).hidden=!on;}if(tab==='chat')S.chat?.markRead();}
for(const [name,tabId] of RAIL){$(tabId).onclick=()=>showPanel(name);$(tabId).onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const visible=RAIL.filter(r=>!$(r[1]).hidden),i=visible.findIndex(r=>r[1]===tabId),next=e.key==='Home'?0:e.key==='End'?visible.length-1:(i+(e.key==='ArrowRight'?1:-1)+visible.length)%visible.length;showPanel(visible[next][0]);$(visible[next][1]).focus?.();};}
function chatRoom(){if(!S.chat)return;const room=chatRoomFor(sport,saved.leagueId);if(!room&&!$('chatPanel').hidden)showPanel('matchup');S.chat.setRoom(room,room?`${S.league?.name||'Your league'} room`:'');S.chat.suggestName();}
$('headerScore').onclick=e=>{e.preventDefault();showPanel('matchup');$('scoreboardTitle').focus?.();};
$('watchFirst').onclick=()=>S.ovRun?.();$('ovBack').onclick=()=>{S.current=null;S.manual=false;setPlaying(true);renderGuide();};$('playButton').onclick=()=>{const pick=!S.playing&&!pool.current&&!S.clip&&!S.current?firstPick():null;if(pick)pick.run();else setPlaying(!S.playing);};$('reloadStream').onclick=()=>{if(S.playing)pool.current?.reload?.();};
function rotateSource(id,manual=false){if(!S.playing||id!==S.current||!manual&&Date.now()<(S.rotations.get(id)||0))return;const g=currentGame(),links=inlineUrls(g),alternate=links.length>1?links[(links.indexOf(pool.get(id)?.url)+1)%links.length]:null;if(!g||!alternate)return;S.rotations.set(id,Date.now()+60000);selectGame(g.id,{url:alternate,manual:S.manual});}
$('nextStream').onclick=()=>rotateSource(S.current,true);
$('muteButton').onclick=()=>{saved.muted=!saved.muted;pool.setMuted(saved.muted);if(!saved.muted)pool.retryAudio();persist();renderTransport();};$('unmute').onclick=()=>{saved.muted=false;pool.setMuted(false);pool.retryAudio();persist();renderTransport();};
$('autoMode').onclick=()=>{saved.auto=!saved.auto;S.manual=false;persist();direct();renderTransport();};
const dayAfter=(value,days)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+days);return localDate(d);};
async function fetchDay(date,signal){
 const r=await fetch('/api/sports?sport='+sport+'&date='+date,{signal,cache:'no-store'}),data=await r.json();
 if(!r.ok)throw new Error(data.error||'Game feed unavailable');if(data.sport!==sport||data.date!==date)throw new Error('Unexpected schedule response');return data;
}
async function loadGames({manual=false}={}){
 const generation=++S.gameGeneration;clearTimeout(S.gameTimer);S.request?.abort();const controller=new AbortController();S.request=controller;const timeout=setTimeout(()=>controller.abort(),25000);
 S.gamesLoading=true;if(manual)setText('scheduleStatus','Refreshing…');renderTransport();
 try{
  // Today's slate, or the next day that has games (the next week at most) when today is empty.
  let date=S.dateLocked?S.date:localDate(),data=await fetchDay(date,controller.signal),lookahead=null;
  if(!S.dateLocked&&!(data.events||[]).length){
   // The answer holds for ten minutes, an empty week included, and polls in between ask only for today. Asked together, so a slow day costs one round trip and a bad day cannot sink the rest.
   const known=S.lookahead&&Date.now()-S.lookahead.at<600000?S.lookahead:null;
   if(known?.date===null)lookahead=known;
   else{
    const remembered=known&&known.date>localDate()?known.date:null,candidates=remembered?[remembered]:[1,2,3,4,5,6,7].map(n=>dayAfter(date,n));
    const settled=await Promise.allSettled(candidates.map(d=>fetchDay(d,controller.signal)));if(generation!==S.gameGeneration)return;
    const found=settled.findIndex(r=>r.status==='fulfilled'&&(r.value.events||[]).length),failed=settled.filter(r=>r.status==='rejected');
    // at:0 asks again next poll, because a day that failed before this one may have games.
    if(found>=0){date=candidates[found];data=settled[found].value;lookahead={date,at:settled.slice(0,found).some(r=>r.status==='rejected')?0:remembered?known.at:Date.now()};}
    else if(failed.length===settled.length||failed.length&&S.games.length)throw failed[0].reason;
    else if(!failed.length&&!remembered)lookahead={date:null,at:Date.now()};
   }
  }
  if(generation!==S.gameGeneration)return;
  if(date!==S.date){streamFinder.cancel();S.history=[];}
  S.date=date;S.lookahead=lookahead;S.gamesError=false;S.gamesLoading=false;S.games=normalizeSportGames(data,sport);S.season=data.season||S.season;S.history.push({at:Date.now(),games:S.games});S.history=S.history.filter(h=>Date.now()-h.at<660000);
  if(manual)setText('scheduleStatus','Updated '+new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));else if(!S.gamesError)setText('scheduleStatus','');renderGuide();direct();const chosen=currentGame();if(chosen&&!pool.current&&!S.clip&&S.mode==='live'&&chosen.state==='in'&&inlineUrls(chosen).length)selectGame(chosen.id,{manual:S.manual});renderTransport();if(S.discoveryReady)void refreshStreamLinks();void pollHighlights();renderHighlights();if(!S.dateLocked)void loadPastDays();
 }
 catch(error){if(generation===S.gameGeneration){S.gamesError=true;S.gamesLoading=false;setText('scheduleStatus',(S.games.length?'Showing last update · ':'Updates delayed · ')+'retrying');renderGuide();renderTransport();}}
 finally{clearTimeout(timeout);if(generation===S.gameGeneration){S.request=null;S.gameTimer=setTimeout(loadGames,!document.hidden&&(S.gamesError||S.games.some(g=>g.state==='in'||nearStart(g)))?15000:60000);}}
}
// Kept for tests and deep links: pins the guide to one date instead of today's slate.
function changeDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value)))return;streamFinder.cancel();S.date=value;S.dateLocked=value!==localDate();S.lookahead=null;S.history=[];S.games=[];S.gamesLoading=true;S.gamesError=false;renderGuide();loadGames();}
const defaultSeason=()=>sport==='mlb'?new Date().getFullYear():new Date().getFullYear()+(new Date().getMonth()>=6?1:0);
function openLeague(){
 $('leagueId').value=saved.leagueId;$('swid').value=saved.swid;$('s2').value=saved.s2;$('leagueSeason').value=saved.leagueSeason||S.season||defaultSeason();$('leagueTitle').textContent='Fantasy team · '+config.label;$('leagueError').textContent='';
 $('leagueImport').open=!saved.leagueId||!!S.leagueError;$('privateLeague').open=!!(saved.swid||saved.s2);$('leagueDialog').dataset.connected=String(!!saved.leagueId);$('forgetESPN').hidden=!(saved.leagueId||saved.swid||saved.s2);renderFantasy();if(!$('leagueDialog').open)$('leagueDialog').showModal();
}
for(const id of ['connectFirst','fantasyTeamButton','connectFromBoard','chooseTeam'])$(id).onclick=openLeague;
$('leagueAction').onclick=()=>{const open=!$('leagueImport').open;$('leagueImport').open=open;if(open)$('leagueId').focus?.();};
$('closeLeague').onclick=()=>$('leagueDialog').close();
// Forget means every league page's copy, nothing still on its way, and no timer left asking ESPN for a league that's gone.
$('forgetESPN').onclick=()=>{S.leagueGeneration++;clearTimeout(S.leagueTimer);Object.assign(saved,{swid:'',s2:'',leagueId:'',teamId:'',leagueSeason:null});S.league=null;S.leagueError='';S.leaguePending=false;S.leagueUpdated=0;S.forgotten=true;persist();forgetESPN(localStorage);$('importLeague').disabled=false;for(const id of ['leagueId','swid','s2'])$(id).value='';$('forgetESPN').hidden=true;$('leagueDialog').dataset.connected='false';$('leagueImport').open=true;chatRoom();renderFantasy();renderGuide();};
$('leagueForm').onsubmit=async event=>{event.preventDefault();
 const typed=$('leagueId').value.trim(),leagueId=/leagueId=(\d{1,12})/i.exec(typed)?.[1]||typed,season=Number(/seasonId=(\d{4})/i.exec(typed)?.[1]||$('leagueSeason').value),swid=$('swid').value.trim(),s2=$('s2').value.trim();
 if(!/^\d{1,12}$/.test(leagueId)){$('leagueImport').open=true;$('leagueError').textContent='Enter your league ID, or paste your league’s web address.';$('leagueId').focus?.();return;}
 if(!Number.isInteger(season)||season<2018||season>2035){$('leagueImport').open=true;$('privateLeague').open=true;$('leagueError').textContent='Enter a season between 2018 and 2035.';return;}
 $('leagueId').value=leagueId;$('leagueSeason').value=season;
 // Nothing changed: Done just closes. Anything new reconnects.
 if(S.league&&!S.leagueError&&leagueId===saved.leagueId&&season===Number(saved.leagueSeason)&&swid===saved.swid&&s2===saved.s2){$('leagueDialog').close();return;}
 await loadLeague({leagueId,swid,s2,season});};
async function loadLeague(input=null){
 if(!input&&!saved.leagueId)return;const explicit=!!input;input||={leagueId:saved.leagueId,swid:saved.swid,s2:saved.s2,season:saved.leagueSeason||S.season||defaultSeason()};
 const generation=++S.leagueGeneration;clearTimeout(S.leagueTimer);S.leaguePending=true;$('importLeague').disabled=true;$('leagueError').textContent='';renderFantasy();
 try{const r=await fetch('/api/sports/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,sport}),signal:AbortSignal.timeout(30000),cache:'no-store'}),data=await r.json();if(generation!==S.leagueGeneration)return;if(!r.ok){if(r.status===401){$('leagueImport').open=true;$('privateLeague').open=true;$('swid').focus?.();}throw new Error(data.error||'Could not load this league.');}if(data.leagueId!==input.leagueId||data.sport!==sport||!Array.isArray(data.teams))throw new Error('Unexpected league response.');
  const previous=saved.leagueId===input.leagueId?saved.teamId:'';S.league=data;S.forgotten=false;$('forgetESPN').hidden=false;S.leagueError='';S.leagueUpdated=Date.now();saved.leagueId=input.leagueId;saved.swid=input.swid;saved.s2=input.s2;saved.leagueSeason=input.season;saved.teamId=data.teams.find(t=>t.id===previous)?.id||data.teams.find(t=>t.id===data.ownedTeamId)?.id||'';persist();chatRoom();$('leagueDialog').dataset.connected='true';if(explicit){$('leagueImport').open=false;if(saved.teamId)$('leagueDialog').close();else $('scoreTeam').focus?.();}renderGuide();
 }catch(error){if(generation===S.leagueGeneration){S.leagueError=plainError(error,'Could not reach your league. Try again in a moment.');$('leagueError').textContent=S.leagueError;}}
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
 setText('leagueMeta',league&&points&&league.scoringPeriod?'Day '+league.scoringPeriod:'');$('leagueMeta').title=league?league.name+' · '+(points?'player points are for scoring day '+league.scoringPeriod+'; totals are the whole ESPN matchup':league.scoringType==='ROTO'?'rotisserie league':'category league'):'';
 setText('leagueState',league?'Connected · '+league.name:S.leaguePending?'Connecting to ESPN…':saved.leagueId?'League '+saved.leagueId+' · not loaded':'Not connected');
 put('leagueSummary',league?esc(league.name+' · '+league.teams.length+' teams · '+league.season)+(espn?` · <a href="${esc(espn)}" target="_blank" rel="noopener noreferrer">Open on ESPN ↗</a>`:''):S.forgotten?'Disconnected. Your ESPN login is forgotten on this device.':'');
 setText('leagueHelp',league?'Connected':S.leagueError?S.leagueError:'Paste your ESPN league link.');setText('leagueAction',league?'Change':'Connect');
 setText('importLeague',league&&!S.leagueError?'Done':'Connect');
 setText('fantasyStatus',S.leagueError?(S.leagueUpdated?'Last good update '+new Date(S.leagueUpdated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+'. ':'')+S.leagueError:S.leaguePending&&!league?'Getting your league from ESPN…':!league?'Connect a league to see players and your matchup.':!saved.teamId?'Choose your team using Fantasy team in the top bar.':'Updated '+new Date(S.leagueUpdated).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})+' · every 30 seconds');
 // Only say something when it needs attention; a healthy matchup speaks for itself.
 $('fantasyStatus').hidden=!S.leagueError&&!(league&&!saved.teamId);$('fantasyStatus').classList.toggle('sport-error',!!S.leagueError);
 const matches=match?.matches||[];$('matchupPicker').hidden=matches.length<2;put('matchupSelect',matches.map(m=>{const other=m.home?.teamId===saved.teamId?m.away:m.home;return `<option value="${esc(m.id)}">${esc(league.teams.find(t=>t.id===other?.teamId)?.name||'Bye')}</option>`;}).join(''));$('matchupSelect').value=match?.matchId||'';
 let status='Your team vs. your opponent',state='';
 if(match){if(!match.opponent)status=league.scoringType==='ROTO'?'Season standings on ESPN':'No opponent this matchup';else if(points&&match.yourPoints!==null&&match.opponentPoints!==null){const diff=match.yourPoints-match.opponentPoints;state=diff>0?'ahead':diff<0?'behind':'tied';status=diff===0?'All square':(diff>0?'Ahead by ':'Behind by ')+fmt(Math.abs(diff));}else status=points?'Matchup points':'Category matchup';}
 setText('matchupStatus',status);
 const board=$('scoreboard'),connect=!league&&!saved.leagueId;board.dataset.connect=String(connect);board.dataset.empty=String(!connect&&!match);board.dataset.state=state;
 setText('placeholderTitle',!league?(S.leagueError?'Your league is unavailable':'Getting your league…'):'Choose a team to follow');
 setText('placeholderText',!league?(S.leagueError||'Your lineup appears here in a moment.'):'Pick your franchise and its lineup appears here.');$('chooseTeam').hidden=!league&&!S.leagueError;
 // The scorebug: your total in gold, theirs in violet, a bar for the share.
 setText('fantasyTitle',match?.yours?.name||'Your team');setText('opponentTitle',match?(match.opponent?.name||'No opponent'):'Your opponent');$('fantasyTitle').title=$('fantasyTitle').textContent;$('opponentTitle').title=$('opponentTitle').textContent;
 setText('fantasyTotal',points&&match?fmt(match.yourPoints):'—');setText('opponentTotal',points&&match?.opponent?fmt(match.opponentPoints):'—');
 const mine=match?.yourPoints,theirs=match?.opponentPoints,share=points&&Number.isFinite(mine)&&Number.isFinite(theirs)&&mine+theirs>0?mine/(mine+theirs)*100:50;$('matchupBar').setAttribute('style','width:'+share.toFixed(1)+'%');
 const scored=points&&!!match?.opponent&&Number.isFinite(mine)&&Number.isFinite(theirs);
 $('headerScore').hidden=!scored;$('headerScore').dataset.state=state;$('headerScore').title=status;put('headerScore',scored?`<span>You</span><b>${brief(mine)}</b><i>–</i><b>${brief(theirs)}</b>`:'');
 // Starters slot by slot, then the bench, which never counts.
 const row=p=>({slot:p.slot,name:p.name,team:p.team||'FA',status:playerStatus(p),active:p.active&&playing(p),points:points?p.points:null,...(p.active?{}:{bench:true})});
 const lineup=t=>t?{...t,players:t.players.map(row)}:null;
 put('fantasyPlayers',match?headToHead(lineup(match.yours),lineup(match.opponent)):'');const bench=match?benchRows(lineup(match.yours),lineup(match.opponent)):'';put('fantasyBench',bench);$('benchTable').hidden=!match||!bench;$('benchTable').classList.toggle('solo',!match?.opponent);$('benchTable').classList.toggle('nopoints',!points);put('fantasyCols',matchupColumns(!!match?.opponent));put('benchCols',matchupColumns(!!match?.opponent));
 $('fantasyTable').hidden=!match;$('fantasyTable').classList.toggle('solo',!match?.opponent);$('fantasyTable').classList.toggle('nopoints',!points);
}
$('scoreTeam').onchange=event=>{if(!S.league?.teams.some(t=>t.id===event.target.value))return;saved.teamId=event.target.value;S.matchId='';persist();renderFantasy();renderGuide();renderHighlights();};$('matchupSelect').onchange=event=>{S.matchId=event.target.value;renderFantasy();};$('retryFantasy').onclick=()=>{if(saved.leagueId)loadLeague();else openLeague();};
async function refreshStreamLinks(){
 if(document.hidden||!S.games.length||streamFinder.pending)return;const date=S.date,generation=S.gameGeneration;
 streamFinder.enabled=saved.autoDiscover;const task=streamFinder.refresh(S.games,sport,Object.values(saved.streams).flatMap(x=>[x.primary,x.backup]).filter(Boolean)),discovery=streamFinder.generation;await task;
 if(date!==S.date||generation!==S.gameGeneration||discovery!==streamFinder.generation)return;setText('discoveryStatus',streamFinder.status);renderGuide();renderTransport();
 if(S.mode==='live'&&!S.autoAttempted&&saved.leagueId&&saved.teamId&&S.games.some(g=>g.state==='in'&&inlineUrls(g).length))setPlaying(true);
}
$('autoDiscover').checked=saved.autoDiscover;$('autoDiscover').onchange=e=>{saved.autoDiscover=e.target.checked;streamFinder.enabled=saved.autoDiscover;streamFinder.cancel();persist();void refreshStreamLinks();renderGuide();};
$('settingsButton').onclick=()=>$('settings').showModal();$('closeSettings').onclick=()=>$('settings').close();$('autoReconnect').checked=saved.autoReconnect;$('delay').value=saved.delay;
$('autoReconnect').onchange=event=>{saved.autoReconnect=event.target.checked;for(const slot of pool.slots.values())slot.player.setAutoReconnect?.(saved.autoReconnect);persist();};$('delay').onchange=event=>{saved.delay=Math.max(0,Math.min(600,Number(event.target.value)||0));event.target.value=saved.delay;persist();renderTransport();};
$('fullButton').onclick=async()=>{const stage=document.querySelector('.stage'),active=document.fullscreenElement||document.webkitFullscreenElement,request=++S.fullRequest;if(active||stage.classList.contains('theater')||S.fullWanted){S.fullWanted=false;stage.classList.remove('theater');try{if(active)await(document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen());}catch{}renderTransport();return;}S.fullWanted=true;stage.classList.add('theater');renderTransport();try{const fn=stage.requestFullscreen||stage.webkitRequestFullscreen;if(fn)await fn.call(stage,{navigationUI:'hide'});if(request!==S.fullRequest&&!S.fullWanted&&document.fullscreenElement===stage)await document.exitFullscreen();}catch{}renderTransport();};
for(const name of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(name,()=>{const stage=document.querySelector('.stage');if(document.fullscreenElement||document.webkitFullscreenElement)stage.classList.remove('theater');else if(!stage.classList.contains('theater'))S.fullWanted=false;renderTransport();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshStreamLinks();});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape'){S.fullWanted=false;S.fullRequest++;document.querySelector('.stage').classList.remove('theater');renderTransport();return;}
 const target=event.target;if(event.metaKey||event.ctrlKey||event.altKey||event.defaultPrevented||target?.closest?.('input,textarea,select,dialog,[contenteditable]'))return;
 if(target?.closest?.('button,a,summary')&&(event.key===' '||event.key==='Enter'))return;
 if(event.key===' '||event.key==='k'){event.preventDefault();if(!$('playButton').hidden)setPlaying(!S.playing);}else if(event.key==='m'){if(!$('muteButton').hidden)$('muteButton').click();}else if(event.key==='f')$('fullButton').click();
});
function openFromHash(){const hash=location.hash||'';if(!['#streams','#team','#settings'].includes(hash))return;for(const id of ['streamsDetails','leagueDialog','settings'])if($(id).open)$(id).close();if(hash==='#streams')openStreams();else if(hash==='#team')openLeague();else if(hash==='#settings'&&!$('settings').open)$('settings').showModal();}
// A click inside the provider's page is proof it is alive: nothing automatic reloads it for a while.
// In a replay player that same click is the gesture its sound needs, and it pauses the player: ask it to play, and unmute once footage moves again.
window.addEventListener('blur',()=>{setTimeout(()=>{const p=pool.current;if(p?.kind==='embed'&&document.activeElement===p.element){p.noteInteraction?.();return;}if(p?.kind!=='provider'||document.activeElement!==p.element)return;p.audioLocked=false;const unmute=()=>{if(!saved.muted&&pool.current===p&&!p.audioLocked)p.muted=false;renderTransport();};if(!S.playing){unmute();return;}p.resume?.();const started=Date.now(),mark=p.lastTime,wait=setInterval(()=>{if(p.lastTime>mark+.2||Date.now()-started>4000||pool.current!==p){clearInterval(wait);unmute();}},150);renderTransport();},0);});
window.addEventListener('pagehide',()=>{S.playing=false;pool.destroy();clearTimeout(S.gameTimer);clearTimeout(S.leagueTimer);S.request?.abort();});
// A replay frame that never shows footage: frames that never answer get 20 seconds, ones waiting on a tap get 90. Time in an ad, paused or in a hidden tab doesn't count, and footage that has once moved never trips this.
function watchReplay(dt){
 const rp=S.mode==='replay'?S.replay:null,p=pool.current,key=rp&&'rp:'+rp.id;
 if(!rp?.sources||p?.kind!=='provider'||pool.visible!==key||!S.playing||p.inAd||p.played||p.error||document.visibilityState==='hidden')return;
 rp.waited=(rp.waited||0)+dt;
 if(p.initialized?rp.waited>=CLICK_LIMIT:rp.waited>=LOAD_LIMIT)failReplay(key,'That replay did not start.',{link:rp.sources[rp.index].url});
}
function tick(){const tickAt=Date.now();watchReplay(Math.min(2000,tickAt-(S.tickAt||tickAt-1000)));S.tickAt=tickAt;if(Date.now()-(S.highlightsPolledAt||0)>5000){S.highlightsPolledAt=Date.now();void pollHighlights();}
 // The replay listing retries a failure after a minute and refreshes itself every fifteen. In Live mode an answer with a note is final, and nothing is asked before the first load.
 const replayAge=Date.now()-(S.replaysAt||0);if(!S.replayLoading&&(S.mode==='replay'?replayAge>(S.replayError||!S.replays?.games?.length?60000:900000):S.replayError?replayAge>60000:S.replaysAt&&!S.replays?.note&&replayAge>900000))void loadReplays();if(S.playing){pool.current?.checkHealth?.({active:pool.visible===S.current,online:navigator.onLine!==false,foreground:document.visibilityState!=='hidden'});if(document.visibilityState!=='hidden')direct();}renderTransport();}
// ---------- highlights: ESPN's clips from the games your players are in ----------
const summaryURL=g=>`https://site.api.espn.com/apis/site/v2/sports/${config.path}/summary?event=${encodeURIComponent(g.id)}`;
async function pollHighlights(){
 if(S.mode!=='live')return;const now=Date.now();
 const wanted=S.games.filter(g=>g.state!=='pre'&&(playersIn(g).length||g.id===S.current)&&!S.summaryPending.has(g.id)&&now-(S.summaryAt[g.id]||0)>=(g.state==='in'?25000:600000)).slice(0,3);
 for(const g of wanted){
  const task=(async()=>{try{const r=await fetch(summaryURL(g),{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('ESPN unavailable');const summary=await r.json();S.highlights=mergeHighlights(S.highlights,normalizeHighlights(summary,{id:g.id,name:g.teams.map(t=>t.abbr).join(' @ ')}).filter(c=>c.kind==='clip'));renderHighlights();}catch{}finally{S.summaryAt[g.id]=Date.now();S.summaryPending.delete(g.id);}})();
  S.summaryPending.set(g.id,task);
 }
}
function renderHighlights(){
 const roster=(selectedTeam()?.players||[]).filter(p=>p.active).map(p=>({id:String(p.id),name:p.name,teamId:String(p.teamId)}));
 const mineGames=new Set(S.games.filter(g=>playersIn(g).length).map(g=>g.id));
 const items=highlightView(S.highlights,roster,0).filter(h=>h.tier==='player'||mineGames.has(h.gameId)||h.gameId===S.current).slice(0,40);
 put('highlights',items.map(h=>{const who=h.players.length?h.players.join(' & '):h.gameName,dur=h.duration?Math.floor(h.duration/60)+':'+String(Math.round(h.duration%60)).padStart(2,'0'):'';
  return `<li><span class="s-kind ${h.tier==='player'?'TD':'FG'}">${h.tier==='player'?'YOURS':'GAME'}</span><span class="s-text">${esc(h.title)}<small>${esc([who,dur].filter(Boolean).join(' · '))}</small>${playable(h)?`<button type="button" class="link clip-play" data-play-clip="${esc(h.id)}">${S.clip===h.id?'Playing':'Play here'}</button> `:''}<a class="score-link" href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">Watch on ESPN ↗</a></span></li>`;}).join('')||`<li class="empty">${roster.length?'Highlights from your players’ games show up here once ESPN posts them.':'Connect ESPN and choose your team to see highlights from your players’ games.'}</li>`);
 $('highlightCount').textContent=items.length?String(items.length):'';$('highlightsNote').textContent=items.length?`${items.filter(h=>h.tier==='player').length} with your players`:'';
}
$('highlights').onclick=event=>{const b=event.target?.closest?.('[data-play-clip]');if(b)playClip(b.dataset.playClip);};
function playClip(id){
 const h=S.highlights.find(x=>x.id===id);if(!h||!playable(h))return;const key='hl:'+id;
 if(S.clip&&S.clip!==id)pool.close('hl:'+S.clip);
 S.clip=id;pool.open(key,{url:h.mediaUrl,type:'video/mp4'});S.playing=true;pool.setRunning(true,{resumeVisible:false});pool.hold?.(key,0,{play:true,fixed:true});pool.show(key);$('overlay').hidden=true;renderHighlights();renderTransport();
}
function leaveClip(resume=true){
 if(!S.clip)return;pool.close('hl:'+S.clip);S.clip=null;
 if(resume&&S.mode==='replay'&&S.replay?.sources){if(pool.get('rp:'+S.replay.id))pool.show('rp:'+S.replay.id);else playReplaySource();}
 else if(resume&&S.current){if(pool.get(S.current))pool.show(S.current);else selectGame(S.current,{manual:S.manual});}
 renderHighlights();renderTransport();
}
$('leaveClip').onclick=()=>leaveClip();
// ---------- replays: full games from the sites the owner picked ----------
function setMode(mode){
 if(S.mode===mode)return;S.mode=mode;if(document.body?.dataset)document.body.dataset.mode=mode;
 // The two strips are different lists: start the new one from its own beginning.
 $('games').scrollLeft=0;S.stripScrolled=false;S.stripTarget=null;S.stripShown=null;
 $('liveMode').setAttribute('aria-pressed',String(mode==='live'));$('replayMode').setAttribute('aria-pressed',String(mode==='replay'));
 if(S.clip)leaveClip(false);
 // The live game closes while a replay is up, and the viewer's pick, its kind and pause all come back with Live.
 if(mode==='replay'){S.resume={id:S.current,manual:S.manual,playing:S.playing};if(S.current)pool.close(S.current);S.current=null;S.manual=false;S.playing=false;pool.setRunning(false);$('overlay').hidden=false;void loadReplays();}
 else{if(S.replay)pool.close('rp:'+S.replay.id);S.replay=null;$('switching').hidden=true;$('frameHelp').hidden=true;$('overlay').hidden=false;const back=S.resume,g=back?.id?S.games.find(x=>x.id===back.id):null;S.resume=null;S.playing=!!back?.playing;pool.setRunning(S.playing);if(g&&g.state!=='post'&&urls(g).length){selectGame(g.id,{manual:back.manual});if(!back.playing)setPlaying(false);}else if(S.playing)direct();}
 renderGuide();renderTransport();
}
$('liveMode').onclick=()=>setMode('live');$('replayMode').onclick=()=>setMode('replay');
const REPLAYS_DOWN='Replays are unavailable right now. Retrying shortly.';
// The last good list and the last error both stand until a new answer arrives, so a retry changes nothing on screen.
async function loadReplays(){
 if(S.replayLoading)return;S.replayLoading=true;renderGuide();renderTransport();
 try{const r=await fetch('/api/replays?sport='+sport,{cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await r.json();if(!Array.isArray(data.games))throw new TypeError('no list');if(data.games.length||!S.replays?.games?.length)S.replays=data;S.replayError=data.error&&!data.games.length?REPLAYS_DOWN:'';}
 catch{S.replayError=REPLAYS_DOWN;}
 finally{S.replayLoading=false;S.replaysAt=Date.now();renderGuide();renderTransport();}
}
const nickname2=name=>String(name||'').trim().split(/\s+/).at(-1)||name;
// A replay as a strip tile: in Replay mode it is the guide; with no games on the schedule it fills the Live strip too.
function replayTile(g,{shortcut=false}={}){
 const picked=!shortcut&&S.replay?.id===g.id,failed=picked&&!!S.replay.error,outside=picked&&!pool.current&&!S.replay.loading&&!failed&&opensOutside(S.replay.sources?.[S.replay.index]),loading=picked&&!failed&&!outside&&(!!S.replay.loading||!S.replay.started),on=picked&&!failed&&!loading&&!outside,when=new Date(g.date).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});
 const team=name=>`<span class="g-team"><span class="team-logo"></span><span class="team-code">${esc(nickname2(name))}</span><span class="team-name">${esc(name)}</span><b class="team-score"></b></span>`;
 return `<li class="tile replay${on?' watching':''}" style="--away:#5b6b84;--home:#5b6b84"><button class="game" ${shortcut?`data-past-replay="${esc(g.id)}"`:`data-replay="${esc(g.id)}"`} aria-pressed="${on}" ${shortcut?'tabindex="-1" ':''}aria-label="${esc('Replay: '+g.away+' at '+g.home+', '+when+'. '+(on?'On screen':failed?'Failed, press to retry':loading?'Opening':outside?'Opens in a new tab':'Watch'))}"><span class="g-status"><span class="tag ${on?'onair':'final'}">${on?'ON AIR':'REPLAY'}</span><span class="g-when">${esc(when)}</span></span><span class="g-matchup">${team(g.away)}${team(g.home)}</span><span class="g-drive quiet"><span>${esc(g.context||'Full game')}</span></span><span class="g-bar idle" aria-hidden="true"></span></button><div class="g-footer"><span class="g-names"><span>Full game replay</span></span><span class="g-cta">${on?'On screen':failed?'Retry':loading?'Opening…':outside?'Opens in new tab':'Watch'}</span></div></li>`;
}
function offSeasonReplays(){
 // Tiles already up stay up through a poll or a failed feed; blanking the strip would also throw away the viewer's place in it.
 if(!isToday())return '';const list=(S.replays?.games||[]).slice(0,40);
 if(!list.length){if(!S.gamesLoading&&S.replays===null&&!S.replayLoading&&!S.replaysAt)void loadReplays();return '';}
 // Time runs left to right everywhere: oldest first, and a game the past days already show is not listed twice.
 const shown=new Set(S.pastDays.flatMap(d=>d.games.map(g=>replayFor(g)?.id).filter(Boolean))),older=list.filter(g=>!shown.has(g.id)).reverse();
 return older.length?`<li class="week-label" aria-hidden="true">Replays</li>`+older.map(g=>replayTile(g,{shortcut:true})).join(''):'';
}
// A strip of past games opens at its newest end, once per visit to that strip.
function stripToNewest(ready){if(!ready||S.stripScrolled)return;const list=$('games');if(list.scrollWidth===undefined)return;list.scrollLeft=list.scrollWidth;S.stripScrolled=true;S.stripTarget=null;}
function renderReplayGuide(){
 const list=S.replays?.games||[];
 setText('gameCount',list.length?list.length+' replays':'');setText('dayLabel','');
 put('games',list.slice().reverse().map(g=>replayTile(g)).join('')||`<li class="empty">${esc(S.replayError||(S.replayLoading?'Finding the latest replays…':S.replays?.note||'No '+config.label+' replays listed yet.'))}</li>`);
 stripToNewest(list.length>0);
}
async function selectReplay(id){
 const g=S.replays?.games.find(x=>x.id===id);if(!g)return;
 if(S.replay?.id===id&&pool.visible==='rp:'+id){S.playing=true;pool.setRunning(true);renderTransport();return;}
 if(S.replay?.id===id&&S.replay.loading)return;
 if(S.replay)pool.close('rp:'+S.replay.id);
 // Only the newest attempt may touch the screen: an older answer, even for the same game, is dropped.
 const attempt=S.replay={id,sources:null,index:0,loading:true,error:''};renderGuide();renderTransport();
 // However the replay was opened, its tile comes into view.
 S.stripScrolled=true;for(const b of $('games').querySelectorAll?.('[data-replay]')||[])if(b.dataset.replay===id)b.scrollIntoView?.({block:'nearest',inline:'center'});
 try{const r=await fetch('/api/replays/resolve?url='+encodeURIComponent(g.page),{cache:'no-store',signal:AbortSignal.timeout(15000)}),data=await r.json();if(S.replay!==attempt)return;if(!r.ok||!data.sources?.length)throw new Error(data.error||'No video found on that page.');attempt.sources=[...data.sources].sort((a,b)=>opensOutside(a)-opensOutside(b));attempt.loading=false;playReplaySource();}
 catch(error){if(S.replay===attempt){attempt.loading=false;attempt.error=plainError(error,'That replay could not be reached.');renderGuide();renderTransport();}}
}
// Only ok.ru replays play inside a sandboxed frame; every other host answers it with an error page, so those open on their own page in a new tab. Our player frames stay sandboxed.
const opensOutside=src=>!!src&&src.type!=='provider/ok';
// One that failed tries the next link, once each; after the last, the reason stays on screen.
function failReplay(key,message,{link=''}={}){
 const rp=S.replay;if(key!=='rp:'+rp?.id)return;
 if(rp.index+1<(rp.sources?.length||0)){rp.index++;playReplaySource();return;}
 pool.close(key);S.playing=false;pool.setRunning(false);rp.error=message;rp.link=link;$('overlay').hidden=false;$('replayNews').textContent=link?'This replay won’t play inside the page. It opens in a new tab.':message;renderGuide();renderTransport();
}
function playReplaySource(){
 const rp=S.replay,src=rp?.sources?.[rp.index];if(!src)return;const key='rp:'+rp.id;rp.started=false;rp.waited=0;rp.error='';rp.link='';
 if(opensOutside(src)){pool.close(key);S.playing=false;pool.setRunning(false);$('replayNews').textContent='This replay opens in a new tab.';renderGuide();renderTransport();return;}
 pool.close(key);pool.open(key,{url:src.url,page:src.url,type:src.type,duration:NaN,autoReconnect:false});
 S.playing=true;pool.setRunning(true,{resumeVisible:false});pool.hold?.(key,null,{play:true});pool.show(key);$('overlay').hidden=true;renderGuide();renderTransport();
}
$('nextReplaySource').onclick=()=>{const rp=S.replay;if(!rp?.sources?.length)return;rp.index=(rp.index+1)%rp.sources.length;playReplaySource();};
for(const a of document.querySelectorAll('[data-sport]'))if(a.dataset.sport===sport)a.setAttribute('aria-current','page');
document.title='Fantasy Stream · '+config.label;S.discoveryReady=true;setInterval(refreshStreamLinks,15000);
renderGuide();renderFantasy();renderTransport();loadGames();if(saved.leagueId)loadLeague();
setInterval(tick,1000);window.addEventListener('hashchange',openFromHash);openFromHash();
if(new URLSearchParams(location.search).get('mode')==='replay')setMode('replay');
S.chat=mountChat({$,sport,getName:()=>saved.chatName,setName:name=>{saved.chatName=name;persist();},defaultName:()=>selectedTeam()?.name||'',isOpen:()=>!$('chatPanel').hidden,origin:location.origin});S.chat.suggestName();chatRoom();
