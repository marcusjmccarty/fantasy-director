import {ReplayArchive,Clock,timeLabel} from './archive.js';
import {RecordingSync,addMark,wallForClock} from './sync.js';
import {Director,RULES,rank,hasRoster,rosterTeams} from './director.js';
import {Coverage} from './coverage.js';
import {PlayerPool} from './players.js';
import {officialClip,replayWindow} from './replays.js';
import {NFLSourceCatalog} from './nfl-sources.js';
import {liveGames,liveScores,LiveFeed} from './live.js';
import {alias,describeScore,rosterCredit} from './scoring.js';
import {SAMPLE,parseRoster,formatRoster,safeVideo,streamType,gameKey} from './roster.js';
import {normalizeHighlights,playable} from './highlights.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE='fantasy-stream-v3',ESPN='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const LOAD_LIMIT=20000,COOLDOWN=60000;

// ---------- saved preferences ----------
let saved={roster:SAMPLE,teamName:'Sample lineup',teamId:'',leagueId:'',league:null,streams:{},marks:{},muted:false,includeDefense:true,highlights:true,dataOnly:false,delay:30,espn:{swid:'',s2:''}};
try{
 const stored=JSON.parse(localStorage.getItem(STORE)||'null');
 if(stored)saved={...saved,...stored};
 else{
  const old=JSON.parse(localStorage.getItem('fd-simple-v2')||'null');
  if(old?.leagueId)saved.leagueId=String(old.leagueId);
  if(old?.teamId&&Array.isArray(old.roster))Object.assign(saved,{roster:old.roster,teamName:old.teamName,teamId:old.teamId,league:old.leagueCache||null});
  if(old?.streams)saved.streams=old.streams;
  for(const [id,r] of Object.entries(old?.recordings||{}))if(r.marks?.length)saved.marks[id]=r.marks;
 }
 saved.roster=parseRoster(formatRoster(saved.roster));
}catch{saved.roster=SAMPLE;}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(saved));}catch{}}

// ---------- state ----------
const S={scope:'game',center:null,range:null,mode:'replay',archive:null,clips:[],liveClips:[],day:0,games:[],at:0,lastAt:null,
 program:{kind:'idle'},pending:null,pinned:null,highlight:null,decision:null,playing:false,started:false,
 cooldown:new Map(),ads:new Set(),sources:new Map(),syncs:new Map(),seekHold:false,cuts:0,
 lastStep:0,lastWarm:0,lastRender:0,live:{games:[],feed:new LiveFeed(),scores:new Map(),fetched:0,error:'',generation:0},toastTimer:null,unmuteHint:false};
const clock=new Clock(),director=new Director(),coverage=new Coverage(),nfl=new NFLSourceCatalog();
const pool=new PlayerPool($('layers'),{capacity:3,
 onAd:(key,on)=>{if(on)S.ads.add(key);else S.ads.delete(key);render();},
 onEnded:key=>{if(S.highlight?.src.key===key)finishHighlight();},
 onError:(key,error)=>{if(S.highlight?.src.key===key){failHighlight(error.message);return;}cool(key,error.message);},
 onAudioLocked:key=>{if(key===pool.visible){if(S.audioAsked>=1)toast('The provider only unmutes from a click inside its own player: hover the video and use its speaker button.','warn');render();}}
});
window.fantasyStream={S,saved,pool,director,coverage,clock};

// ---------- games, sources and alignment ----------
const roster=()=>saved.roster;
const archiveGame=id=>S.archive?.game(id);
const gameState=id=>S.games.find(g=>g.id===id);
function syncFor(game){
 let sync=S.syncs.get(game.id);
 if(!sync){sync=new RecordingSync(game,{types:S.archive.types,anchors:[...(game.anchors||[]),...(saved.marks[game.id]||[])]});S.syncs.set(game.id,sync);}
 return sync;
}
function sourceFor(id){
 if(S.mode==='replay'){const g=archiveGame(id);return g?.embed?{url:g.embed,type:'provider/ok',duration:g.recordingDuration}:null;}
 const g=gameState(id),url=g&&saved.streams[gameKey(g)];
 return url?{url,type:streamType(url)}:null;
}
const picture=id=>S.mode==='replay'?(saved.dataOnly?'data':'video'):(sourceFor(id)?'video':'data');
function target(id){if(S.mode!=='replay')return null;const g=archiveGame(id);return g?syncFor(g).media(S.at-g.start):0;}
function cool(id,message){
 S.cooldown.set(id,performance.now()+COOLDOWN);if(S.pending?.id===id)S.pending=null;pool.close(id);
 if(S.program.kind==='game'&&S.program.id===id){S.program={kind:'standby'};pool.hide();}
 if(message)toast(`${gameState(id)?.name||'Game'} video unavailable · ${message}`,'warn');
}
function excluded(){
 const now=performance.now(),out=new Set();
 for(const [id,until] of S.cooldown)if(until>now)out.add(id);else S.cooldown.delete(id);
 for(const key of S.ads)out.add(key);
 if(S.mode==='live')for(const g of S.games)if(!sourceFor(g.id)&&S.games.some(x=>sourceFor(x.id)))out.add(g.id);
 return out;
}
const LIVE_SLACK=12;   // seconds the scoreboard may trail the snap on top of the stream delay
function recentScore(game,at){const t=S.mode==='live'?at-saved.delay:at;return (game.scores||[]).some(s=>t-s.at>=0&&t-s.at<RULES.scoreHold&&rosterCredit(s,game,roster()).length);}

// ---------- the loop ----------
function frame(now){
 advanceClock(now);
 if(now-S.lastStep>=250){S.lastStep=now;step(now);}
 if(now-S.lastRender>=400){S.lastRender=now;render();}
}
function visibleConfirmed(){
 const p=S.program;if(p.kind!=='game')return false;
 if(picture(p.id)==='data')return true;
 return pool.visible===p.id&&!!pool.current?.progressing;
}
function advanceClock(now){
 if(S.mode==='live'){S.at=Date.now()/1000;return;}
 if(!S.archive)return;
 const p=S.program,video=p.kind==='game'&&picture(p.id)==='video';
 if(S.seekHold&&video&&pool.ready(p.id,target(p.id),3))S.seekHold=false;
 if(S.seekHold&&!video)S.seekHold=false;
 // The picture on screen is the clock: commercials and halftime are edited out
 // of the recordings, so following it skips straight through breaks.
 if(S.playing&&video&&!S.seekHold&&pool.visible===p.id&&pool.current?.progressing){
  const g=archiveGame(p.id),wall=g.start+syncFor(g).wall(pool.current.currentTime);
  // Small backward wobble is ignored; a sustained difference (the viewer
  // scrubbed inside the player) is followed.
  if(wall>clock.at-1.5&&wall<clock.at+900){clock.seek(wall,now);S.driftSince=null;}
  else{S.driftSince??=now;if(now-S.driftSince>2500){clock.seek(wall,now);S.driftSince=null;}else clock.tick(now);}
  clock.running=true;
 }else{
  const waiting=S.playing&&(p.kind==='idle'||video&&(S.seekHold||pool.visible!==p.id||!pool.current?.progressing&&!S.ads.has(p.id)));
  clock.set(S.playing&&!waiting,now);
 }
 S.at=clock.at;
 if(clock.at>=clock.end&&S.playing)setPlaying(false,'That’s the end of this replay day.');
}
function step(now){
 if(S.mode==='replay'){if(!S.archive)return;S.games=S.archive.sample(S.at,day().gameIds);}
 else S.games=S.live.feed.view(S.at,saved.delay).map(g=>({...g,scores:S.live.scores.get(g.id)||[]}));   // the feed as the stream shows it
 if(S.lastAt!==null&&visibleConfirmed())coverage.watch(S.program.id,S.lastAt,S.at,3+clock.rate*1.5);
 S.lastAt=S.at;
 for(const item of coverage.update(S.games,roster(),S.at,S.mode==='live'?saved.delay:0,S.mode==='live'?LIVE_SLACK:0))announce(item);
 if(!saved.highlights)coverage.queue.length=0;
 for(const item of coverage.queue)prepareReplay(item);
 if(!S.started)return;
 updateHighlight(now);
 const blocked=excluded();
 const queue=coverage.queue.filter(q=>S.sources.get(q.id)?.status==='ready');
 const current=S.highlight&&!S.highlight.done?{kind:'highlight',id:S.highlight.item.id}:S.highlight?.done?{kind:'game',id:S.highlight.returnTo}:S.program.kind==='game'?{kind:'game',id:S.program.id}:{};
 const decision=S.pinned&&gameState(S.pinned)?.state==='in'?{kind:'game',id:S.pinned,reason:'Pinned by you'}:
  director.decide({games:S.games,roster:roster(),at:S.at,current,excluded:blocked,queue,includeDefense:saved.includeDefense,recentScore});
 S.decision=decision;
 if(decision.kind==='highlight'){if(!S.highlight||S.highlight.done)startHighlight(decision.id);}
 else if(decision.kind==='game'){if(S.highlight&&!S.highlight.done&&S.highlight.playing)finishHighlight();if(!S.highlight?.playing||S.highlight.done)cutTo(decision.id,now);}
 else if(decision.kind==='standby'&&!S.highlight){S.pending=null;if(S.program.kind!=='standby'){S.program={kind:'standby'};pool.hide();}}
 if(now-S.lastWarm>1000){S.lastWarm=now;warm(blocked);}
 nudge(now);
}
// The picture on screen stopped moving: ask the player again, then re-seek it, then give up on that game for a while.
function nudge(now){
 const p=S.program,player=pool.current;
 if(p.kind!=='game'||!S.playing||picture(p.id)!=='video'||!player||pool.visible!==p.id||player.inAd||player.target!==null||player.progressing){S.stall=null;return;}
 S.stall??={since:now,step:0};const stalled=now-S.stall.since;
 if(S.stall.step===0&&stalled>3000){S.stall.step=1;player.kick?.();}
 else if(S.stall.step===1&&stalled>10000){S.stall.step=2;const t=target(p.id);if(t!==null)player.seek(t);player.play();}
 else if(S.stall.step===2&&stalled>22000){S.stall=null;cool(p.id,'the stream stopped responding');}
}

// ---------- cuts ----------
function cutTo(id,now){
 if(S.program.kind==='game'&&S.program.id===id&&!S.highlight){S.pending=null;return;}
 if(picture(id)==='data'){commit(id);return;}
 const source=sourceFor(id);if(!source){commit(id);return;}
 if(S.pending?.id!==id)S.pending={id,since:now};
 pool.open(id,source);pool.hold(id,target(id),{play:true});
 if(pool.ready(id,target(id)))return commit(id);
 if(now-S.pending.since>LOAD_LIMIT){
  cool(id,'it did not start in time');
 }else if(!pool.visible&&now-S.pending.since>8000){
  // Autoplay may be waiting on a click inside the provider's player.
  pool.show(id);S.program={kind:'game',id};S.unmuteHint=true;S.pending=null;
 }
}
function commit(id){
 const was=S.program.kind==='game'?S.program.id:null;
 if(picture(id)==='video'){pool.show(id);if(S.highlight)closeHighlight();}else{pool.hide();if(S.highlight)closeHighlight();}
 S.program={kind:'game',id,since:S.at};S.pending=null;director.committed(S.at);
 if(was!==id)S.cuts++;
 render();
}

// Keep the next likely games playing silently in the background.
function warm(blocked){
 const want=new Set();
 const p=S.program;if(p.kind==='game')want.add(p.id);
 if(S.pending)want.add(S.pending.id);
 if(S.highlight){want.add(S.highlight.src.key);if(S.highlight.returnTo)want.add(S.highlight.returnTo);}
 if(S.started&&S.playing){
  const current=p.kind==='game'?p.id:S.highlight?.returnTo;
  const options={excluded:blocked,includeDefense:saved.includeDefense};
  const now=rank(S.games,roster(),options).filter(e=>e.game.id!==current).map(e=>e.game.id);
  let ahead=[];
  if(S.mode==='replay')for(const dt of [20,45,75]){const top=rank(S.archive.sample(S.at+dt,day().gameIds),roster(),options)[0];if(top&&top.game.id!==current)ahead.push(top.game.id);}
  // One game warms at a time: several provider streams buffering at once starve the one on screen.
  const healthy=p.kind!=='game'||picture(p.id)!=='video'||pool.current?.progressing;
  if(healthy)for(const id of [...new Set([now[0],ahead[0],now[1],ahead[1]].filter(Boolean))].slice(0,1))want.add(id);
 }
 for(const key of want){
  if(key.startsWith('hl:')||key===pool.visible||blocked.has(key))continue;
  if(picture(key)!=='video')continue;
  const source=sourceFor(key);if(!source)continue;
  pool.open(key,source);pool.hold(key,target(key),{play:S.playing||key===S.pending?.id});
 }
 if(pool.visible&&S.playing&&!pool.current?.wantPlay)pool.current?.play();
 pool.keep(want);
}

// ---------- missed-score replays ----------
async function prepareReplay(item){
 if(S.sources.has(item.id))return;
 S.sources.set(item.id,{status:'pending'});
 try{S.sources.set(item.id,{status:'ready',...await replaySource(item)});}
 catch(error){S.sources.set(item.id,{status:'none',reason:error.message});coverage.drop(item.id);item.unavailable=true;render();}
}
async function replaySource(item){
 const clip=S.mode==='replay'?officialClip(item,S.clips):officialClip(item,S.liveClips);
 if(clip){
  try{
   if(clip.mediaUrl)return {key:'hl:'+item.id,source:{url:clip.mediaUrl,type:'video/mp4'},start:0,duration:Math.min(45,clip.duration||30),label:'Official highlight',title:clip.title};
   const r=await nfl.resolve(clip);
   return {key:'hl:'+item.id,source:{url:r.url,type:'application/vnd.apple.mpegurl'},start:0,duration:Math.min(45,Number(r.duration)||30),label:'NFL.com highlight',title:clip.title};
  }catch{}
 }
 if(S.mode==='live')throw new Error('No replay has been published yet.');
 const game=archiveGame(item.gameId);
 if(saved.dataOnly)return {key:'hl:'+item.id,data:true,duration:8,label:'Scoring play',title:item.score.text};
 const w=replayWindow(item,game);
 return {key:'hl:'+item.id,source:{url:game.embed,type:'provider/ok',duration:game.recordingDuration},start:syncFor(game).media(w.from),duration:w.to-w.from,label:'Broadcast replay',title:item.score.text};
}
function startHighlight(id){
 const item=coverage.take(id),src=S.sources.get(id);if(!item||!src)return;
 // Back-to-back replays: the finished one stays up until the next is playing.
 const previous=S.highlight,returnTo=previous?.returnTo??(S.program.kind==='game'?S.program.id:S.pending?.id||null);
 S.highlight={item,src,returnTo,since:performance.now(),playing:false,done:false,previousKey:previous?.src.key};S.pending=null;
 if(src.data){S.highlight.playing=true;S.highlight.until=performance.now()+src.duration*1000;pool.hide();S.program={kind:'highlight',id};render();return;}
 pool.open(src.key,src.source);pool.hold(src.key,src.start,{play:true,fixed:true});
}
function updateHighlight(now){
 const h=S.highlight;if(!h||h.done)return;
 if(!h.playing){
  // The replay player runs from its start while hidden; show it as soon as footage is moving inside the clip.
  const p=pool.get(h.src.key)?.player,pos=p?p.currentTime-h.src.start:0;
  const ready=h.src.data||p&&p.progressing&&p.target===null&&pos>=-4&&pos<=h.src.duration-3;
  if(ready){if(!h.src.data)pool.show(h.src.key);else pool.hide();if(h.previousKey&&h.previousKey!==h.src.key)pool.close(h.previousKey);h.previousKey=null;h.playing=true;h.until=now+(h.src.duration-Math.max(0,pos))*1000;S.program={kind:'highlight',id:h.item.id};render();}
  else if(now-h.since>15000)failHighlight('the replay did not start');
  return;
 }
 if(now>=h.until)finishHighlight();
}
const item=h=>coverage.log.find(x=>x.id===h.item.id)||h.item;
// The highlight stays on screen until the game we return to is ready.
function finishHighlight(){
 const h=S.highlight;if(!h||h.done)return;
 if(!h.playing){failHighlight('the replay did not start');return;}
 const watched=(performance.now()-(h.until-h.src.duration*1000))/(h.src.duration*1000);
 if(watched<.5&&!h.requeued){h.requeued=true;item(h).status='queued';coverage.requeue(h.item);}else item(h).status='replayed';
 h.done=true;
 if(!h.returnTo){closeHighlight();S.program={kind:'standby'};}
}
// The footage for a replay would not play: fall back to the game's own recording once, then give up on it.
function failHighlight(reason){
 const h=S.highlight;if(!h)return;S.highlight=null;
 for(const key of [h.src.key,h.previousKey])if(key)pool.close(key);
 if(S.program.kind==='highlight')S.program={kind:'standby'};
 const it=item(h),game=archiveGame(h.item.gameId);
 if(S.mode==='replay'&&!saved.dataOnly&&h.src.label!=='Broadcast replay'&&game?.embed){
  const w=replayWindow(h.item,game);
  S.sources.set(h.item.id,{status:'ready',key:'hl:'+h.item.id+':b',source:{url:game.embed,type:'provider/ok',duration:game.recordingDuration},start:syncFor(game).media(w.from),duration:w.to-w.from,label:'Broadcast replay',title:h.item.score.text});
  it.status='queued';coverage.requeue(h.item);
 }else{it.status='missed';it.unavailable=true;S.sources.set(h.item.id,{status:'none',reason});toast('Couldn’t play the replay of that score · '+reason,'warn');}
}
// A replay pre-empted while still loading goes back in the queue.
function closeHighlight(){
 const h=S.highlight;if(!h)return;S.highlight=null;
 if(!h.playing&&!h.done)coverage.requeue(h.item);
 for(const key of [h.src.key,h.previousKey])if(key)pool.close(key);
 if(S.program.kind==='highlight')S.program={kind:'standby'};
}

// ---------- score alerts ----------
function announce(entry){
 const game=S.games.find(g=>g.id===entry.gameId),d=describeScore(entry.score,game);
 entry.status=entry.seen?'seen':entry.queued?'queued':'skipped';
 const who=[...new Set(entry.credits.map(c=>c.player.name))].join(' & ');
 toast(`<b>${esc(d.label.toUpperCase())}</b> ${esc(who)} · ${esc(d.line)}${entry.queued&&saved.highlights?'<em>Replay coming up</em>':''}`,entry.score.kind==='TD'?'td':'fg',true);
}
function toast(html,tone='',isHTML=false){
 const t=$('toast');if(isHTML)t.innerHTML=html;else t.textContent=html;t.className='toast '+tone;t.hidden=false;
 clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>t.hidden=true,6500);
}

// ---------- transport ----------
function day(){return S.archive.sessions[S.day];}
function setPlaying(playing,message){
 S.playing=playing;pool.setRunning(playing);clock.set(false,performance.now());
 if(playing&&!S.started){S.started=true;pool.setMuted(saved.muted);}
 if(message)toast(message);render();
}
function seekTo(at){
 const d=day();at=Math.max(d.start,Math.min(d.end,at));
 clock.seek(at,performance.now());S.at=at;S.lastAt=null;
 coverage.skipTo(S.archive.sample(at,d.gameIds),at);director.reset();
 if(S.highlight){S.highlight.done=true;closeHighlight();}
 S.pending=null;S.seekHold=true;S.games=S.archive.sample(at,d.gameIds);
 for(const key of pool.slots.keys())if(!key.startsWith('hl:'))pool.get(key).player.seek(target(key));
 render();
}
function nextDrive(){
 const d=day(),startId=S.program.kind==='game'?S.program.id:null;
 for(let at=S.at+10;at<d.end;at+=5){
  const top=rank(S.archive.sample(at,d.gameIds),roster(),{includeDefense:false})[0];
  if(top&&(top.game.id!==startId||at-S.at>120)){seekTo(at-4);return;}
 }
 toast('No more drives for your starters on this day.');
}
function setDay(index,{seek=true}={}){
 S.day=index;const d=day();clock.end=d.end;$('daySelect').value=String(index);
 if(seek){const first=firstAction(d);seekTo(first??d.start);}
 S.range=null;syncTimeline();
}
function firstAction(d){for(let at=d.start;at<d.end;at+=30)if(rank(S.archive.sample(at,d.gameIds),roster(),{includeDefense:false}).length)return at-20;return null;}

// ---------- rendering ----------
const ROLE={offense:'',kicker:'K',defense:'D/ST'};
function render(){
 if(!S.archive&&S.mode==='replay')return;
 renderScreen();renderRail();renderTransport();
}
function renderScreen(){
 const p=S.program,h=S.highlight,game=p.kind==='game'?gameState(p.id):h?gameState(h.item.gameId):null;
 const data=p.kind==='game'&&picture(p.id)==='data'||h?.src.data&&h.playing;
 $('fieldView').hidden=!data||!game;
 $('layers').hidden=!!data;
 if(data&&game)renderField(game,h?.playing?h.item:null);
 // overlay states
 let overlay=null;
 if(!S.started)overlay={eyebrow:S.mode==='replay'?`WEEK 7 REPLAY · ${day()?.label.toUpperCase()||''}`:'LIVE',title:'Every snap your starters take.',text:`Following ${saved.teamName}: ${roster().length} starters. The channel goes to whoever is closest to the end zone, skips the breaks, and replays any score you miss.`,button:S.mode==='replay'?'Start watching':'Start the channel'};
 else if(p.kind==='idle'||p.kind==='game'&&!pool.visible&&picture(p.id)==='video')overlay={eyebrow:'TUNING IN',title:S.pending?`Opening ${esc(gameState(S.pending.id)?.name||'the game')}…`:'Finding your players…',text:'The picture appears as soon as the game is playing.',spinner:true};
 else if(p.kind==='standby'&&!h){const next=nextKickoff();overlay={eyebrow:'STANDBY',title:'None of your starters are playing right now.',text:next?`Next up: ${next.name} at ${timeLabel(next.start)} ET.`:'Your starters are done for this slate.',button:S.mode==='replay'&&next?'Skip to kickoff':null,action:'kickoff'};}
 else if(p.kind==='game'&&S.ads.has(p.id))overlay={eyebrow:'COMMERCIAL',title:'Skipping the break.',text:'Your game resumes as soon as the provider’s ad ends. Another of your games takes over if one is on.',spinner:true,dim:true};
 const o=$('overlay');o.hidden=!overlay;o.classList.toggle('dim',!!overlay?.dim);
 const wantsSound=!overlay&&!saved.muted&&!!pool.current?.audioLocked&&S.playing;
 $('unmute').hidden=!wantsSound||pool.current?.kind==='provider';
 $('soundHint').hidden=!wantsSound||pool.current?.kind!=='provider';
 if(overlay){$('ovEyebrow').textContent=overlay.eyebrow;$('ovTitle').innerHTML=overlay.title;$('ovText').textContent=overlay.text;$('ovButton').hidden=!overlay.button;$('ovButton').textContent=overlay.button||'';$('ovButton').dataset.action=overlay.action||'start';o.classList.toggle('busy',!!overlay.spinner);$('ovHint').textContent=S.unmuteHint?'If the video waits, press play inside it.':'';}
 // switching chip
 const pend=S.pending&&gameState(S.pending.id);$('switching').hidden=!(pend&&pool.visible&&performance.now()-S.pending.since>700);
 if(pend)$('switching').textContent=`Up next · ${pend.name}`;
 // bug + lower third
 const showInfo=!!game&&!overlay;$('bug').hidden=!showInfo;$('lower').hidden=!showInfo;
 $('screen').classList.toggle('replaying',!!h?.playing);
 if(!showInfo)return;
 $('bugTag').textContent=h?.playing?'REPLAY':S.mode==='live'?'LIVE':'WEEK 7';
 $('bugGame').innerHTML=`${esc(game.teams[0].abbr)} <b>${game.score?.[0]??0}</b> · ${esc(game.teams[1].abbr)} <b>${game.score?.[1]??0}</b>`;
 $('bugClock').textContent=game.detail||'';
 if(h?.playing){
  const d=describeScore(h.item.score,game);
  $('lowerKicker').textContent=`${h.src.label} · ${d.label}`;$('lowerKicker').className='lower-kicker replay';
  $('lowerMain').textContent=d.text;$('lowerMeta').textContent=`You were on another game · ${d.line}`;return;
 }
 const entry=S.decision?.entry?.game?.id===game.id?S.decision.entry:rank([game],roster(),{includeDefense:saved.includeDefense})[0];
 const players=entry?.players||[];
 const roles=new Set(players.map(x=>x.role));
 const kicker=game.phase==='break'?['BREAK','break']:roles.has('offense')?(game.yardsToGoal<=20?['RED ZONE','red']:['ON THE FIELD','go']):roles.has('kicker')?['FIELD-GOAL RANGE','amber']:roles.has('defense')?['YOUR DEFENSE','blue']:S.pinned?['PINNED','muted']:['BETWEEN SERIES','muted'];
 $('lowerKicker').textContent=kicker[0];$('lowerKicker').className='lower-kicker '+kicker[1];
 $('lowerMain').innerHTML=players.length?players.map(x=>`<span>${esc(x.player.name)}<i>${esc(ROLE[x.role]||x.player.position)}</i></span>`).join(''):esc(rosterIn(game).map(p=>p.name).join(' · ')||game.name);
 const off=game.possession>=0?game.teams[game.possession].abbr:'';
 $('lowerMeta').textContent=game.phase==='break'?(S.mode==='replay'?'Recording skips ahead':'Waiting out the break'):[off&&`${off} ball`,game.downDistance,Number.isFinite(game.yardsToGoal)&&!game.special?`${game.yardsToGoal} yds to the end zone`:''].filter(Boolean).join(' · ');
}
function renderField(game,replayItem){
 const off=game.possession>=0?game.possession:null,ytg=Number.isFinite(game.yardsToGoal)?game.yardsToGoal:50;
 $('fvScore').innerHTML=game.teams.map((t,i)=>`<div class="${off===i?'has-ball':''}"><b>${esc(t.abbr)}</b><strong>${game.score?.[i]??0}</strong></div>`).join('<span>'+esc(game.detail||'')+'</span>');
 $('fvLeft').textContent=game.teams[0].abbr;$('fvRight').textContent=game.teams[1].abbr;
 // Away attacks the right end zone in this diagram.
 const x=off===null?50:off===0?100-ytg:ytg;$('fvBall').style.left=x+'%';$('fvLine').style.left=x+'%';$('fvBall').hidden=off===null;
 $('fvPlay').textContent=replayItem?replayItem.score.text:game.lastPlay||game.name;
 $('fvNote').textContent=replayItem?'Scoring play replay':game.phase==='break'?'Break in the action':`${game.downDistance||''}${off!==null&&!game.special?` · ${ytg} yards to go`:''}`;
}
function rosterIn(game){const teams=new Set(game.teams.map(t=>t.abbr));return roster().filter(p=>teams.has(alias(p.team)));}
function nextKickoff(){
 if(S.mode!=='replay')return null;
 const teams=rosterTeams(roster());
 return day().gameIds.map(archiveGame).filter(g=>g.start>S.at&&g.teams.some(t=>teams.has(alias(t.abbreviation)))).sort((a,b)=>a.start-b.start)[0]||null;
}
function renderRail(){
 const teams=rosterTeams(roster()),blocked=excluded();
 const mine=S.games.filter(g=>g.teams.some(t=>teams.has(t.abbr)));
 const ranked=rank(S.games,roster(),{excluded:blocked,includeDefense:saved.includeDefense});
 const order=g=>g.id===currentGameId()?0:ranked.findIndex(e=>e.game.id===g.id)>=0?1+ranked.findIndex(e=>e.game.id===g.id):g.state==='in'?50:g.state==='pre'?60:70;
 const items=mine.sort((a,b)=>order(a)-order(b)||(a.start||0)-(b.start||0)).map(g=>{
  const e=ranked.find(x=>x.game.id===g.id),watching=g.id===currentGameId(),off=g.possession>=0?g.teams[g.possession].abbr:'';
  const tag=watching?['WATCHING','live']:S.pending?.id===g.id?['UP NEXT','next']:blocked.has(g.id)?[S.ads.has(g.id)?'AD':'UNAVAILABLE','muted']:g.state==='post'?['FINAL','muted']:g.state==='pre'?['LATER','muted']:g.phase==='break'?['BREAK','muted']:e?.tier===2?(g.yardsToGoal<=20?['RED ZONE','red']:e.players.some(x=>x.role==='kicker')&&e.players.every(x=>x.role==='kicker')?['FG RANGE','amber']:['DRIVING','go']):e?.tier===1?['DEFENSE','blue']:['SIDELINE','muted'];
  const ytg=Number.isFinite(g.yardsToGoal)&&off&&!g.special&&g.state==='in'?g.yardsToGoal:null;
  const names=rosterIn(g).map(p=>`<span class="${e?.players.some(x=>x.player===p)?'on':''}">${esc(p.name.split(' ').slice(-1)[0])}</span>`).join('');
  return `<li><button class="game ${watching?'watching':''}" data-game="${esc(g.id)}" aria-pressed="${S.pinned===g.id}"><span class="g-top"><b>${esc(g.teams[0].abbr)} ${g.score?.[0]??''}</b><span class="vs">@</span><b>${esc(g.teams[1].abbr)} ${g.score?.[1]??''}</b><span class="tag ${tag[1]}">${tag[0]}</span></span><span class="g-mid">${esc(g.state==='pre'?(g.detail||''):[g.detail,off&&g.state==='in'?`${off} ball`:'',g.downDistance].filter(Boolean).join(' · '))}</span>${ytg!==null?`<span class="g-bar" aria-hidden="true"><i style="width:${100-ytg}%"></i></span>`:''}<span class="g-names">${names}</span></button></li>`;
 }).join('');
 put('games',items||'<li class="empty">None of your starters play in this window.</li>');
 $('gamesNote').textContent=S.pinned?'Pinned':`${ranked.filter(e=>e.tier===2).length} on offense`;
 // roster
 put('roster',roster().map(p=>{
  const g=S.games.find(x=>x.teams.some(t=>t.abbr===alias(p.team))),on=ranked.some(e=>e.players.some(x=>x.player===p));
  const pts=coverage.log.filter(x=>x.credits.some(c=>c.player===p||c.player.name===p.name)).length;
  const status=!g?'No game':on?'On the field':g.state==='pre'?`Kickoff ${S.mode==='replay'?timeLabel(g.start):g.detail}`:g.state==='post'?'Final':g.phase==='break'?'Break':'Sideline';
  return `<li class="${on?'on':''}"><span class="pos">${esc(p.position)}</span><span class="who"><b>${esc(p.name)}</b><small>${esc(alias(p.team))} · ${esc(status)}</small></span>${pts?`<span class="pts">${pts}×</span>`:''}</li>`;
 }).join(''));
 $('rosterNote').textContent=saved.teamName;
 // scores
 put('scores',coverage.log.map(x=>{
  const st=x.status==='replayed'?['Replayed','go']:x.status==='queued'||coverage.queue.some(q=>q.id===x.id)?[S.highlight?.item.id===x.id?'Playing':'Replay up next','amber']:x.unavailable||x.status==='missed'?['No footage','muted']:x.seen?['Seen live','live']:['Extra point','muted'];
  return `<li><span class="s-kind ${x.score.kind}">${esc(x.score.kind)}</span><span class="s-text">${esc(x.score.text.replace(/\s*\([^)]*\)\s*$/,''))}<small>${esc(x.gameName)}</small></span><span class="tag ${st[1]}">${st[0]}</span></li>`;
 }).join('')||'<li class="empty">Scores by your starters show up here.</li>');
 $('scoresNote').textContent=coverage.log.length?`${coverage.log.filter(x=>x.seen).length}/${coverage.log.length} live`:'';
}
const markup=new Map();
function put(id,html){if(markup.get(id)===html)return;markup.set(id,html);$(id).innerHTML=html;}
function currentGameId(){return S.program.kind==='game'?S.program.id:S.highlight?.returnTo||null;}
function renderTransport(){
 const replay=S.mode==='replay';
 for(const id of ['backButton','forwardButton','nextButton','daySelect','scope'])$(id).hidden=!replay;
 $('timeline').parentElement.hidden=!replay;$('speed').hidden=!replay||!saved.dataOnly;
 $('playButton').textContent=S.playing?'❚❚':'▶';$('playButton').setAttribute('aria-label',S.playing?'Pause':'Play');
 $('muteButton').textContent=saved.muted?'🔇':'🔊';$('muteButton').setAttribute('aria-label',saved.muted?'Unmute':'Mute');
 if(replay){syncTimeline();if(!S.scrubbing)$('timeline').value=String(Math.round(S.at));}
 $('timeLabel').textContent=replay?timeLabel(S.at)+' ET':new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 $('autoChip').textContent=S.pinned?'PINNED':'AUTO';$('autoChip').classList.toggle('on',!S.pinned);$('resumeAuto').hidden=!S.pinned;
 const d=S.decision;
 $('reason').textContent=!S.started?`${saved.teamName} · ${roster().length} starters`:S.highlight?.playing?'Replaying a score you missed':d?.reason||'';
 $('pictureNote').textContent=S.mode==='live'?(S.live.error?'ESPN feed unavailable · holding':`ESPN feed · ${saved.delay}s stream delay`):saved.dataOnly?'Data-only picture':`${S.cuts} cuts`;
}
// The timeline spans the game on screen by default (a few hours), a 15-minute
// window for frame-accurate scrubbing, or the whole day. Ticks mark scores.
function timelineGame(){const id=currentGameId()||S.pending?.id;return id?archiveGame(id):null;}
function timelineRange(){
 const d=day();if(!d)return null;
 if(S.scope==='day')return {start:d.start,end:d.end,game:null};
 if(S.scope==='tight'){
  if(S.center===null||S.at<S.center-420||S.at>S.center+420)S.center=S.at;
  const start=Math.max(d.start,S.center-450),end=Math.min(d.end,start+900);return {start:Math.max(d.start,end-900),end,game:timelineGame()};
 }
 const g=timelineGame();
 if(!g||S.at<g.start-180||S.at>g.end+120)return {start:d.start,end:d.end,game:null};
 return {start:Math.max(d.start,g.start-120),end:Math.min(d.end,g.end+60),game:g};
}
function syncTimeline(){
 const r=timelineRange();if(!r)return;
 const same=S.range&&S.range.start===r.start&&S.range.end===r.end&&S.range.game===r.game&&S.range.roster===saved.teamName;
 if(same)return;S.range={...r,roster:saved.teamName};
 $('timeline').min=String(r.start);$('timeline').max=String(r.end);$('timeline').step=String(r.end-r.start>7200?2:1);
 const span=r.end-r.start,games=r.game?[r.game]:day().gameIds.map(archiveGame),ticks=[];
 for(const g of games)for(const s of g.scores){
  if(s.at<r.start||s.at>r.end)continue;
  const mine=rosterCredit(s,{teams:g.teams},roster()).some(c=>c.role!=='pat');
  if(!mine&&!r.game)continue;
  ticks.push(`<i class="${s.kind}${mine?'':' other'}" style="left:${((s.at-r.start)/span*100).toFixed(2)}%" title="${esc(g.name+' · '+s.text)}"></i>`);
 }
 put('ticks',ticks.join(''));
}
function scrubLabel(at){
 const g=S.range?.game||timelineGame();let detail='';
 if(g){const state=S.archive.sample(at,[g.id])[0];detail=`${g.name} · ${state.state==='pre'?'Pregame':state.state==='post'?'Final':state.detail}`;}
 return `<b>${esc(timeLabel(at))} ET</b>${esc(detail)}`;
}

// ---------- controls ----------
$('ovButton').onclick=()=>{
 if($('ovButton').dataset.action==='kickoff'){const next=nextKickoff();if(next)seekTo(next.start-30);return;}
 saved.muted=false;persist();setPlaying(true);
};
$('playButton').onclick=()=>setPlaying(!S.playing);
$('backButton').onclick=()=>seekTo(S.at-30);
$('forwardButton').onclick=()=>seekTo(S.at+30);
$('scope').onchange=e=>{S.scope=e.target.value;S.center=S.at;S.range=null;syncTimeline();render();};
$('nextButton').onclick=()=>{nextDrive();if(!S.playing)setPlaying(true);};
$('timeline').oninput=e=>{
 S.scrubbing=true;const at=Number(e.target.value),r=S.range;$('timeLabel').textContent=timeLabel(at)+' ET';
 const tip=$('scrubTip');tip.hidden=false;tip.innerHTML=scrubLabel(at);
 if(r){const pct=(at-r.start)/Math.max(1,r.end-r.start);tip.style.left=`calc(8px + ${(pct*100).toFixed(2)}% - ${(pct*16).toFixed(1)}px)`;}
};
$('timeline').onchange=e=>{S.scrubbing=false;$('scrubTip').hidden=true;seekTo(Number(e.target.value));};
$('timeline').onblur=()=>{S.scrubbing=false;$('scrubTip').hidden=true;};
$('daySelect').onchange=e=>setDay(Number(e.target.value));
$('speed').onchange=e=>{clock.tick(performance.now());clock.rate=Number(e.target.value);};
$('muteButton').onclick=()=>{saved.muted=!saved.muted;S.audioAsked=0;pool.setMuted(saved.muted);persist();render();};
$('unmute').onclick=()=>{S.audioAsked=(S.audioAsked||0)+1;pool.retryAudio();render();};
pool.host.addEventListener('pointerdown',()=>{S.audioAsked=0;},true);
// A click inside the provider's frame moves focus into it; that click is the one gesture its player accepts for sound.
// The click also pauses its player: ask it to play, and send the unmute only once footage is moving again
// (an unmute during that transition wedges it, and the watchdog would mute it back).
window.addEventListener('blur',()=>{setTimeout(()=>{
 const el=document.activeElement,p=pool.current;
 if(!p||p.kind!=='provider'||el!==p.element)return;
 S.audioAsked=0;p.audioLocked=false;p.clickedAt=performance.now();
 const unmute=()=>{if(!saved.muted&&pool.current===p&&!p.audioLocked)p.muted=false;render();};
 if(!S.playing){unmute();return;}
 p.resume?.();
 const started=performance.now(),mark=p.lastTime;
 const wait=setInterval(()=>{if(p.lastTime>mark+.2||performance.now()-started>4000||pool.current!==p){clearInterval(wait);unmute();}},150);
 render();
},0);});
$('resumeAuto').onclick=()=>{S.pinned=null;director.reset();render();};
$('games').onclick=e=>{
 const b=e.target.closest('[data-game]');if(!b)return;const id=b.dataset.game,g=gameState(id);
 if(S.pinned===id){S.pinned=null;director.reset();render();return;}
 if(g?.state==='pre'&&S.mode==='replay'){seekTo(archiveGame(id).start-30);return;}
 if(g?.state!=='in')return;
 S.pinned=id;if(S.highlight){S.highlight.done=true;closeHighlight();}if(!S.started)setPlaying(true);render();
};
// Fullscreen where the browser allows it (Safari needs the webkit names); otherwise a fixed theater layout.
// A request that is refused, unsupported, or simply never answered (embedded browsers) falls back to the theater within a moment.
$('fullButton').onclick=async()=>{
 const stage=document.querySelector('.stage'),d=document;
 const active=d.fullscreenElement||d.webkitFullscreenElement;
 try{
  if(active){await (d.exitFullscreen?d.exitFullscreen():d.webkitExitFullscreen());return;}
  if(stage.classList.contains('theater')){stage.classList.remove('theater');render();return;}
  const req=stage.requestFullscreen||stage.webkitRequestFullscreen;
  if(!req)throw new Error('no fullscreen');
  const slow=new Promise((_,reject)=>setTimeout(()=>reject(new Error('no answer')),800));
  await Promise.race([Promise.resolve(req.call(stage,{navigationUI:'hide'})),slow]);
  if(!(d.fullscreenElement||d.webkitFullscreenElement))throw new Error('not granted');
 }catch{stage.classList.add('theater');render();}
};
for(const ev of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(ev,()=>{
 const full=!!(document.fullscreenElement||document.webkitFullscreenElement);
 document.body.classList.toggle('is-full',full);if(full)document.querySelector('.stage').classList.remove('theater');render();
});
document.addEventListener('keydown',e=>{
 if(e.target.closest('input,textarea,select,dialog'))return;
 if(e.key===' '||e.key==='k'){e.preventDefault();if(S.started||S.archive)setPlaying(!S.playing);}
 else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&S.mode==='replay'){e.preventDefault();seekTo(S.at+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?60:10));}
 else if(e.key==='m')$('muteButton').click();else if(e.key==='f')$('fullButton').click();
 else if(e.key==='n'&&S.mode==='replay')$('nextButton').click();
 else if(e.key==='Escape')document.querySelector('.stage').classList.remove('theater');
});
// A replay pauses while the page is hidden and picks up again when it comes back.
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){S.resumeOnShow=S.mode==='replay'&&S.playing;if(S.resumeOnShow)setPlaying(false);}
 else if(S.resumeOnShow){S.resumeOnShow=false;setPlaying(true);}
});

// ---------- modes ----------
async function setMode(mode){
 if(mode===S.mode)return;
 setPlaying(false);pool.destroy();S.mode=mode;S.program={kind:'idle'};S.pending=null;S.pinned=null;S.highlight=null;S.started=false;
 S.live.generation++;S.live.feed=new LiveFeed();coverage.reset();director.reset();S.sources.clear();S.cooldown.clear();S.ads.clear();S.lastAt=null;
 $('replayMode').setAttribute('aria-pressed',String(mode==='replay'));$('liveMode').setAttribute('aria-pressed',String(mode==='live'));
 if(mode==='live'){S.at=Date.now()/1000;pollLive(S.live.generation);pollLiveClips(S.live.generation);}
 else{S.games=S.archive.sample(S.at,day().gameIds);coverage.skipTo(S.games,S.at);}
 if(saved.leagueId)importLeague({refresh:true,quiet:true});
 render();
}
$('replayMode').onclick=()=>setMode('replay');$('liveMode').onclick=()=>setMode('live');
async function espn(path,signal){const r=await fetch(ESPN+path,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});if(!r.ok)throw new Error('ESPN unavailable');return r.json();}
async function pollLive(generation){
 if(generation!==S.live.generation)return;
 try{
  const games=liveGames(await espn('scoreboard',AbortSignal.timeout(8000)));
  for(const g of games)g.scores=S.live.scores.get(g.id)||[];
  S.live.games=games;S.live.error='';S.live.fetched=Date.now();S.live.feed.push(games,Date.now()/1000);
  const teams=rosterTeams(roster());
  await Promise.allSettled(games.filter(g=>g.state!=='pre'&&g.teams.some(t=>teams.has(t.abbr))&&Date.now()-(S.live.summaryAt?.[g.id]||0)>25000).slice(0,4).map(async g=>{
   const summary=await espn('summary?event='+g.id,AbortSignal.timeout(10000));
   S.live.summaryAt={...S.live.summaryAt,[g.id]:Date.now()};
   const scores=liveScores(summary,g);S.live.scores.set(g.id,scores);g.scores=scores;
   const clips=normalizeHighlights(summary,g).filter(c=>c.kind==='clip'&&playable(c)).map(c=>({id:c.id,gameId:g.id,title:c.title,athletes:[],short:true,mediaUrl:c.mediaUrl,duration:c.duration}));
   S.liveClips=[...new Map([...S.liveClips,...clips].map(c=>[c.id,c])).values()].slice(-120);
  }));
  for(const [id,src] of S.sources)if(src.status==='none'&&src.reason&&coverage.log.some(x=>x.id===id&&S.at-x.at<600)){S.sources.delete(id);const it=coverage.log.find(x=>x.id===id);if(it&&!it.seen){it.unavailable=false;coverage.requeue(it);}}
 }catch{S.live.error='unavailable';}
 finally{if(generation===S.live.generation)setTimeout(()=>pollLive(generation),S.live.games.some(g=>g.state==='in')?5000:30000);}
 if(!S.live.games.length&&S.mode==='live')render();
}
async function pollLiveClips(generation){
 if(generation!==S.live.generation)return;
 try{const r=await fetch('/api/nfl-highlights',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(r.ok){const data=await r.json();S.liveClips=[...new Map([...S.liveClips,...(data.clips||[])].map(c=>[c.id,c])).values()].slice(-160);}}catch{}
 finally{if(generation===S.live.generation)setTimeout(()=>pollLiveClips(generation),300000);}
}

// ---------- league and roster ----------
function franchiseOptions(){
 const teams=saved.league?.teams||[];
 $('franchise').innerHTML=(saved.teamId?'':`<option value="">${esc(saved.teamName)}</option>`)+teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
 $('franchise').value=saved.teamId||'';
}
function useRoster(players,{teamName,teamId=''}){
 saved={...saved,roster:parseRoster(formatRoster(players)),teamName,teamId};persist();
 coverage.reset();coverage.skipTo(S.games,S.at);director.reset();S.pinned=null;S.sources.clear();
 franchiseOptions();S.range=null;render();
}
$('franchise').onchange=e=>{const team=saved.league?.teams.find(t=>t.id===e.target.value);if(team){useRoster(team.players,{teamName:team.name,teamId:team.id});toast(`${team.name} · ${team.players.length} starters`);}};
async function importLeague({refresh=false,quiet=false}={}){
 const leagueId=(refresh?saved.leagueId:$('leagueId').value).trim();
 if(!/^\d{1,12}$/.test(leagueId)){$('leagueStatus').textContent='Enter your numeric ESPN league ID.';return;}
 if(!refresh){saved.espn={swid:$('espnSwid').value.trim(),s2:$('espnS2').value.trim()};persist();}
 const cookies=saved.espn?.swid&&saved.espn?.s2?{swid:saved.espn.swid,s2:saved.espn.s2}:{};
 $('importLeague').disabled=true;$('leagueStatus').textContent='Getting every franchise from ESPN…';
 try{
  const r=await fetch('/api/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId,week:S.mode==='replay'?7:undefined,...cookies}),signal:AbortSignal.timeout(15000)});
  if(!r.headers.get('Content-Type')?.includes('application/json'))throw new Error('Reload this page to refresh your signed-in session.');
  const data=await r.json();if(!r.ok){if(data.code==='LEAGUE_PRIVATE'){$('cookieDetails').open=true;}throw new Error(data.error||'Could not import this league.');}
  saved.league=data;saved.leagueId=data.leagueId;
  const team=data.teams.find(t=>t.id===saved.teamId)||data.teams.find(t=>t.id===data.ownedTeamId)||data.teams[0];
  useRoster(team.players,{teamName:team.name,teamId:team.id});
  $('leagueStatus').textContent=`${data.name}: ${data.teams.length} franchises. Pick yours from the menu at the top.`;
  if(!quiet)toast(`${team.name} · ${team.players.length} starters`);
 }catch(error){$('leagueStatus').textContent=error.name==='TimeoutError'?'ESPN took too long. Try again.':error.message;}
 finally{$('importLeague').disabled=false;}
}
$('importLeague').onclick=()=>importLeague();
$('saveRoster').onclick=()=>{try{useRoster(parseRoster($('manualRoster').value),{teamName:'My lineup'});$('settingsError').textContent='';toast('Roster saved.');}catch(error){$('settingsError').textContent=error.message;}};
async function restoreConnection(){
 try{const r=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)return;const session=await r.json();
  if(saved.leagueId)await importLeague({refresh:true,quiet:true});else if(session.savedLeagueId){$('leagueId').value=session.savedLeagueId;await importLeague({quiet:true});}}catch{}
}

// ---------- settings ----------
function openSettings(tab='league'){
 $('leagueId').value=saved.leagueId||'';$('espnSwid').value=saved.espn?.swid||'';$('espnS2').value=saved.espn?.s2||'';$('manualRoster').value=formatRoster(roster());$('settingsError').textContent='';
 $('optDefense').checked=saved.includeDefense;$('optHighlights').checked=saved.highlights;$('optData').checked=saved.dataOnly;$('optDelay').value=saved.delay;
 const games=S.mode==='live'?S.live.games:S.archive.games;
 $('streamInputs').innerHTML=S.mode==='live'?games.map(g=>`<label class="stream"><span>${esc(g.name)}</span><input type="url" data-key="${esc(gameKey(g))}" value="${esc(saved.streams[gameKey(g)]||'')}" placeholder="https://… (video file, .m3u8, or a page to embed)"></label>`).join('')||'<p class="muted">No games on the ESPN scoreboard yet.</p>':'<p class="muted">Switch to Live to add stream links for today’s games.</p>';
 $('syncGame').innerHTML=(S.archive?.games||[]).map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 const cur=currentGameId();if(cur&&S.mode==='replay')$('syncGame').value=cur;
 syncStatus();showTab(tab);$('settings').showModal();
}
function showTab(name){for(const b of document.querySelectorAll('[data-tab]'))b.setAttribute('aria-selected',String(b.dataset.tab===name));for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==name;}
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>showTab(b.dataset.tab);
$('settingsButton').onclick=()=>openSettings();$('closeSettings').onclick=()=>$('settings').close();
for(const id of ['optDefense','optHighlights','optData'])$(id).onchange=()=>{
 saved.includeDefense=$('optDefense').checked;saved.highlights=$('optHighlights').checked;
 const data=$('optData').checked;if(data!==saved.dataOnly){saved.dataOnly=data;if(!data){clock.rate=1;$('speed').value='1';}pool.destroy();S.pending=null;if(S.program.kind==='game')S.program={kind:'standby'};}
 persist();director.reset();render();
};
$('optDelay').onchange=e=>{saved.delay=Math.max(0,Math.min(600,Number(e.target.value)||0));persist();};
$('saveStreams').onclick=()=>{try{const streams={...saved.streams};for(const input of $('streamInputs').querySelectorAll('input'))streams[input.dataset.key]=safeVideo(input.value.trim());saved.streams=streams;persist();$('settingsError').textContent='';toast('Streams saved.');}catch(error){$('settingsError').textContent=error.message;}};
function syncStatus(){const g=archiveGame($('syncGame').value);if(!g)return;const sync=syncFor(g);$('syncStatus').textContent=`${g.name}: ${g.anchors?.length||0} built-in scorebug anchors, ${saved.marks[g.id]?.length||0} of yours.${pool.visible===g.id?` Video is at ${Math.floor(pool.current.currentTime/60)}:${String(Math.floor(pool.current.currentTime%60)).padStart(2,'0')}.`:' Open this game on screen to mark it.'}`;void sync;}
$('syncGame').onchange=syncStatus;
$('addSync').onclick=()=>{
 try{const g=archiveGame($('syncGame').value);if(pool.visible!==g.id)throw new Error('Put this game on screen first (click it in Your games).');
  const wall=wallForClock(g,$('syncQuarter').value,$('syncClock').value);
  saved.marks[g.id]=addMark(saved.marks[g.id]||[],wall,pool.current.currentTime);persist();S.syncs.delete(g.id);
  $('settingsError').textContent='';syncStatus();toast('Sync mark saved.');
 }catch(error){$('settingsError').textContent=error.message;}
};
$('clearSync').onclick=()=>{const id=$('syncGame').value;delete saved.marks[id];persist();S.syncs.delete(id);syncStatus();};

// ---------- start ----------
async function init(){
 franchiseOptions();
 try{
  const [archive,clips]=await Promise.all([fetch('/week7.json').then(r=>{if(!r.ok)throw new Error('The replay archive is unavailable. Reload to try again.');return r.json();}),fetch('/nfl-highlights.json').then(r=>r.ok?r.json():{clips:[]}).catch(()=>({clips:[]}))]);
  S.archive=new ReplayArchive(archive);S.clips=clips.clips||[];
  $('daySelect').innerHTML=S.archive.sessions.map((s,i)=>`<option value="${i}">${esc(s.label)}</option>`).join('');
  const sunday=Math.max(0,S.archive.sessions.findIndex(s=>s.label.startsWith('Sunday')));
  setDay(sunday);
  render();restoreConnection();setInterval(()=>frame(performance.now()),100);
 }catch(error){$('ovTitle').textContent='Couldn’t load the slate.';$('ovText').textContent=error.message;$('ovButton').hidden=true;}
}
init();
