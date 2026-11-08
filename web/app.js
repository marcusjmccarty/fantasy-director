import {StreamFinder,refusesFrame} from './stream-finder.js';
import {ReplayArchive,Clock,timeLabel} from './archive.js';
import {RecordingSync,addMark,wallForClock,mergeAnchors} from './sync.js';
import {Director,RULES,rank,hasRoster,rosterTeams} from './director.js';
import {Coverage} from './coverage.js';
import {PlayerPool} from './players.js';
import {officialClip} from './replays.js';
import {NFLSourceCatalog} from './nfl-sources.js';
import {liveGames,liveScores,LiveFeed} from './live.js';
import {alias,describeScore,rosterCredit} from './scoring.js';
import {SAMPLE,TEAMS,POSITIONS,parseRoster,formatRoster,safeVideo,streamType,gameKey,teamColor,teamLogo,forgetESPN} from './roster.js';
import {stripEnds,stripTabStop,stripKeys,mountGameTiles} from './strip.js';
import {normalizeHighlights,playable} from './highlights.js';
import {normalizePreferences} from './preferences.js';
import {liveClipCandidates,highlightPage,canRetryReplay,REPLAY_RETRY_MS,REPLAY_WAIT_SECONDS} from './live-highlights.js';
import {protectedReplayPlay,protectedHighlight,broadcastReplayWindow} from './continuity.js';
import {BreakControl} from './breaks.js';
import {fantasyBoard,fantasyMatchup,headToHead,benchRows,matchupColumns,mountMatchupRows,FantasyScoreFeed,tallyOf,nearStart} from './scoreboard.js';
import {mountChat,chatRoomFor} from './chat.js';
import {buildArchive,latestCompletedWeek} from './archive-build.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const starterCount=n=>`${n} starter${n===1?'':'s'}`;
const STORE='fantasy-stream-v3',ESPN='https://site.api.espn.com/apis/site/v2/sports/football/nfl/';
const LOAD_LIMIT=20000,CLICK_LIMIT=90000,LIVE_LOAD_LIMIT=45000,COOLDOWN=60000,STALE_AFTER=45000,STANDBY_HOLD=90000;
// A replay whose length is not known yet gets a plausible one until its player reports the real figure.
const GUESSED_DURATION=11000;
// The provider's codes for a recording removed, blocked or refused: unlike "still processing", these will not pass.
const GONE_FOR_GOOD=/^PROVIDER_(?:10[123]|15[0-3])$/;

// ---------- saved preferences ----------
let saved=normalizePreferences();
try{
 const stored=JSON.parse(localStorage.getItem(STORE)||'null');
 if(stored)saved=normalizePreferences(stored);
 else{
  const old=JSON.parse(localStorage.getItem('fd-simple-v2')||'null');
  if(old?.leagueId)saved.leagueId=String(old.leagueId);
  if(old?.teamId&&Array.isArray(old.roster))Object.assign(saved,{roster:old.roster,teamName:old.teamName||'My lineup',teamId:old.teamId,league:old.leagueCache||null,lineupReady:true});
  if(old?.streams)saved.streams=old.streams;
  for(const [id,r] of Object.entries(old?.recordings||{}))if(r.marks?.length)saved.marks[id]=r.marks;
 }
}catch{}
saved=normalizePreferences(saved);
// An earlier release saved the guess as if it were the real length. Forget it, so the game learns its length again.
for(const [id,seconds] of Object.entries(saved.replayDurations))if(seconds===GUESSED_DURATION)delete saved.replayDurations[id];
const hasLineup=()=>saved.lineupReady??(saved.teamName!=='Sample lineup');
// In Replay with no lineup of their own, a visitor is watching a team we picked: it's named as such everywhere it shows.
const sampleTeam=()=>S.mode==='replay'&&!hasLineup();
const shownTeam=name=>name==='Sample lineup'?'Sample team':name;
const touch=()=>!!window.matchMedia?.('(pointer:coarse)').matches;
const lineupSnapshot=()=>Object.fromEntries(['roster','teamName','teamId','leagueId','league','lineupReady','espn'].map(key=>[key,saved[key]]));
function persist(){try{localStorage.setItem(STORE,JSON.stringify(S.mode==='replay'&&S.liveLineup?{...saved,...S.liveLineup}:saved));S.storageError=false;}catch{S.storageError=true;}}

// ---------- state ----------
const S={earlyOpen:new Set(),wontPlay:null,startOnLanding:false,streamOpener:null,scope:'game',center:null,range:null,mode:'live',archive:null,archives:new Map(),archiveKey:'w7',weeks:{season:0,latest:0,current:0,loading:0,failed:null,listing:false,landing:0},weekChosen:false,weekRequest:0,weekVideos:new Map(),deadEmbeds:new Set(),pastWeeks:[],pastLoading:false,stripTarget:null,stripStartedAt:0,week7Clips:[],clips:[],liveClips:[],day:0,games:[],at:Date.now()/1000,lastAt:null,
 program:{kind:'idle'},pending:null,pinned:null,selection:null,highlight:null,decision:null,playing:false,started:false,
 fullscreenWanted:false,fullscreenRequest:0,revealedBreaks:new Map(),
 streamChoices:new Map(),deadStreams:new Map(),streamRotations:new Map(),
 cooldown:new Map(),recordingEnds:new Map(),holdBudget:STANDBY_HOLD,ads:new Set(),breaks:new Map(),detectedBreaks:new Map(),dimmed:null,sources:new Map(),syncs:new Map(),usedClips:new Map(),failedClips:new Map(),seekHold:false,cuts:0,
 lastStep:0,lastWarm:0,lastRender:0,live:{games:[],feed:new LiveFeed(),scores:new Map(),summaryPending:new Map(),fetched:0,error:'',generation:0},toastTimer:null,unmuteHint:false};
const fantasyFeed=new FantasyScoreFeed(),streamFinder=new StreamFinder({fetcher:(...args)=>fetch(...args)});
streamFinder.enabled=saved.autoDiscover;
const clock=new Clock(),director=new Director(),coverage=new Coverage(),nfl=new NFLSourceCatalog(),breakControl=new BreakControl();
const pool=new PlayerPool($('layers'),{capacity:3,
 onAd:(key,on)=>{
  if(on)S.ads.add(key);else S.ads.delete(key);
  const adSlot=pool.get(key);if(adSlot)adSlot.adAt=on?performance.now():null;
  if(on)suppressBreak(key);
  if(on&&S.highlight?.src.key===key){failHighlight('the replay opened an advertisement');return;}
  render();
 },
 onClose:key=>S.ads.delete(key),
 onBeforeLeave:()=>preserveChannelFullscreen(),
 onReconnect:(key,detail)=>{
  if(!S.playing)return;
  const stage=document.querySelector('.stage'),active=document.fullscreenElement||document.webkitFullscreenElement;
  if(key===pool.visible&&active&&active!==stage){
   // Install the in-window fallback before navigation. Older browsers may
   // still allow a nested player to own native fullscreen and drop it here.
   S.fullscreenWanted=true;stage.classList.add('theater');
  }
  if(detail?.failover)rotateStream(key);
 },
 onEnded:key=>{
  if(S.highlight?.src.key===key)finishHighlight({ended:true});
  else if(S.mode==='replay'&&archiveGame(key))recordingEnded(key);
  else if(S.program.kind==='game'&&S.program.id===key){S.pinned=null;S.selection=null;S.cooldown.set(key,performance.now()+COOLDOWN);director.reset();}
 },
 onError:(key,error)=>{if(S.highlight?.src.key===key){failHighlight(error.message);return;}if(S.mode==='live'&&pool.get(key)?.player.live)return;if(S.mode==='replay'&&GONE_FOR_GOOD.test(error.code)&&archiveGame(key)){videoGone(key,error.message);return;}cool(key,error.message);},
 onAudioLocked:key=>{if(key===pool.visible){if(S.audioAsked>=1)toast(pool.current?.kind==='provider'?'To hear the game, click inside the video.':'Your browser blocked the sound. Click the video, then try sound again.','warn');render();}}
});
window.fantasyStream={S,get saved(){return saved;},pool,director,coverage,clock};

// ---------- games, sources and alignment ----------
const roster=()=>S.mode==='live'&&!hasLineup()?[]:saved.roster;
const archiveGame=id=>S.archive?.game(id);
const gameState=id=>S.games.find(g=>g.id===id);
function syncFor(game){
 let sync=S.syncs.get(game.id);
 if(!sync){if(!(game.recordingDuration>0)){game.recordingDuration=GUESSED_DURATION;game.durationGuessed=true;}sync=new RecordingSync(game,{types:S.archive.types,anchors:mergeAnchors(game.anchors||[],saved.marks[game.id]||[])});S.syncs.set(game.id,sync);}
 return sync;
}
// Only a length the provider itself reported counts: a player told the length at its start has nothing to teach.
function learnDuration(id,player){
 const g=archiveGame(id);if(!g||player?.kind!=='provider'||player.knownDuration||!(Number.isFinite(player.duration)&&player.duration>600))return false;
 if(!g.durationGuessed&&g.recordingDuration>0&&!(player.corrected&&!S.archive.data.calibrated&&Math.abs(g.recordingDuration-player.duration)>5))return false;
 g.recordingDuration=player.duration;g.durationGuessed=false;saved.replayDurations[g.id]=Math.round(player.duration);if(g.embed)saved.replayDurationEmbeds[g.id]=g.embed;persist();S.syncs.delete(g.id);S.recordingEnds.delete(g.id);breakControl.forget(g.id);S.detectedBreaks.delete(g.id);
 // Broadcast replays waiting in the queue were cut on the guessed curve: prepare them again.
 for(const q of coverage.queue)if(q.gameId===g.id&&S.sources.get(q.id)?.label==='Broadcast replay')S.sources.delete(q.id);
 return true;
}
// What a player is told about its recording: a guess is not knowledge, so it finds out for itself.
const knownLength=g=>g.durationGuessed?undefined:g.recordingDuration;
// A replay's video, unless the provider has said it is gone for good.
const hasVideo=id=>{const embed=archiveGame(id)?.embed;return !!embed&&!S.deadEmbeds.has(embed);};
const DEAD_STREAM=300000;   // ms a direct link that never showed footage is left alone
function streamURLs(game){const key=gameKey(game),now=performance.now();return streamFinder.urls(game,[saved.streams[key],saved.streamBackups[key]],saved.streamModes[key]).filter(url=>!(S.deadStreams.get(url)>now));}
// A stream that refuses a frame opens in a new tab: never a source for the channel, which follows that game on the tracker.
const inlineURLs=game=>streamURLs(game).filter(url=>!refusesFrame(url));
const outsideURL=game=>{if(inlineURLs(game).length)return null;const url=streamURLs(game)[0];return url?streamFinder.original(url):null;};
const kickoffOf=g=>{const at=g.date?new Date(g.date):g.start?new Date(g.start*1000):null;return at&&Number.isFinite(at.getTime())?'Kickoff '+KICKOFF_TIME.format(at):'';};
function sourceFor(id){
 if(S.mode==='replay'){const g=archiveGame(id);return hasVideo(id)?{url:g.embed,type:'provider/ok',duration:knownLength(g)}:null;}
 // A game that hasn't started loads nothing until the viewer asks, so nobody lands on a site's ad-heavy waiting page.
 const g=gameState(id);if(g?.state==='pre'&&!S.earlyOpen.has(id))return null;
 const urls=g?inlineURLs(g):[],choice=S.streamChoices.get(id),url=urls.includes(choice)?choice:(pool.visible===id?pool.get(id)?.url:null)||urls[0];
 return url?{url,page:streamFinder.original(url),type:streamType(url),live:true,autoReconnect:saved.autoReconnect}:null;
}
// A fallback changes the source for this game, never the director's choice of game.
function rotateStream(id,manual=false){
 if(S.mode!=='live'||!S.playing||!(pool.visible===id&&S.program.kind==='game'||S.pending?.id===id))return false;
 const slot=pool.get(id),g=gameState(id);if(!slot||!g)return false;
 const links=inlineURLs(g),alternative=links.length>1?links[(links.indexOf(slot.url)+1)%links.length]:null,now=performance.now();
 if(!alternative||!manual&&now<(S.streamRotations.get(id)||0))return false;
 S.streamRotations.set(id,now+60000);S.streamChoices.set(id,alternative);
 const visible=pool.visible===id;pool.close(id);pool.open(id,sourceFor(id));pool.hold(id,null,{play:true});
 if(visible)pool.show(id);if(S.pending?.id===id)S.pending.since=now;
 S.stall=null;S.lastAt=null;toast(`Trying the next stream for ${g.name}.`);render();return true;
}
// A replay without its video (a latest-week game with no link yet) runs on the game tracker.
const pastRecordingEnd=(id,at)=>at>=(S.recordingEnds.get(id)??Infinity);
const picture=id=>S.mode==='replay'?(saved.dataOnly||!hasVideo(id)||pastRecordingEnd(id,S.at)?'data':'video'):(sourceFor(id)?'video':'data');
function target(id){if(S.mode!=='replay')return null;const g=archiveGame(id);return g?syncFor(g).media(S.at-g.start):0;}
function cool(id,message){
 S.cooldown.set(id,performance.now()+COOLDOWN);if(S.pending?.id===id)S.pending=null;pool.close(id);
 if(S.program.kind==='game'&&S.program.id===id){S.program={kind:'standby'};S.unmuteHint=false;pool.hide();}
 if(message)toast(`${gameState(id)?.name||'Game'}: the video isn’t playing right now. Trying again shortly.`,'warn');
}
// A recording that really ends hands the rest of the game to the tracker: no cooldown, no reopening the same
// last frame. It goes by position, so seeking back before that point brings the video back.
function recordingEnded(key){
 const slot=pool.get(key),player=slot.player;if(player.inAd)return;
 // A seek past the end of a guessed length ends the file too: correct the length and go where the footage is.
 if(learnDuration(key,player)){slot.seekAt=-Infinity;player.seek(target(key));return;}
 // Left over from before a seek that is still on its way to footage inside the file.
 if(player.target!==null&&!(player.target>=player.duration-2))return;   // an unknown length proves nothing about the end
 S.recordingEnds.set(key,Math.min(S.recordingEnds.get(key)??Infinity,S.at));
 if(S.pending?.id===key)S.pending=null;
 const shown=S.program.kind==='game'&&S.program.id===key,name=archiveGame(key).name,inPlay=gameState(key)?.state==='in';
 if(S.pinned===key||shown){S.pinned=null;S.selection=null;director.reset();}
 pool.close(key);
 if(shown){S.stall=null;S.program={kind:'standby'};pool.hide();if(inPlay)toast(`${name}: the recording ends here · following on the game tracker.`,'warn');}
}
// A recording the provider has removed or refused will not come back: the tracker takes this game, with no cooldown and no reopening.
function videoGone(key,message){
 const embed=archiveGame(key).embed,shown=S.program.kind==='game'&&S.program.id===key,name=archiveGame(key).name;
 S.deadEmbeds.add(embed);if(S.pending?.id===key)S.pending=null;pool.close(key);
 if(shown){S.stall=null;S.program={kind:'standby'};pool.hide();}
 toast(`${name}: this video isn’t available. Following on the game tracker instead.`,'warn');
}
// A recording that has never shown footage here (some phones refuse it inside a frame): no hopping from game to game, the viewer gets the video's own page.
function noFootageHere(id){const g=archiveGame(id);pool.close(id);S.pending=null;S.stall=null;S.unmuteHint=false;S.program={kind:'standby'};S.wontPlay={id,name:g.name,url:g.embed};setPlaying(false);render();}
function excluded(){
 const now=performance.now(),out=new Set();
 for(const [id,until] of S.cooldown)if(until>now)out.add(id);else S.cooldown.delete(id);
 for(const key of S.ads)out.add(key);
 for(const key of S.detectedBreaks.keys())out.add(key);
 const breakNow=S.playing?now:S.pausedAt??now;
 for(const [id,until] of S.breaks)if(until>breakNow)out.add(id);else S.breaks.delete(id);
 if(S.mode==='live'){
  const videos=S.games.filter(g=>g.state==='in'&&sourceFor(g.id));
  const rosterVideo=videos.some(g=>hasRoster(g,roster())&&!out.has(g.id));
  const videoBreak=videos.some(g=>S.ads.has(g.id)||S.detectedBreaks.has(g.id)||S.breaks.has(g.id));
  const backup=videoBreak&&videos.some(g=>g.phase!=='break'&&!out.has(g.id));
  // A commercial should yield to available football, even when another
  // starter's game has only a text tracker. Keep trackers as the fallback
  // when no replacement video is available. Before any break, an unrelated
  // link alone still cannot displace the viewer's roster tracker. A tracker
  // the viewer pinned holds until its own break or final.
  if(rosterVideo||backup)for(const g of S.games)if(!inlineURLs(g).length&&!(g.id===S.pinned&&g.state==='in'))out.add(g.id);
 }
 return out;
}
const LIVE_SLACK=12;   // seconds the scoreboard may trail the snap on top of the stream delay
const backupGames=()=>new Set(S.games.filter(g=>picture(g.id)==='video'&&sourceFor(g.id)).map(g=>g.id));
function preserveChannelFullscreen({cover=false}={}){
 const stage=document.querySelector('.stage'),active=document.fullscreenElement||document.webkitFullscreenElement;
 if(!active||active===stage)return;
 S.fullscreenWanted=true;stage.classList.add('theater');
 // An iframe's own fullscreen hides the parent's commercial cover. Leave it
 // before covering or replacing that document; retain the channel-sized view.
 if(cover){try{const exit=document.exitFullscreen||document.webkitExitFullscreen;Promise.resolve(exit?.call(document)).catch(()=>{});}catch{}}
}
function suppressBreak(key){
 if(pool.visible!==key)return;
 if(stayThroughBreak(key)){preserveChannelFullscreen({cover:true});S.dimmed={id:key,kind:'break',since:performance.now()};S.lastAt=null;return;}
 pool.hide();S.lastAt=null;S.dimmed=null;
 if(S.program.kind==='game'&&S.program.id===key)S.program={kind:'standby'};
}
// Keep the current website frame mounted during a break; the opaque cover
// prevents commercial pictures without discarding the provider session.
function stayThroughBreak(key){
 return S.mode==='live'&&pool.visible===key&&pool.current?.kind==='embed';
}
function resetBreaks(){breakControl.reset();S.detectedBreaks.clear();S.revealedBreaks.clear();}
const breakToken=(id,reason=S.detectedBreaks.get(id))=>reason?.key||[gameState(id)?.lastPlayId||'',reason?.kind||gameState(id)?.breakKind||'',...(gameState(id)?.score||[])].join('|');
function revealBreak(id){
 if(S.mode!=='live'||!id||!sourceFor(id))return;
 S.revealedBreaks.set(id,breakToken(id));S.breaks.delete(id);S.detectedBreaks.delete(id);S.dimmed=null;
 selectGame(id);
}
function updateBreaks(){
 const id=S.program.kind==='game'&&pool.visible===S.program.id?S.program.id:null,recording=id&&S.mode==='replay'?archiveGame(id):null;
 const media=S.seekHold&&recording?target(id):pool.current?.currentTime;
 const protection=recording?protectedReplayPlay(recording,S.archive.types,syncFor(recording),media,roster(),{includeDefense:saved.includeDefense,allAction:S.pinned===id}):null;
 const state=breakControl.update({games:S.games,at:S.at,available:backupGames(),currentId:id,media,protection,
  recording:key=>S.mode==='replay'?archiveGame(key):null,syncFor,types:S.archive?.types||[]});
 // The viewer can correct one false break without reloading the video. A
 // different break or resumed play restores automatic commercial handling.
 for(const [key,token] of S.revealedBreaks){
  if(!state.blocked.has(key)||token!==breakToken(key,state.reasons.get(key)))S.revealedBreaks.delete(key);
  else{state.blocked.delete(key);state.released.delete(key);state.reasons.delete(key);}
 }
 S.detectedBreaks=state.reasons;
 if(S.pinned&&state.released.has(S.pinned)&&!heldChoice(S.pinned)){S.pinned=null;S.selection=null;director.reset();}
 const visible=pool.visible,manual=visible&&S.breaks.get(visible)>performance.now();
 if(visible&&(state.blocked.has(visible)||S.ads.has(visible)||manual)){
  if(stayThroughBreak(visible)){preserveChannelFullscreen({cover:true});S.dimmed={id:visible,kind:state.reasons.get(visible)?.kind||'break',since:S.dimmed?.id===visible?S.dimmed.since:performance.now()};}
  else suppressBreak(visible);
 }else S.dimmed=null;
}
function recentScore(game,at){
 if(game.celebrating)return 'Score on the field';   // the live feed keeps a fresh score on screen for the celebration
 const t=S.mode==='live'?at-saved.delay:at;return (game.scores||[]).some(s=>t-s.at>=0&&t-s.at<RULES.scoreHold&&rosterCredit(s,game,roster()).length);
}

// ---------- the loop ----------
function frame(now){
 // One click on the first screen: the replay starts once the latest week has landed, not a click later.
 if(S.startOnLanding&&S.mode==='replay'&&S.archive&&!landingWeek()&&!S.weeks.listing&&!weekLoads.size){S.startOnLanding=false;if(!S.started)setPlaying(true);}
 advanceClock(now);
 if(now-S.lastStep>=250){S.lastStep=now;step(now);}
 if(now-S.lastRender>=400){S.lastRender=now;render();}
}
function visibleConfirmed(){
 const p=S.program;if(p.kind!=='game')return false;
 if(S.ads.has(p.id)||S.breaks.has(p.id)||S.detectedBreaks.has(p.id))return false;
 if(picture(p.id)==='data')return S.mode==='replay'&&saved.dataOnly;
 if(pool.visible!==p.id||!pool.current)return false;
 // A loaded page proves nothing about its video: an embed counts as watched only on the viewer's own recent click inside it.
 if(pool.current.kind==='embed')return S.mode==='live'&&!!pool.current.viewerConfirmed;
 return !!pool.current.progressing;
}
// A starter's game coming back (an ad, a cooldown, a reopen) keeps its place on the clock, so its plays are not lost behind the overlay.
// The budget only refills while footage plays: a recording that keeps failing cannot freeze the day. Skip break needs the clock to run.
function clockHeld(now){
 return S.mode==='replay'&&S.playing&&S.program.kind==='standby'&&S.holdBudget>0&&!S.games.some(g=>S.breaks.has(g.id))&&S.games.some(g=>g.state==='in'&&(S.ads.has(g.id)||S.cooldown.get(g.id)>now||S.pending?.id===g.id)&&picture(g.id)==='video'&&(hasRoster(g,roster())||g.id===S.pinned));
}
function advanceClock(now){
 if(S.mode==='live'){S.at=Date.now()/1000;return;}
 if(!S.archive)return;
 // Every open player can teach its game's real length, before the cut that would land on the guess. A seek aimed on the guess is aimed again.
 for(const [key,slot] of pool.slots)if(learnDuration(key,slot.player)){slot.seekAt=-Infinity;if(key===pool.visible&&slot.player.target!==null)slot.player.seek(target(key));}
 const p=S.program,video=p.kind==='game'&&picture(p.id)==='video';
 // A landing a few seconds off the target stays off it as the footage plays, so landed and moving also ends the hold.
 if(S.seekHold&&video&&(pool.ready(p.id,target(p.id),3)||pool.visible===p.id&&pool.current?.target===null&&pool.current?.progressing))S.seekHold=false;
 if(S.seekHold&&!video)S.seekHold=false;
 // The picture drives replay time. Edits differ by recording; in-band ads
 // are not reliably observable through the provider's playback API.
 const dt=Math.max(0,now-(clock.last??now));
 if(S.playing&&video&&!S.seekHold&&pool.visible===p.id&&pool.current?.progressing){
  S.holdBudget=Math.min(STANDBY_HOLD,S.holdBudget+dt);
  const g=archiveGame(p.id),wall=g.start+syncFor(g).wall(pool.current.currentTime);
  // Small backward wobble is ignored; a sustained difference (the viewer
  // scrubbed inside the player) is followed.
  if(wall>clock.at-1.5&&wall<clock.at+900){clock.seek(wall,now);S.driftSince=null;}
  else{S.driftSince??=now;if(now-S.driftSince>2500){resetBreaks();S.lastAt=null;clock.seek(wall,now);S.driftSince=null;}else clock.tick(now);}
  clock.running=true;
 }else{
  const holding=clockHeld(now);if(holding)S.holdBudget-=dt;
  const waiting=S.playing&&(p.kind==='idle'||holding||video&&(S.seekHold||pool.visible!==p.id||!pool.current?.progressing&&!S.ads.has(p.id)));
  clock.set(S.playing&&!waiting,now);
 }
 S.at=clock.at;
 if(clock.at>=clock.end&&S.playing)setPlaying(false,'That’s the end of this replay day.');
}
function step(now){
 if(S.mode==='replay'){if(!S.archive)return;S.games=S.archive.sample(S.at,day().gameIds);}
 else S.games=S.live.feed.view(S.at,saved.delay).map(g=>({...g,scores:S.live.scores.get(g.id)||[]}));   // the feed as the stream shows it
 if(S.started&&S.playing)updateBreaks();
 if(S.playing&&S.lastAt!==null&&visibleConfirmed())coverage.watch(S.program.id,S.lastAt,S.at,S.mode==='live'?5:3+clock.rate*1.5);
 S.lastAt=S.at;
 if(S.mode==='live'){S.coverageStart??=S.at-saved.delay;coverage.skipTo(S.games,S.coverageStart);}
 for(const item of coverage.update(S.games,roster(),S.at,S.mode==='live'?saved.delay:0,S.mode==='live'?LIVE_SLACK:0))announce(item);
 if(!saved.highlights)coverage.queue.length=0;
 retryMissedReplays();
 for(const item of coverage.queue)prepareReplay(item);
 if(!S.started||!S.playing)return;
 // Decide whether live action needs the screen before revealing a loading clip.
 if(S.highlight?.playing)updateHighlight(now);
 const blocked=excluded();
 const queue=coverage.queue.filter(q=>S.sources.get(q.id)?.status==='ready');
 const current=S.highlight&&!S.highlight.done?{kind:'highlight',id:S.highlight.item.id,protected:protectedHighlight(S.highlight,pool.current)}:S.highlight?.done?{kind:'game',id:S.highlight.returnTo}:S.program.kind==='game'?{kind:'game',id:S.program.id}:{};
 if(current.kind==='game'&&S.mode==='replay'&&!saved.dataOnly&&pool.visible===current.id&&!S.seekHold){
  const recording=archiveGame(current.id);
  if(recording)current.protected=!!protectedReplayPlay(recording,S.archive.types,syncFor(recording),pool.current?.currentTime,roster(),{includeDefense:saved.includeDefense,allAction:S.pinned===current.id});
 }
 // A frozen scoreboard (ESPN outage) is no reason to change the picture: hold what is on screen until updates return.
 const stale=S.mode==='live'&&S.live.fetched&&Date.now()-S.live.fetched>STALE_AFTER;
 const staying=!!S.dimmed&&pool.visible===S.dimmed.id&&current.kind==='game'&&current.id===S.dimmed.id;
 const decisionBlocked=staying?new Set([...blocked].filter(id=>id!==S.dimmed.id)):blocked;
 const decision=selectionDecision(blocked,now,current.protected)||
  (stale&&S.program.kind==='game'&&!decisionBlocked.has(S.program.id)?{kind:'game',id:S.program.id,reason:'Game updates paused · holding this game'}:null)||
  director.decide({games:S.games,roster:roster(),at:S.at,current,excluded:decisionBlocked,queue,includeDefense:saved.includeDefense,recentScore,backups:backupGames(),redzone:S.mode==='live',stayThrough:staying});
 S.decision=decision;
 if(decision.kind==='highlight'){S.pending=null;if(!S.highlight||S.highlight.done)startHighlight(decision.id);if(S.highlight&&!S.highlight.playing)updateHighlight(now);}
 else if(decision.kind==='game'){if(S.highlight&&!S.highlight.done&&!S.highlight.playing)closeHighlight();cutTo(decision.id,now);}
 else if(decision.kind==='standby'){
  if(S.highlight){S.highlight.done=true;closeHighlight();}S.pending=null;
  if(S.program.kind!=='standby'){S.program={kind:'standby'};pool.hide();}
  // A replay need not make the viewer wait through an edited timeout when
  // every available game is in a break. Preserve missed-score bookkeeping.
  if(S.mode==='replay'&&!S.ads.has(S.pinned)&&S.games.some(g=>g.state==='in'&&(hasRoster(g,roster())||g.id===S.pinned))){
   const next=Math.min(...[...S.detectedBreaks.values()].map(b=>b.until).filter(t=>Number.isFinite(t)&&t>S.at));
   if(Number.isFinite(next)&&next<=clock.end){clock.seek(next,now);S.at=next;S.lastAt=null;}
  }
 }
 if(now-S.lastWarm>1000){S.lastWarm=now;warm(blocked);}
 nudge(now);
}
// A provider frame put on screen to wait for a click inside it (autoplay refused): it has CLICK_LIMIT to get that click.
const awaitingClick=(id,player)=>S.mode==='replay'&&S.unmuteHint&&S.pending?.id===id&&pool.visible===id&&player?.kind==='provider'&&player.initialized&&!player.error;
// The picture on screen stopped moving: ask the player again, then re-seek it, then give up on that game for a while.
function nudge(now){
 const p=S.program,player=pool.current;
 if(p.kind!=='game'||!S.playing||picture(p.id)!=='video'||!player||pool.visible!==p.id||player.inAd){S.stall=null;return;}
 // Page load readiness cannot detect a frozen cross-origin video. Give embeds
 // their spaced load retries and the viewer's chosen reconnect fallback.
 if(player.kind==='embed'){S.stall=null;player.checkHealth?.({online:window.navigator?.onLine!==false,foreground:!document.hidden});return;}
 if(S.mode==='live'&&player.live){S.stall=null;player.checkHealth({active:true,online:window.navigator?.onLine!==false,foreground:!document.hidden});return;}
 if(player.target===null&&player.progressing){S.stall=null;return;}
 // Never moved at all: a tap may still start it (a nudge can too), but it gets the tap's full time, and then the way out instead of a hop to the next game.
 if(S.mode==='replay'&&player.played===false){S.stall??={since:now,step:0};const waited=now-S.stall.since;if(S.stall.step===0&&waited>3000){S.stall.step=1;player.kick?.();}if(waited>(player.initialized?CLICK_LIMIT:LOAD_LIMIT))noFootageHere(p.id);return;}
 if(awaitingClick(p.id,player)){S.stall=null;return;}
 S.stall??={since:now,step:0};const stalled=now-S.stall.since;
 if(S.stall.step===0&&stalled>3000){S.stall.step=1;player.kick?.();}
 else if(S.stall.step===1&&stalled>10000){S.stall.step=2;const t=target(p.id);if(t!==null)player.seek(t);player.play();}
 else if(S.stall.step===2&&stalled>22000){S.stall=null;cool(p.id,'the stream stopped responding');}
}

// ---------- cuts ----------
// A past tile opened for a game with none of the viewer's starters: nothing else ever brings that game back, so the choice outlasts its breaks.
const heldChoice=id=>S.mode==='replay'&&S.selection?.id===id&&!!S.selection.hold&&!!gameState(id)&&!hasRoster(gameState(id),roster());
function selectionDecision(blocked,now,protectedPlay=false){
 if(!S.pinned)return null;
 const g=gameState(S.pinned);
 const release=()=>{S.pinned=null;S.selection=null;director.reset();return null;};
 if(!g)return release();
 // A replay's ad belongs to the provider, not the game: the director fills the screen and the choice resumes when it ends.
 if(blocked.has(g.id))return S.mode==='replay'&&(S.ads.has(g.id)||heldChoice(g.id))?null:release();
 const choice=S.selection?.id===g.id?S.selection:(S.selection={id:g.id,initialState:g.state,shownAt:null,actionSeen:false});
 if(S.program.kind==='game'&&S.program.id===g.id&&!S.pending){
  choice.shownAt??=now;
  if(g.state==='in'&&g.phase!=='break')choice.actionSeen=true;
 // Video breaks are excluded before selection; tracker-only selections can
 // still use their feed phase directly.
  if(!protectedPlay&&!heldChoice(g.id)&&!S.revealedBreaks.has(g.id)&&g.phase==='break'&&(choice.actionSeen||now-choice.shownAt>=10000))return release();
  if(g.state==='post'&&choice.initialState!=='post')return release();
 }
 return {kind:'game',id:g.id,reason:'Returns after the next break'};
}
function selectGame(id,{hold=false}={}){
 const g=gameState(id);if(!g)return;
 if(S.mode==='replay'&&g.state!=='in'){const recording=archiveGame(id);if(recording)seekTo(recording.start);}
 skipHighlight();
 S.pinned=id;S.selection={id,initialState:gameState(id)?.state||g.state,shownAt:null,actionSeen:false,hold};S.pending=null;director.reset();
 // Choosing Watch is an explicit playback action, including from Pause.
 if(!S.playing)setPlaying(true);
 if(S.playing)step(performance.now());render();
}
function skipHighlight(){
 const h=S.highlight;if(!h)return;
 item(h).status='skipped';h.done=true;pool.get(h.src.key)?.player.pause();
 // Keep the last picture until the selected/automatic return stream is ready.
}
function cutTo(id,now){
 // Already the program and showing. A program with no picture yet (the tracker gave way to video after a seek back) still has to open.
 if(S.program.kind==='game'&&S.program.id===id&&!S.highlight&&S.pending?.id!==id&&(picture(id)!=='video'||pool.visible===id)){S.pending=null;return;}
 // The target is already the picture on screen (an inset replay just finished over it): nothing to wait for.
 if(pool.visible===id&&picture(id)==='video'&&pool.get(id)&&!(S.program.kind==='game'&&S.program.id===id)){commit(id);return;}
 if(picture(id)==='data'){commit(id);return;}
 const source=sourceFor(id);if(!source){commit(id);return;}
 if(S.pending?.id!==id)S.pending={id,since:now};
 // A stopped clock (a scrub settling, a game coming back) is not a moving target to lead.
 const slot=pool.open(id,source);pool.hold(id,target(id),{play:true,fixed:!clock.running||clockHeld(now)});
 if(S.mode==='live'&&slot.player.live){slot.player.checkHealth({active:S.playing,online:window.navigator?.onLine!==false,foreground:!document.hidden});if(pool.get(id)!==slot)return;}
 if(pool.ready(id,target(id)))return commit(id);
 if(now-S.pending.since>(awaitingClick(id,slot.player)?CLICK_LIMIT:LOAD_LIMIT)&&!(S.mode==='live'&&slot.player.live)){
  if(S.mode==='replay'&&pool.visible===id&&slot.player.played===false)noFootageHere(id);else cool(id,'it did not start in time');
 }else if(S.mode==='live'&&slot.player.live&&slot.player.kind!=='embed'&&S.pinned!==id&&now-S.pending.since>LIVE_LOAD_LIMIT){
  // A direct live link that never yields footage: the backup first; otherwise the link (not the game) is set aside and the tracker shows the game.
  if(!rotateStream(id)){const g=gameState(id);S.deadStreams.set(slot.url,now+DEAD_STREAM);S.streamChoices.delete(id);pool.close(id);S.pending=null;toast(`${g?.name||'Game'}: the stream never started. Following on the game tracker for a few minutes. Reload stream tries it again.`,'warn');render();}
 }else if(now-S.pending.since>8000&&(!pool.visible||!pool.current?.progressing||S.pinned===id)&&pool.visible!==id){
  // A manual choice may need a click inside its player. Leaving it hidden
  // behind the outgoing stream makes that click impossible until timeout.
  pool.show(id);S.program={kind:'game',id};S.unmuteHint=true;
 }
}
function commit(id){
 const was=S.program.kind==='game'?S.program.id:null,confirming=S.pending?.id===id;
 // Keep an unfinished replay moving until the replacement picture is ready.
 if(S.highlight?.playing&&!S.highlight.done)finishHighlight();
 if(picture(id)==='video'){pool.show(id);if(S.highlight)closeHighlight();}else{pool.hide();if(S.highlight)closeHighlight();}
 // Each newly shown page gets its own recovery window. Carrying the previous
 // player's stalled timer across cuts can immediately reject a healthy embed.
 S.program={kind:'game',id,since:S.at};S.pending=null;S.stall=null;director.committed(S.at);if(S.dimmed?.id!==id)S.dimmed=null;
 S.unmuteHint=false;
 if(was!==id||confirming)S.cuts++;
 render();
}

// Keep the next likely games playing silently in the background.
function warm(blocked){
 const want=new Set();
 const p=S.program;if(p.kind==='game')want.add(p.id);
 if(S.pending)want.add(S.pending.id);
 if(S.highlight){want.add(S.highlight.src.key);if(S.highlight.previousKey)want.add(S.highlight.previousKey);const back=S.pending?.id||S.highlight.returnTo;if(back)want.add(back);}
 // A transition can need three slots: outgoing clip, incoming clip, return game.
 // Do not warm a fourth player that could evict the incoming clip.
 if(S.started&&S.playing&&!S.highlight){
  const current=p.kind==='game'?p.id:S.highlight?.returnTo;
  const options={excluded:blocked,includeDefense:saved.includeDefense};
  const now=rank(S.games,roster(),options).filter(e=>e.game.id!==current).map(e=>e.game.id);
  const fillers=S.games.filter(g=>g.id!==current&&g.state==='in'&&g.phase!=='break'&&!blocked.has(g.id)&&backupGames().has(g.id)).map(g=>g.id);
  let ahead=[];
  if(S.mode==='replay')for(const dt of [20,45,75]){const top=rank(S.archive.sample(S.at+dt,day().gameIds),roster(),options)[0];if(top&&top.game.id!==current)ahead.push(top.game.id);}
  // One game warms at a time: several provider streams buffering at once starve the one on screen.
  const healthy=p.kind!=='game'||picture(p.id)!=='video'||pool.current?.progressing;
  if(healthy)for(const id of [...new Set([now[0],ahead[0],now[1],ahead[1],fillers[0]].filter(Boolean))].slice(0,1))want.add(id);
 }
 // A hidden player in an ad is left to finish it, within reason: a fresh embed would only start the ad again.
 if(S.mode==='replay')for(const key of S.ads){const slot=pool.get(key);if(slot?.adAt!=null&&performance.now()-slot.adAt<STANDBY_HOLD)want.add(key);}
 for(const key of want){
  if(key.startsWith('hl:')||key===pool.visible||blocked.has(key))continue;
  if(picture(key)!=='video')continue;
  const source=sourceFor(key);if(!source)continue;
  pool.open(key,source);pool.hold(key,target(key),{play:S.playing||key===S.pending?.id,fixed:!clock.running});
 }
 if(pool.visible&&S.playing&&!blocked.has(pool.visible)&&!heldHighlight(pool.visible)&&!pool.current?.wantPlay)pool.current?.play();
 pool.keep(want);
}
function heldHighlight(key){const h=S.highlight;return h&&(h.done&&key===h.src.key||key===h.previousKey);}

// ---------- missed-score replays ----------
async function prepareReplay(item,previous=null){
 if(S.sources.has(item.id))return;
 const pending={status:'pending'};S.sources.set(item.id,pending);
 try{const source=await replaySource(item);if(S.sources.get(item.id)!==pending)return;if(source.clipId&&source.clipId===previous?.clipId)Object.assign(source,{ranges:previous.ranges,resumeAt:previous.resumeAt,incompleteEnds:previous.incompleteEnds});S.sources.set(item.id,{status:'ready',...source});}
 catch(error){if(S.sources.get(item.id)!==pending)return;S.sources.set(item.id,{status:'none',reason:error.message,retryAt:Date.now()+REPLAY_RETRY_MS});coverage.drop(item.id);item.unavailable=!(S.mode==='live'&&canRetryReplay(item,S.at));item.status=item.unavailable?'missed':'waiting';render();}
}
function retryMissedReplays(){
 if(S.mode!=='live'||!saved.highlights)return;
 for(const entry of coverage.log){
  const src=S.sources.get(entry.id);if(src?.status!=='none'||entry.seen||entry.status==='replayed')continue;
  if(!canRetryReplay(entry,S.at)){entry.status='missed';entry.unavailable=true;continue;}
  if(src.retryAt>Date.now())continue;
  S.sources.delete(entry.id);entry.unavailable=false;entry.status='queued';coverage.requeue(entry);
 }
}
async function replaySource(item){
 // On the tracker (no video for this game) a score is replayed as the play itself.
 if(S.mode==='replay'&&(saved.dataOnly||!hasVideo(item.gameId)))return {key:'hl:'+item.id,data:true,duration:8,label:'Scoring play',title:item.score.text};
 const failed=S.failedClips;
 const games=S.live.games.map(g=>({...g,scores:S.live.scores.get(g.id)||g.scores||[]}));
 const candidates=S.mode==='replay'?[officialClip(item,S.clips)].filter(Boolean):liveClipCandidates(item,S.liveClips,games,{used:S.usedClips,failed});
 if(S.mode==='live'){const page=liveClipCandidates(item,S.liveClips,games,{used:S.usedClips,allowUnavailable:true}).map(c=>highlightPage(c.url)).find(Boolean);item.watchUrl=page||null;}
 for(const clip of candidates.slice(0,3)){
  const page=highlightPage(clip.url);if(page)item.watchUrl=page;
  try{
   const info={clipId:clip.id,clip,watchUrl:page,expiresAt:clip.expiresAt||0,fullClip:true};
   if(clip.mediaUrl)return {...info,key:'hl:'+item.id+':'+clip.id,source:{url:clip.mediaUrl,type:'video/mp4'},start:0,duration:Number(clip.duration)>0?Number(clip.duration):0,label:'ESPN highlight',title:clip.title};
   const r=await nfl.resolve(clip);
   return {...info,expiresAt:r.expiresAt||0,key:'hl:'+item.id+':'+clip.id,source:{url:r.url,type:'application/vnd.apple.mpegurl'},start:0,duration:Number(r.duration)>0?Number(r.duration):Number(clip.duration)||0,label:'NFL.com highlight',title:clip.title};
  }catch{failed.set(clip.id,Date.now()+60000);}
 }
 if(S.mode==='live')throw new Error('No replay has been published yet.');
 const game=archiveGame(item.gameId);
 // A score after the recording ended cannot come from its file: the tracker shows it as the play itself.
 if(pastRecordingEnd(game.id,item.at))return {key:'hl:'+item.id,data:true,duration:8,label:'Scoring play',title:item.score.text};
 return {key:'hl:'+item.id,source:{url:game.embed,type:'provider/ok',duration:knownLength(game)},...broadcastReplayWindow(item,game,syncFor(game)),label:'Broadcast replay',title:item.score.text};
}
function startHighlight(id){
 const prepared=S.sources.get(id),waiting=coverage.queue.find(q=>q.id===id);
 if(prepared&&(prepared.expiresAt&&prepared.expiresAt<=Date.now()+10000||waiting&&!validPreparedClip(waiting,prepared))){S.sources.delete(id);if(waiting)prepareReplay(waiting,prepared);return;}
 const item=coverage.take(id),src=S.sources.get(id);if(!item||!src)return;
 // Back-to-back replays: the finished one stays up until the next is playing.
 const previous=S.highlight,returnTo=previous?.returnTo??(S.program.kind==='game'?S.program.id:S.pending?.id||null);
 const playStart=Math.max(src.start||0,src.resumeAt||0);
 // Over a website player the clip plays as a muted inset, so the stream underneath is never unloaded.
 const inset=S.mode==='live'&&!src.data&&!!returnTo&&pool.visible===returnTo&&pool.current?.kind==='embed';
 S.highlight={item,src,returnTo,playStart,since:performance.now(),playing:false,done:false,inset,previousKey:previous?.src.key,previousView:previous?.playing?{item:previous.item,src:previous.src,playing:true,done:true}:previous?.previousView};S.pending=null;
 if(src.data){S.highlight.playing=true;S.highlight.until=performance.now()+src.duration*1000;pool.hide();S.program={kind:'highlight',id};render();return;}
 // A repeated attempt must not inherit an ended or half-played video element.
 pool.close(src.key);const slot=pool.open(src.key,src.source);slot.player.seek(playStart);pool.hold(src.key,playStart,{play:true,fixed:true});
}
function validPreparedClip(entry,src){
 if(S.mode!=='live'||!src.clip)return true;
 const clip=S.liveClips.find(c=>c.id===src.clipId)||(src.clip.association&&src.clip.association!=='provider-game'?{...src.clip,gameId:undefined}:src.clip),games=S.live.games.map(g=>({...g,scores:S.live.scores.get(g.id)||g.scores||[]}));
 return liveClipCandidates(entry,[clip],games,{used:S.usedClips,failed:S.failedClips}).length===1;
}
function updateHighlight(now){
 const h=S.highlight;if(!h||h.done)return;
 if(!h.playing){
  // The replay player runs from its start while hidden; show it as soon as footage is moving inside the clip.
  const p=pool.get(h.src.key)?.player,end=highlightEnd(h,p),remaining=end-h.playStart;
  const ready=h.src.data||p&&p.progressing&&p.target===null&&p.currentTime>=h.playStart-4&&p.currentTime<=end-Math.min(1,remaining/2);
  if(ready){
   if(!validPreparedClip(h.item,h.src)){failHighlight('the score or clip changed while loading');return;}
   // Native clips already buffered their opening. Rewind the hidden startup
   // frames before revealing them, so even a two-second clip starts at its start.
   if(p?.kind==='native'&&p.currentTime>h.playStart+.1)p.seek(h.playStart);
   if(h.src.data)pool.hide();else if(h.inset)showInset(h.src.key);else pool.show(h.src.key);if(h.previousKey&&h.previousKey!==h.src.key)pool.close(h.previousKey);h.previousKey=null;h.playing=true;h.until=now+(end-Math.max(h.playStart,p?.currentTime||0))*1000;h.watched=watchedHighlight(h);h.lastMedia=p?.currentTime;h.checkedAt=now;h.progressAt=now;S.program={kind:'highlight',id:h.item.id};render();
  }
  else if(now-h.since>15000)failHighlight('the replay did not start');
  return;
 }
 if(h.src.data){if(now>=h.until)finishHighlight();return;}
 const p=pool.get(h.src.key)?.player;trackHighlight(h,p,now);
 const end=highlightEnd(h,p);
 if(p&&p.currentTime>=end-.25)finishHighlight();
 else if(now-h.progressAt>15000)failHighlight('the replay stopped responding');
}
function showInset(key){
 const slot=pool.get(key);if(!slot)return;const el=slot.player.element;
 el.classList.add('on','inset');el.setAttribute('aria-hidden','false');slot.player.muted=true;if(S.playing)slot.player.play();
}
function highlightEnd(h,p){
 const actual=Number.isFinite(p?.duration)&&p.duration>0?p.duration:Infinity;
 if(h.src.fullClip)return Number.isFinite(actual)?actual:h.endedAt||((h.src.duration>0)?h.src.start+h.src.duration:Infinity);
 return Math.min(h.src.start+h.src.duration,actual);
}
function watchedHighlight(h){return (h.src.ranges||[]).reduce((sum,[a,b])=>sum+b-a,0);}
// Count advancing footage, not buffering, advertisements, or a seek to the end.
function trackHighlight(h,p,now){
 const elapsed=Math.max(0,(now-(h.checkedAt??now))/1000),delta=p?p.currentTime-h.lastMedia:0;
 if((pool.visible===h.src.key||h.inset)&&!p?.inAd&&p?.target===null&&delta>0&&delta<=Math.max(2,elapsed*1.5)){
  const from=Math.max(h.src.start,p.currentTime-Math.min(delta,elapsed+1)),to=Math.min(highlightEnd(h,p),p.currentTime);
  if(to>from){const ranges=[...(h.src.ranges||[]),[from,to]].sort((a,b)=>a[0]-b[0]),merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}h.src.ranges=merged;}
  h.watched=watchedHighlight(h);h.progressAt=now;
 }
 h.lastMedia=p?.currentTime;h.checkedAt=now;
}
const item=h=>coverage.log.find(x=>x.id===h.item.id)||h.item;
// The highlight stays on screen until the game we return to is ready.
function finishHighlight({ended=false}={}){
 const h=S.highlight;if(!h||h.done)return;
 if(!h.playing){failHighlight('the replay did not start');return;}
 const p=pool.get(h.src.key)?.player;if(ended&&!Number.isFinite(highlightEnd(h,p)))h.endedAt=p?.currentTime;if(!h.src.data)trackHighlight(h,p,performance.now());
 const watched=h.src.data?(performance.now()-(h.until-h.src.duration*1000))/(h.src.duration*1000):(h.watched||0)/Math.max(.001,highlightEnd(h,p)-h.src.start);
 const reachedEnd=h.src.data?performance.now()>=h.until:p&&p.currentTime>=highlightEnd(h,p)-.25;
 if(watched<.85||!reachedEnd){
  if(!h.src.data&&(ended||reachedEnd)){h.src.incompleteEnds=(h.src.incompleteEnds||0)+1;if(h.src.incompleteEnds>=2){failHighlight('the clip ended without showing the full replay');return;}}
  let resume=h.src.start||0;for(const [a,b] of h.src.ranges||[]){if(a>resume+1)break;resume=Math.max(resume,b);}h.src.resumeAt=Math.max(h.src.start||0,resume-2);
  h.requeued=true;item(h).status='queued';coverage.requeue(h.item);
 }else item(h).status='replayed';
 if(item(h).status==='replayed'&&h.src.clipId)S.usedClips.set(h.src.clipId,h.item.id);
 h.done=true;p?.pause();
 if(!h.returnTo){closeHighlight();S.program={kind:'standby'};}
}
// A failed live clip tries another publication; archived clips fall back to the recording.
function failHighlight(reason){
 const h=S.highlight;if(!h)return;S.highlight=null;
 for(const key of [h.src.key,h.previousKey])if(key)pool.close(key);
 if(S.program.kind==='highlight')S.program={kind:'standby'};
 const it=item(h),game=archiveGame(h.item.gameId);
 if(S.mode==='live'&&canRetryReplay(it,S.at)){
  if(h.src.clipId)S.failedClips.set(h.src.clipId,Date.now()+REPLAY_WAIT_SECONDS*1000);
  it.status='waiting';it.unavailable=false;S.sources.set(it.id,{status:'none',reason,retryAt:0});render();return;
 }
 if(S.mode==='replay'&&!saved.dataOnly&&h.src.label!=='Broadcast replay'&&game?.embed&&!pastRecordingEnd(game.id,h.item.at)){
  S.sources.set(h.item.id,{status:'ready',key:'hl:'+h.item.id+':b',source:{url:game.embed,type:'provider/ok',duration:knownLength(game)},...broadcastReplayWindow(h.item,game,syncFor(game)),label:'Broadcast replay',title:h.item.score.text});
  it.status='queued';coverage.requeue(h.item);
 }else{it.status='missed';it.unavailable=true;S.sources.set(h.item.id,{status:'none',reason});toast('Couldn’t play that score’s replay. Back to your games.','warn');}
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
 if(S.chat&&S.mode==='live'){const who=[...new Set(entry.credits.map(c=>c.player.name))].join(' & ');S.chat.event(`${d.label} · ${who} · ${d.line}`,`${entry.gameId}:${entry.id}`);}
 entry.status=entry.seen?'seen':entry.queued?'queued':'skipped';
 if(!saved.highlights&&!entry.seen){entry.queued=false;entry.status='skipped';}
 const who=[...new Set(entry.credits.map(c=>c.player.name))].join(' & ');
 toast(`<b>${esc(d.label.toUpperCase())}</b> ${esc(who)} · ${esc(d.line)}${entry.queued&&saved.highlights?'<em>Replay coming up</em>':''}`,entry.score.kind==='TD'?'td':'fg',true);
}
function toast(html,tone='',isHTML=false){
 const t=$('toast');if(isHTML)t.innerHTML=html;else t.textContent=html;t.className='toast '+tone;t.hidden=false;
 clearTimeout(S.toastTimer);S.toastTimer=setTimeout(()=>t.hidden=true,6500);
}

// ---------- transport ----------
function day(){return S.archive?.sessions[S.day];}
// What the first screen's main button plays: a game on now with a stream, else the latest replay.
const liveWithStream=()=>S.live.games.filter(g=>g.state==='in'&&streamURLs(g).length).sort((a,b)=>(a.yardsToGoal??100)-(b.yardsToGoal??100))[0]||null;
function watchFirst(){const pick=liveWithStream();if(pick){S.startOnLanding=false;selectGame(pick.id);return;}S.startOnLanding=true;void setMode('replay');}
function setPlaying(playing,message){
 S.autoAttempted=true;
 if(playing&&S.mode==='live'&&!hasLineup()&&!S.pinned){watchFirst();return;}
 if(playing)S.wontPlay=null;
 if(playing&&S.mode==='replay'&&!S.archive)return;
 if(S.playing!==playing){
  if(playing&&S.pausedAt!=null){const paused=performance.now()-S.pausedAt;for(const state of [S.highlight,S.pending,S.stall,S.selection])if(state){for(const key of ['since','until','checkedAt','progressAt','shownAt'])if(Number.isFinite(state[key]))state[key]+=paused;}for(const [id,until] of S.breaks)S.breaks.set(id,until+paused);for(const key of S.ads){const slot=pool.get(key);if(slot?.adAt!=null)slot.adAt+=paused;}S.pausedAt=null;}
  else if(!playing)S.pausedAt=performance.now();
 }
 S.playing=playing;pool.setRunning(playing,{resumeVisible:!heldHighlight(pool.visible)});clock.set(false,performance.now());
 // A hidden player in an ad is left to finish it: warm() skips a blocked game, so nothing else would ever start it again.
 if(playing)for(const key of S.ads)pool.get(key)?.player.resume?.();
 // A loading highlight is hidden, so setRunning() does not resume it.
 if(playing&&S.highlight&&!S.highlight.playing&&!S.highlight.done&&!S.highlight.src.data)pool.get(S.highlight.src.key)?.player.play();
 // An inset replay is not the visible slot: resume it by hand.
 if(playing&&S.highlight?.inset&&S.highlight.playing&&!S.highlight.done)pool.get(S.highlight.src.key)?.player.play();
 if(playing&&!S.started){S.started=true;if(S.mode==='replay')chooseWeek();pool.setMuted(saved.muted);if($('streamsDetails').open)$('streamsDetails').close();}
 if(message)toast(message);render();
}
function seekTo(at){
 const d=day();if(!d)return;at=Math.max(d.start,Math.min(d.end,at));
 clock.seek(at,performance.now());S.at=at;S.lastAt=null;S.breaks.clear();resetBreaks();
 S.sources.clear();coverage.skipTo(S.archive.sample(at,d.gameIds),at);director.reset();
 if(S.highlight){S.highlight.done=true;closeHighlight();}
 S.pending=null;S.seekHold=true;S.games=S.archive.sample(at,d.gameIds);
 if(S.program.kind==='game'&&gameState(S.program.id)?.state!=='in'){pool.destroy();S.program={kind:S.started?'standby':'idle'};S.pinned=null;S.selection=null;}
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
function skipBreak(){
 const id=currentGameId();if(!id||S.highlight&&!S.highlight.done)return;
 const blocked=excluded();blocked.add(id);
 const other=S.games.some(g=>g.id!==id&&g.state==='in'&&g.phase!=='break'&&!blocked.has(g.id)&&backupGames().has(g.id));
 if(!other){
  toast('No other game is ready. This game comes back in 90 seconds.','warn');
 }
 S.breaks.set(id,performance.now()+90000);S.pinned=null;S.selection=null;S.pending=null;director.reset();
 suppressBreak(id);if(other)toast('Switching games. This game can return in 90 seconds.');
 if(S.playing)step(performance.now());render();
}
function setDay(index,{seek=true}={}){
 if(!S.archive?.sessions[index])return;
 if(S.highlight){S.highlight.done=true;closeHighlight();}pool.destroy();S.pending=null;S.pinned=null;S.selection=null;S.program={kind:S.started?'standby':'idle'};S.stall=null;S.sources.clear();S.cooldown.clear();S.recordingEnds.clear();S.holdBudget=STANDBY_HOLD;S.breaks.clear();resetBreaks();coverage.reset();
 S.wontPlay=null;S.day=index;const d=day();clock.end=d.end;$('daySelect').value=String(index);
 if(seek){const first=firstAction(d);seekTo(first??d.start);}
 S.range=null;syncTimeline();
}
function firstAction(d){for(let at=d.start;at<d.end;at+=30)if(rank(S.archive.sample(at,d.gameIds),roster(),{includeDefense:false}).length)return at-20;return null;}

// ---------- rendering ----------
const ROLE={offense:'',kicker:'K',defense:'D/ST'};
function render(){
 if(!S.archive&&S.mode==='replay')return;
 document.body.dataset.mode=S.mode;
 renderScreen();renderRail();renderTransport();renderSetup();renderStreams();renderScoreboard();
}
function renderScreen(){
 const p=S.program,loading=S.highlight,h=loading?.playing?loading:loading?.previousView&&pool.visible===loading.previousKey?loading.previousView:null;let game=p.kind==='game'?gameState(p.id):h?gameState(h.item.gameId):null;
 const recoverBreak=S.mode==='live'&&S.games.find(g=>g.state==='in'&&sourceFor(g.id)&&!S.ads.has(g.id)&&(S.breaks.has(g.id)||S.detectedBreaks.has(g.id)));
 const onScreen=h?.inset&&h.playing?gameState(h.returnTo):null;if(onScreen)game=onScreen;
 const data=p.kind==='game'&&picture(p.id)==='data'||h?.src.data&&h.playing;
 $('fieldView').hidden=!data||!game;
 $('layers').hidden=!!data;
 if(data&&game)renderField(game,h?.playing?h.item:null);
 // overlay states
 let overlay=null;
 if(!S.started)overlay={eyebrow:S.mode==='replay'?`WEEK ${S.archive?.data.week||7} REPLAY · ${day()?.label.toUpperCase()||''}`:'LIVE',title:sampleTeam()?'A sample team. One channel.':'Your starters. One channel.',text:sampleTeam()?`We picked a sample team of ${roster().length} so you can see how the channel works. It follows their teams, favors drives near the end zone, and replays missed scores when footage is available. Connect ESPN or add your own players under Fantasy team.`:`Following ${saved.teamName}: ${starterCount(roster().length)}. The channel follows your starters’ teams, favors drives near the end zone, and replays missed scores when footage is available.`,button:S.mode==='replay'?'Watch replay':!hasLineup()?'Choose your players':'Start watching',action:S.mode==='live'&&!hasLineup()?'lineup':'start'};
 const landing=landingWeek();
 if(landing)overlay={eyebrow:'REPLAY',title:landing>0?`Getting Week ${landing} ready…`:'Finding the latest week…',text:'Loading the games and their replay videos. The first time can take a moment.',spinner:true,button:S.weekChosen?null:`Watch Week ${S.archive?.data.week||7} instead`,action:'start'};
 if(!S.started&&S.mode==='live'){overlay.title='Your game day starts here.';const pick=!hasLineup()?liveWithStream():null,down=S.live.error&&!S.live.games.length;if(!hasLineup()){overlay.button=pick?`Watch ${pick.name}`:'Watch the latest replay';overlay.action=pick?'first':'replay';overlay.ghost=['Connect ESPN','connect'];}else overlay.ghost=['Try a replay first','replay'];overlay.text=down?'We can’t reach the game schedule right now and will keep trying. You can watch a replay while you wait.':!hasLineup()?'One channel that follows your fantasy players, cutting to whichever game has them closest to the end zone. Try it on a recent week with a sample team, connect ESPN, or pick a game from the row above.':`Following ${saved.teamName} · ${starterCount(roster().length)}. Finding game streams automatically. Your saved links take priority.`;}
 else if(S.started&&loading&&!loading.playing&&!pool.visible&&p.kind!=='game')overlay={eyebrow:'REPLAY',title:'Getting your replay ready…',text:'Your games will continue if this clip cannot play.',spinner:true};
 else if(S.started&&(p.kind==='idle'||S.pending&&!pool.visible||p.kind==='game'&&!pool.visible&&picture(p.id)==='video'))overlay={eyebrow:'TUNING IN',title:S.pending?`Opening ${esc(gameState(S.pending.id)?.name||'the game')}…`:'Finding your players…',text:'The picture appears as soon as the game is playing.',spinner:true};
 else if(p.kind==='standby'&&!loading&&S.games.some(g=>g.state==='in'&&(S.ads.has(g.id)||S.breaks.has(g.id)||S.detectedBreaks.has(g.id))))overlay={eyebrow:'COMMERCIAL BREAK',title:'Commercial Break in Progress',text:recoverBreak?'Waiting for play to resume. If the game is already back, show the stream below.':S.mode==='live'?'Add another game stream to give the channel somewhere to go during breaks. We will retry your games automatically.':'Finding the next available play. You can also move to the next drive.',button:recoverBreak?'Show stream':S.mode==='live'?'Add game streams':'Next drive',action:recoverBreak?'show-stream':S.mode==='live'?'streams':'next'};
 else if(p.kind==='standby'&&!loading&&!S.playing&&S.games.some(g=>g.state==='in'&&hasRoster(g,roster())))overlay={eyebrow:S.mode==='replay'?`WEEK ${S.archive?.data.week||7} REPLAY`:'LIVE',title:'Ready when you are.',text:'The channel is paused. Press Watch to pick up your games.',button:'Watch',action:'start'};
 else if(p.kind==='standby'&&!loading&&S.games.some(g=>g.state==='in'&&hasRoster(g,roster())))overlay={eyebrow:'VIDEO UNAVAILABLE',title:'Your game video is unavailable.',text:S.mode==='live'?'Try another link under Streams at the top, or retry this one.':'Retry the video, or choose the game tracker in Settings.',button:'Retry video',action:'retry'};
 else if(p.kind==='standby'&&!loading){const next=nextKickoff();overlay={eyebrow:'STANDBY',title:sampleTeam()?'None of the sample team is playing right now.':'None of your starters are playing right now.',text:next?`Next up: ${next.name} at ${timeLabel(next.start)} ET.`:S.mode==='live'?(S.live.error?'Game updates are unavailable. We will keep trying.':S.games.length?'Your games will appear here when they start.':'Getting the latest NFL schedule…'):sampleTeam()?'They’re done for this slate.':'Your starters are done for this slate.',button:S.mode==='replay'&&next?'Skip to kickoff':null,action:'kickoff'};}
 else if(p.kind==='game'&&(S.ads.has(p.id)||S.breaks.has(p.id)))overlay={eyebrow:'COMMERCIAL',title:'Skipping the break.',text:'Opening another available game. Your lineup will return when its games are ready.',spinner:true,dim:true};
 // A replay frame that never showed footage, and a game not started yet: both wait on the viewer, ahead of anything else the channel would say.
 if(S.wontPlay&&S.mode==='replay')overlay={eyebrow:'REPLAY',title:'This replay won’t play inside the page on this device.',text:`${S.wontPlay.name} opens in a new tab, from the first minute. The channel and scores stay here.`,link:[S.wontPlay.url,'Watch replay ↗'],button:'Try again',action:'start'};
 else if(S.started&&S.mode==='live'&&p.kind==='game'&&game?.state==='pre'&&!S.earlyOpen.has(p.id))overlay={eyebrow:'NOT STARTED YET',title:kickoffOf(game),text:`${game.name} hasn’t started yet. We’ll put it on when it does, or you can open the stream now.`,button:'Open the stream early',action:'early',ghost:['Back to the channel','channel']};
 if(S.started&&S.dimmed&&pool.visible===S.dimmed.id&&p.kind==='game'&&p.id===S.dimmed.id)overlay={eyebrow:'FANTASY STREAM',title:'Commercial Break in Progress',text:'Your stream stays connected. The picture returns when play resumes. If the game is already back, show the stream below.',button:'Show stream',action:'show-stream'};
 const o=$('overlay');o.classList.toggle('commercial-cover',!!(S.dimmed&&pool.visible===S.dimmed.id));o.hidden=!overlay;o.classList.toggle('dim',!!overlay?.dim);
 $('ovGhost').hidden=!overlay?.ghost;if(overlay?.ghost){setText('ovGhost',overlay.ghost[0]);$('ovGhost').dataset.action=overlay.ghost[1];}
 $('ovOpen').hidden=!overlay?.link;$('ovOpen').href=overlay?.link?.[0]||'#';if(overlay?.link)setText('ovOpen',overlay.link[1]);
 const wantsSound=!overlay&&!saved.muted&&!!pool.current?.audioLocked&&S.playing;if(wantsSound&&touch())$('soundHint').innerHTML='<b>Tap the video</b> once for sound';
 $('unmute').hidden=!wantsSound||pool.current?.kind==='provider';
 $('soundHint').hidden=!wantsSound||pool.current?.kind!=='provider';
 if(overlay){setText('ovEyebrow',overlay.eyebrow);put('ovTitle',overlay.title);setText('ovText',overlay.text);$('ovButton').hidden=!overlay.button;$('ovButton').className=(overlay.link?'ghost':'primary')+' big';setText('ovButton',overlay.button||'');$('ovButton').dataset.action=overlay.action||'start';o.classList.toggle('busy',!!overlay.spinner);setText('ovHint',S.unmuteHint?'If the video waits, press play inside it.':'');}
 // switching chip
 const pend=S.pending&&gameState(S.pending.id),switching=!!(pend&&pool.visible&&pool.visible!==S.pending.id&&performance.now()-S.pending.since>700);
 // A recorded video that has not shown its first frame yet gets a word, so a dark stage never looks broken.
 const starting=!overlay&&!switching&&S.playing&&p.kind==='game'&&pool.visible===p.id&&pool.current?.kind==='provider'&&(pool.current.played===false||!(pool.current.advances>0));
 $('switching').hidden=!switching&&!starting;
 if(switching)setText('switching',`Up next · ${pend.name}`);else if(starting)setText('switching',S.unmuteHint?'Loading the replay video · if it waits, press play inside it':'Loading the replay video…');
 // Touch devices get the outside link immediately; desktop gets it after twenty seconds without footage.
 const waitingId=S.pending?.id||(p.kind==='game'?p.id:null),waitingSlot=waitingId&&pool.get(waitingId);
 const stuck=S.mode==='replay'&&S.playing&&!S.wontPlay&&waitingSlot?.player.kind==='provider'&&!waitingSlot.player.progressing&&pool.now()-(S.pending?.since??waitingSlot.openedAt)>LOAD_LIMIT;
 const phoneReplay=touch()&&S.mode==='replay'&&S.playing&&!S.wontPlay&&waitingSlot?.player.kind==='provider'&&!waitingSlot.player.played?archiveGame(waitingId):null;
 $('frameHelp').hidden=!(stuck||phoneReplay?.embed);if(stuck||phoneReplay?.embed)$('frameOpen').href=phoneReplay?.embed||archiveGame(waitingId)?.embed||'#';
 // a website player stays up through the break, dimmed, with a word on why
 const dimmed=!overlay&&S.dimmed&&pool.visible===S.dimmed.id&&p.kind==='game'&&p.id===S.dimmed.id;
 $('screen').classList.toggle('dimmed',!!dimmed);$('breakChip').hidden=!dimmed;
 if(dimmed){const kind=S.dimmed.kind;$('breakChip').innerHTML=`<b>${esc(kind==='halftime'?'Halftime':kind==='quarter'?'End of quarter':kind==='score'?'After the score':kind==='kickoff'||kind==='punt'?'Change of possession':kind==='timeout'?'Timeout':'Break')}</b>${esc(S.decision?.reason==='Break · staying with this stream'?'Staying with this stream · the channel cuts away the moment one of your starters is on the field':'Staying with this stream')}`;}
 const insetOn=!!(h?.inset&&h.playing);$('insetTag').hidden=!insetOn;
 if(insetOn){const d=describeScore(h.item.score,gameState(h.item.gameId)||game);$('insetTag').innerHTML=`<b>REPLAY</b>${esc(d.label)} · ${esc(d.text)}`;}
 // bug + lower third
 const showInfo=!!game&&!overlay;$('bug').hidden=!showInfo;$('lower').hidden=!showInfo;
 $('screen').classList.toggle('replaying',!!h?.playing&&!h.inset);
 if(!showInfo)return;
 const replaying=h?.playing&&!h.inset,live=S.mode==='live'&&!replaying;
 setText('bugTag',replaying?'REPLAY':!live?'WEEK '+(S.archive?.data.week||7):game.state==='in'?(game.phase==='break'?'BREAK':'LIVE'):game.state==='pre'?'LATER':'FINAL');$('bugTag').dataset.state=live?game.state:'';
 put('bugGame',live&&game.state==='pre'?`${esc(game.teams[0].abbr)} <span class="at">@</span> ${esc(game.teams[1].abbr)}`:`${esc(game.teams[0].abbr)} <b>${esc(tallyOf(game,0))}</b> · ${esc(game.teams[1].abbr)} <b>${esc(tallyOf(game,1))}</b>`);
 setText('bugClock',live&&game.state==='pre'?kickoffOf(game):game.detail||'');
 if(h?.playing&&!h.inset){
  const d=describeScore(h.item.score,game);
  setText('lowerKicker',`${h.src.label} · ${d.label}`);$('lowerKicker').className='lower-kicker replay';
  setText('lowerMain',d.text);setText('lowerMeta',h.done?(loading?.previousKey?'Next replay is loading…':'Returning to your games…'):`Score replay · ${d.line}`);return;
 }
 if(live&&game.state!=='in'){setText('lowerKicker',game.state==='pre'?kickoffOf(game).toUpperCase():'FINAL');$('lowerKicker').className='lower-kicker muted';setText('lowerMain',rosterIn(game).map(x=>x.name).join(' · ')||game.name);setText('lowerMeta','');return;}
 const entry=S.decision?.entry?.game?.id===game.id?S.decision.entry:rank([game],roster(),{includeDefense:saved.includeDefense})[0];
 const players=entry?.players||[];
 const roles=new Set(players.map(x=>x.role));
 const kicker=game.phase==='break'?['BREAK','break']:roles.has('offense')?(game.yardsToGoal<=20?['RED ZONE','red']:['TEAM ON OFFENSE','go']):roles.has('kicker')?['FIELD-GOAL RANGE','amber']:roles.has('defense')?['YOUR DEFENSE','blue']:S.pinned?['YOUR CHOICE','muted']:['BETWEEN SERIES','muted'];
 setText('lowerKicker',kicker[0]);$('lowerKicker').className='lower-kicker '+kicker[1];
 $('lowerMain').innerHTML=players.length?players.map(x=>`<span>${esc(x.player.name)}<i>${esc(ROLE[x.role]||x.player.position)}</i></span>`).join(''):esc(rosterIn(game).map(p=>p.name).join(' · ')||game.name);
 const off=game.possession>=0?game.teams[game.possession].abbr:'';
 setText('lowerMeta',game.phase==='break'?'Break in the action':[off&&`${off} ball`,game.downDistance,Number.isFinite(game.yardsToGoal)&&!game.special?`${game.yardsToGoal} yds to the end zone`:''].filter(Boolean).join(' · '));
}
function renderField(game,replayItem){
 const off=game.possession>=0?game.possession:null,ytg=Number.isFinite(game.yardsToGoal)?game.yardsToGoal:50;
 const pre=S.mode==='live'&&game.state==='pre',away=S.mode==='live'?outsideURL(game):null;$('fvOpen').hidden=!away;$('fvOpen').href=away||'#';
 $('fvScore').innerHTML=game.teams.map((t,i)=>`<div class="${off===i?'has-ball':''}"><b>${esc(t.abbr)}</b><strong>${pre?'–':esc(tallyOf(game,i))}</strong></div>`).join('<span>'+esc(pre?kickoffOf(game):game.detail||'')+'</span>');
 $('fvLeft').textContent=game.teams[0].abbr;$('fvRight').textContent=game.teams[1].abbr;
 // Away attacks the right end zone in this diagram.
 const x=off===null?50:off===0?100-ytg:ytg;$('fvBall').style.left=x+'%';$('fvLine').style.left=x+'%';$('fvBall').hidden=off===null;
 $('fvPlay').textContent=replayItem?replayItem.score.text:game.lastPlay||game.name;
 $('fvNote').textContent=replayItem?'Scoring play replay':away?'Game tracker · the video opens in a new tab':S.mode==='live'&&!sourceFor(game.id)?'Game tracker · add a link under Streams for video':game.phase==='break'?'Break in the action':`${game.downDistance||''}${off!==null&&!game.special?` · ${ytg} yards to go`:''}`;
}
function rosterIn(game){const teams=new Set(game.teams.map(t=>t.abbr));return roster().filter(p=>teams.has(alias(p.team)));}
function nextKickoff(){
 if(S.mode!=='replay')return null;
 const teams=rosterTeams(roster());
 return day().gameIds.map(archiveGame).filter(g=>g.start>S.at&&g.teams.some(t=>teams.has(alias(t.abbreviation)))).sort((a,b)=>a.start-b.start)[0]||null;
}
// The game card says where its picture comes from, and is the shortcut to change it.
function streamChip(g){
 if(S.mode==='replay')return !S.archive?.data.calibrated&&!hasVideo(g.id)?`<button type="button" class="g-stream none" data-add-stream="${esc(g.id)}" title="Add a link to this replay">No replay yet</button>`:'';
 if(g.state==='post')return '';
 const key=gameKey(g),urls=streamURLs(g);
 if(!urls.length)return `<button type="button" class="g-stream none" data-add-stream="${esc(g.id)}" title="Add a stream for ${esc(g.name)}">+ Stream</button>`;
 const mode=saved.streamModes[key]||'custom',own=mode==='custom'&&saved.streams[key]&&urls[0]===streamFinder.playable(saved.streams[key]);
 const away=!!outsideURL(g),source=away?'Stream':own?'Your link':['NTV','StreamCorner'].includes(mode)?mode:(streamFinder.options(g)[0]?.provider||'Stream');
 return `<button type="button" class="g-stream" data-add-stream="${esc(g.id)}" title="${away?'Opens in a new tab. Change':'Change'} the stream for ${esc(g.name)}">${esc(source)}</button>`;
}
const RAIL=[['matchup','matchupTab','matchupPanel'],['scores','scoresTab','scoresPanel'],['chat','chatTab','chatPanel']];
function showPanel(tab){
 if(tab==='chat'&&$('chatTab').hidden)tab='matchup';
 for(const [name,tabId,panelId] of RAIL){const on=name===tab;$(tabId).setAttribute('aria-selected',String(on));$(tabId).tabIndex=on?0:-1;$(panelId).hidden=!on;}
 if(tab==='chat')S.chat?.markRead();
}
for(const [name,tabId] of RAIL){$(tabId).onclick=()=>showPanel(name);$(tabId).onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const visible=RAIL.filter(r=>!$(r[1]).hidden),i=visible.findIndex(r=>r[1]===tabId),next=e.key==='Home'?0:e.key==='End'?visible.length-1:(i+(e.key==='ArrowRight'?1:-1)+visible.length)%visible.length;showPanel(visible[next][0]);$(visible[next][1]).focus?.();};}
// The strip scrolls sideways: arrows, and the mouse wheel over it.
// Quick clicks chain from the last target while its scroll is moving. The target expires by time, since not every browser has scrollend.
const stripStep=dir=>{const list=$('games');if(!list.scrollTo)return;const max=Math.max(0,list.scrollWidth-list.clientWidth),moving=S.stripTarget!==null&&Date.now()-S.stripStartedAt<700&&Math.abs(S.stripTarget-list.scrollLeft)>8,from=moving?Math.min(max,S.stripTarget):list.scrollLeft;S.stripStartedAt=Date.now();S.stripTarget=Math.max(0,Math.min(max,from+dir*Math.max(240,(list.clientWidth||800)*.8)));list.scrollTo({left:S.stripTarget,behavior:'smooth'});};
for(const name of ['scrollend','pointerdown','touchstart'])$('games').addEventListener?.(name,()=>{S.stripTarget=null;},{passive:true});
mountGameTiles({$,storage:localStorage});
mountMatchupRows({$});
$('stripPrev').onclick=()=>stripStep(-1);$('stripNext').onclick=()=>stripStep(1);$('games').addEventListener?.('scroll',()=>stripEnds($('games'),$('stripPrev'),$('stripNext')),{passive:true});$('games').addEventListener?.('keydown',e=>stripKeys(e,$('games')));
$('games').addEventListener?.('wheel',e=>{S.stripTarget=null;const list=$('games');if(Math.abs(e.deltaY)<=Math.abs(e.deltaX)||list.scrollWidth<=list.clientWidth)return;e.preventDefault();list.scrollLeft+=e.deltaY;},{passive:false});
function renderRail(){
 const teams=rosterTeams(roster()),blocked=excluded(),current=currentGameId(),ours=g=>g.teams.some(t=>teams.has(t.abbr));
 const listed=S.games.filter(g=>S.mode==='live'||ours(g)||sourceFor(g.id)||g.id===current);
 const mine=listed;
 const ranked=rank(S.games,roster(),{excluded:blocked,includeDefense:saved.includeDefense});
 const nickname=t=>{const words=String(t.name||'').trim().split(/\s+/);return words.length>1?words.at(-1):t.name||t.abbr;};
 // Tiles stay in kickoff order and never trade places: the gold ring and the tags say what matters now.
 const items=mine.sort((a,b)=>(a.start||Date.parse(a.date)/1000||0)-(b.start||Date.parse(b.date)/1000||0)||String(a.id).localeCompare(String(b.id))).map(g=>{
  const e=ranked.find(x=>x.game.id===g.id),watching=S.program.kind==='game'&&g.id===S.program.id&&!S.highlight?.playing,off=g.possession>=0?g.teams[g.possession].abbr:'';
  const tag=watching&&S.dimmed?.id!==g.id?['ON AIR','onair']:S.pending?.id===g.id?['UP NEXT','next']:blocked.has(g.id)?[S.ads.has(g.id)||S.breaks.has(g.id)||S.detectedBreaks.has(g.id)?'BREAK':'UNAVAILABLE','muted']:g.state==='post'?['FINAL','final']:g.state==='pre'?['LATER','later']:g.phase==='break'?['BREAK','muted']:e?.tier===2?(g.yardsToGoal<=20?['RED ZONE','red']:e.players.some(x=>x.role==='kicker')&&e.players.every(x=>x.role==='kicker')?['FG RANGE','amber']:['DRIVING','go']):e?.tier===1?['DEFENSE','blue']:['LIVE','live'];
  const ytg=Number.isFinite(g.yardsToGoal)&&off&&!g.special&&g.state==='in'?g.yardsToGoal:null;
  const names=rosterIn(g).map(p=>`<span class="${e?.players.some(x=>x.player===p)?'on':''}">${esc(p.name)}</span>`).join('');
  const earlyLink=S.mode==='live'&&g.state==='pre'&&inlineURLs(g).length>0,away=S.mode==='live'&&g.state==='in'&&!!outsideURL(g),revealable=S.mode==='live'&&g.state==='in'&&!!sourceFor(g.id)&&!S.ads.has(g.id)&&(S.detectedBreaks.has(g.id)||S.breaks.has(g.id)),selectable=revealable||!blocked.has(g.id)&&(g.state==='in'||sourceFor(g.id)||earlyLink),action=revealable?'Show this stream · override this break':blocked.has(g.id)?(S.ads.has(g.id)||S.breaks.has(g.id)||S.detectedBreaks.has(g.id)?'Waiting for the break to finish':S.mode==='live'?'Try another stream for this game':'Video unavailable · trying again shortly'):S.pinned===g.id?'Your choice until a break · select again for automatic':S.mode==='replay'&&g.state!=='in'?'Watch replay from kickoff':earlyLink&&!sourceFor(g.id)?'Starts later. See when':away?'Follow on the game tracker · the video opens in a new tab':selectable?(picture(g.id)==='data'?'Open the game tracker · add a stream for video':'Watch this game · stay until a break'):g.state==='post'?'Game finished':'Add a stream to watch';
  const known=g.scoreKnown!==false&&g.state!=='pre',diff=known?Number(g.score?.[0])-Number(g.score?.[1]):0;
  const rows=g.teams.map((t,i)=>{const logo=teamLogo(t),lead=g.state==='post'&&known&&(i===0?diff>0:diff<0),trail=g.state==='post'&&known&&(i===0?diff<0:diff>0),ball=g.state==='in'&&g.possession===i;
   return `<span class="g-team${lead?' lead':''}${trail?' trail':''}"><span class="team-logo">${logo?`<img src="${esc(logo)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="team-code">${esc(t.abbr)}</span><span class="team-name">${esc(nickname(t))}</span>${ball?`<i class="g-ball" title="${esc(t.abbr)} ball"></i>`:''}<b class="team-score">${known?esc(g.score?.[i]??'—'):'—'}</b></span>`;}).join('');
  const quiet=g.state==='pre'?kickoffOf(g):g.phase==='break'?'Break in the action':'';
  const drive=ytg!==null?`<span class="g-drive"><span>${esc(off)} ball · ${esc(g.downDistance||'On offense')}</span><span>${ytg} yds</span></span><span class="g-bar" aria-hidden="true"><i style="width:${100-ytg}%"></i></span>`:`<span class="g-drive quiet"><span>${esc(quiet)}</span></span><span class="g-bar idle" aria-hidden="true"></span>`;
  const cta=revealable?'Show stream':watching?'On screen':S.pending?.id===g.id?'Opening…':blocked.has(g.id)?tag[0]==='BREAK'?'On break':'Unavailable':g.state==='post'&&!selectable?'Final':earlyLink&&!sourceFor(g.id)?'Later':away?'Opens in new tab':selectable?(picture(g.id)==='data'?'Tracker':'Watch'):'Later';
  return `<li class="tile${watching?' watching':''}${S.pinned===g.id?' pinned':''}${selectable?'':' off'}${ours(g)?' mine':''}" style="--away:${teamColor(g.teams[0])};--home:${teamColor(g.teams[1])}"><button class="game" data-game="${esc(g.id)}" aria-pressed="${S.pinned===g.id}" aria-label="${esc(g.teams.map((t,i)=>(t.name||t.abbr)+(known?' '+(g.score?.[i]??''):'')).join(' at ')+', '+tag[0].toLowerCase()+'. '+action)}" ${selectable?'':'disabled'}><span class="g-status"><span class="tag ${tag[1]}">${tag[0]}</span><span class="g-when">${g.state==='pre'&&S.mode==='live'?'':esc(g.detail||'')}</span></span><span class="g-matchup">${rows}</span>${drive}</button><div class="g-footer"><span class="g-names">${names||'<span>Other game</span>'}</span>${streamChip(g)}<span class="g-cta">${cta}</span></div></li>`;
 }).join('');
 const past=S.mode==='live'&&S.pastWeeks.length?pastRun(items?S.weeks.label||S.weeks.current:0):'',landing=landingWeek();
 put('games',landing?`<li class="empty">${landing>0?`Getting Week ${landing} ready…`:'Finding the latest week…'}</li>`:items||(S.mode==='live'&&!S.live.games.length?(S.live.error?'<li class="empty">Game updates are unavailable. Trying again shortly.</li>':'<li class="empty">Loading the NFL schedule…</li>'):'<li class="empty">None of your starters play in this window.</li>'),landing?'':past.html,past.kept);
 if(past&&items&&!S.stripScrolled){const first=$('games').querySelector?.('.tile:not(.past)');if(first?.offsetLeft!==undefined){$('games').scrollLeft=Math.max(0,first.offsetLeft-48);S.stripScrolled=true;S.stripTarget=null;}}
 const liveNow=S.mode==='live'?S.live.games.filter(g=>g.state==='in').length:0,known=S.mode==='live'&&S.live.fetched&&!S.live.error;$('liveDot').classList.toggle('on',liveNow>0);$('liveMode').title=liveNow?`${liveNow} NFL game${liveNow===1?'':'s'} live now`:known?'No NFL games live right now':S.mode==='replay'?'Switch to live games':S.live.error?'Live game updates unavailable':'Checking for live NFL games…';
 setText('gamesNote',S.pinned?'Your choice':`${listed.filter(g=>g.state==='in').length} in play`);
 // Keep the game on screen in view in the strip.
 const onAir=S.program.kind==='game'?S.program.id:null;
 if(onAir&&onAir!==S.stripShown&&!$('games').matches?.(':hover')){S.stripShown=onAir;for(const b of $('games').querySelectorAll?.('button')||[])if(b.dataset?.game===onAir)b.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});}
 // scores
 put('scores',coverage.log.map(x=>{
 const st=x.status==='replayed'?['Replayed','go']:x.status==='waiting'?['Waiting for replay','amber']:x.status==='queued'||coverage.queue.some(q=>q.id===x.id)?[S.highlight?.item.id===x.id?(S.highlight.playing?'Playing':'Loading replay'):'Replay up next','amber']:x.unavailable||x.status==='missed'?['No footage yet','muted']:x.seen?[S.mode==='live'?'Seen live':'Watched','live']:x.credits.every(c=>c.role==='pat')?['Extra point','muted']:x.status==='skipped'&&saved.highlights?['Skipped','muted']:['Replay off','muted'];
  const page=highlightPage(x.watchUrl),gamePage=!page&&S.mode==='live'&&['waiting','missed'].includes(x.status)&&/^\d+$/.test(x.gameId)?'https://www.espn.com/nfl/game/_/gameId/'+x.gameId:null;
  const destination=page||gamePage,publisher=page&&new URL(page).hostname.endsWith('nfl.com')?'NFL.com':'ESPN',label=page?'Watch on '+publisher:'Open game on ESPN';
  const link=destination?`<a class="score-link" href="${esc(destination)}" target="_blank" rel="noopener noreferrer" aria-label="${label} (opens a new tab)">${label} ↗</a>`:'';
  return `<li><span class="s-kind ${x.score.kind}">${esc(x.score.kind)}</span><span class="s-text">${esc(x.score.text.replace(/\s*\([^)]*\)\s*$/,''))}<small>${esc(x.gameName)}</small>${link}</span><span class="tag ${st[1]}">${st[0]}</span></li>`;
 }).join('')||'<li class="empty">Scores by your starters show up here.</li>');
 setText('scoresNote',coverage.log.length?`${coverage.log.filter(x=>x.seen||x.status==='replayed').length}/${coverage.log.length} watched`:'');
 setText('scoreCount',coverage.log.length?String(coverage.log.length):'');
}
// Writing text, even the same text, makes the browser lay the page out again.
const setText=(id,value)=>{const el=$(id);if(el.textContent!==String(value??''))el.textContent=value;};
const markup=new Map();
// Building a date format is the slow part of showing a date, and the strip and matchup show dozens per render.
const KICKOFF_TIME=new Intl.DateTimeFormat([],{weekday:'short',hour:'numeric',minute:'2-digit'}),PAST_DAY=new Intl.DateTimeFormat([],{weekday:'short',month:'short',day:'numeric'}),CLOCK_TIME=new Intl.DateTimeFormat([],{hour:'numeric',minute:'2-digit'});
// head is markup that rarely changes (the past weeks in the strip): when only what follows it changes, its first `kept` items stay in the page untouched.
function put(id,html,head='',kept=0){const last=markup.get(id);if(last?.html===html&&last.head===head)return;const key=id==='games'?'game':id==='scoreboardGames'?'scoreLink':null,focused=key?document.activeElement?.dataset?.[key]:null,list=$(id);markup.set(id,{html,head});if(head&&last?.head===head&&list.insertAdjacentHTML&&list.children.length>=kept){while(list.children.length>kept)list.lastElementChild.remove();list.insertAdjacentHTML('beforeend',html);}else list.innerHTML=head+html;if(focused)for(const item of $(id).querySelectorAll(key==='game'?'button':'a'))if(item.dataset[key]===focused)item.focus({preventScroll:true});if(id==='games'){stripTabStop(list);stripEnds(list,$('stripPrev'),$('stripNext'));}}
function currentGameId(){return S.program.kind==='game'?S.program.id:S.highlight?.returnTo||null;}
function renderTransport(){
 const replay=S.mode==='replay';
 $('replayControls').hidden=!replay;$('speedControl').hidden=!replay||!saved.dataOnly;
 setText('channelMode',replay?(landingWeek()<0?'Replay':`Week ${landingWeek()>0?landingWeek():S.archive?.data.week||7} replay`):'Live games');
 const full=!!(document.fullscreenElement||document.webkitFullscreenElement||document.querySelector('.stage').classList.contains('theater'));
 setText('fullButton',full?'Exit full screen':'Full screen');$('fullButton').setAttribute('aria-label',full?'Exit full screen':'Full screen');
 for(const id of ['backButton','forwardButton','nextButton','daySelect','scope'])$(id).hidden=!replay;
 $('timeline').parentElement.hidden=!replay;$('speed').hidden=!replay||!saved.dataOnly;
 $('playButton').dataset.playing=String(S.playing);setText('playButton',S.playing?'Pause':'Play');$('playButton').setAttribute('aria-label',S.playing?'Pause':'Play');
 setText('muteButton',saved.muted?'Turn sound on':'Mute sound');$('muteButton').setAttribute('aria-label',$('muteButton').textContent);$('muteButton').hidden=pool.current?.kind==='embed'&&!pool.current.control?.active;
 if(replay){syncTimeline();if(!S.scrubbing)$('timeline').value=String(Math.round(S.at));}
 setText('timeLabel',replay?timeLabel(S.at)+' ET':new Date((S.at-saved.delay)*1000).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));
 setText('autoChip',S.pinned?'Your choice':'Automatic');$('autoChip').classList.toggle('on',!S.pinned);
 const d=S.decision;
 setText('reason',S.started&&!S.playing?'Paused':!S.started?(S.mode==='live'&&!hasLineup()?'Pick a game above, or choose your team with Fantasy team.':`${shownTeam(saved.teamName)} · ${starterCount(roster().length)}`):S.pending?`Opening ${gameState(S.pending.id)?.name||'video'}…`:S.highlight?.playing?(sampleTeam()?'Replaying a score':'Replaying a score you missed'):d?.reason||'');
 setText('pictureNote',S.mode==='live'?(pool.current?.reconnecting?pool.current.recoveryMessage:S.live.error?'Game updates unavailable · retrying':`${saved.delay} sec stream delay`):saved.dataOnly?'Game tracker':'Recorded game video');
 const current=gameState(currentGameId()),inGame=S.program.kind==='game'&&!S.highlight;
 $('pinCurrent').hidden=!inGame||!current;
 setText('pinCurrent',S.pinned?'Back to automatic':'Stay on this game');$('pinCurrent').setAttribute('aria-pressed',String(!!S.pinned));
 $('skipBreak').hidden=!inGame||picture(currentGameId())!=='video'||current?.state!=='in';$('skipBreak').disabled=!S.playing;
 $('reloadStream').hidden=!inGame||S.mode!=='live'||typeof pool.current?.reload!=='function';$('reloadStream').disabled=!S.playing;
 const sources=current?inlineURLs(current):[],alternate=sources.find(url=>url!==pool.get(current?.id)?.url);
 $('nextStream').hidden=!inGame||S.mode!=='live'||!alternate;$('nextStream').disabled=!S.playing;
 const embed=inGame&&S.mode==='live'&&pool.current?.kind==='embed',original=embed?(pool.get(current?.id)?.source?.page||pool.get(current?.id)?.url):null;
 $('openStream').hidden=!original;$('openStream').href=original||'#';$('embedHelp').hidden=!embed;
 const health=S.playing&&inGame&&pool.current?.reconnecting?pool.current.recoveryMessage:'';
 $('streamHealth').hidden=!health;if($('streamHealth').textContent!==health)setText('streamHealth',health);
 $('leaveHighlight').hidden=!S.highlight||S.highlight.done;$('leaveHighlight').disabled=!S.playing;
 $('undoBreak').hidden=!S.breaks.size;
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
function overlayAction(action){
 if(action==='show-stream'){revealBreak(currentGameId()||S.games.find(g=>g.state==='in'&&sourceFor(g.id)&&!S.ads.has(g.id)&&(S.breaks.has(g.id)||S.detectedBreaks.has(g.id)))?.id);return;}
 if(action==='undo-break'){S.breaks.clear();director.reset();if(S.playing)step(performance.now());render();return;}
 if(action==='connect'){openESPNConnection();return;}
 if(action==='streams'){openStreams();return;}
 if(action==='next'){nextDrive();return;}
 if(action==='retry'){S.cooldown.clear();S.holdBudget=STANDBY_HOLD;director.reset();setPlaying(true);return;}
 if(action==='lineup'){openLineup();return;}
 if(action==='kickoff'){const next=nextKickoff();if(next)seekTo(next.start-30);return;}
 if(action==='first'){watchFirst();return;}
 if(action==='replay'){S.startOnLanding=true;return setMode('replay');}
 if(action==='early'){S.earlyOpen.add(S.program.id);S.program={kind:'standby'};director.reset();step(performance.now());render();return;}
 if(action==='channel'){S.pinned=null;S.selection=null;director.reset();S.program={kind:'standby'};step(performance.now());render();return;}
 saved.muted=false;persist();setPlaying(true);
}
$('ovButton').onclick=()=>overlayAction($('ovButton').dataset.action);
$('ovGhost').onclick=()=>overlayAction($('ovGhost').dataset.action);
$('playButton').onclick=()=>setPlaying(!S.playing);
$('timingButton').onclick=()=>openSettings('sync');
$('skipBreak').onclick=skipBreak;
$('reloadStream').onclick=()=>{
 if(S.mode!=='live'||S.program.kind!=='game'||S.highlight||!S.playing||typeof pool.current?.reload!=='function')return;
 if(pool.current.reload()){S.stall=null;S.lastAt=null;toast('Reloading this stream. If it stays blank, try another link under Streams.');render();}
 S.deadStreams.clear();
};
$('nextStream').onclick=()=>{if(!S.highlight)rotateStream(currentGameId(),true);};
$('undoBreak').onclick=()=>{S.breaks.clear();director.reset();if(S.playing)step(performance.now());render();toast('The skipped game is available again.');};
$('pinCurrent').onclick=()=>{if(S.pinned){S.pinned=null;S.selection=null;director.reset();render();}else selectGame(currentGameId());};
$('leaveHighlight').onclick=()=>{if(!S.highlight)return;skipHighlight();S.pending=null;director.reset();if(S.playing)step(performance.now());render();};
function openStreams(gameId=null){
 const dialog=$('streamsDetails');if(!dialog.open)dialog.showModal?.();
 $('streamsError').textContent='';$('streamsStatus').textContent='';
 if(!dialog.open)dialog.open=true;
 renderStreams();renderSourceOptions();
 if(!gameId)return;
 const row=document.querySelector(`[data-stream-game="${String(gameId).replace(/["\\]/g,'')}"]`);
 if(!row?.scrollIntoView)return;
 if(row.closest?.('#backupStreams'))$('backupStreams').open=true;
 row.scrollIntoView({block:'center'});row.classList?.add('focus');setTimeout(()=>row.classList?.remove('focus'),1600);
 row.querySelector('[data-source-mode][aria-pressed="true"],button,input')?.focus?.();
}
$('streamsButton').onclick=()=>{S.streamOpener=null;openStreams();};
// The strip may have been rebuilt while the dialog was open: focus goes back to the chip that opened it, or failing that the Streams button.
$('streamsDetails').addEventListener?.('close',()=>{const chip=S.streamOpener&&[...$('games').querySelectorAll('[data-add-stream]')].find(b=>b.dataset.addStream===S.streamOpener);S.streamOpener=null;(chip||$('streamsButton')).focus?.();});
$('headerScore').onclick=e=>{e.preventDefault();showPanel('matchup');$('scoreboardTitle').focus();};
$('closeStreams').onclick=()=>$('streamsDetails').close();
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
$('daySelect').onchange=e=>{chooseWeek();setDay(Number(e.target.value));};
// The Options popover closes on a click anywhere else.
document.addEventListener('pointerdown',e=>{const d=document.querySelector('.replay-settings');if(d?.open&&!e.target?.closest?.('.replay-settings'))d.open=false;});
$('weekSelect').onchange=e=>{const week=Number(String(e.target.value).replace(/^w/,''));if(week){chooseWeek();void selectWeek(week);}};
$('speed').onchange=e=>{clock.tick(performance.now());clock.rate=Number(e.target.value);};
$('muteButton').onclick=()=>{saved.muted=!saved.muted;S.audioAsked=0;pool.setMuted(saved.muted);persist();render();};
$('unmute').onclick=()=>{S.audioAsked=(S.audioAsked||0)+1;pool.retryAudio();render();};
pool.host.addEventListener('pointerdown',()=>{S.audioAsked=0;},true);
// A click inside the provider's frame moves focus into it; that click is the one gesture its player accepts for sound.
// The click also pauses its player: ask it to play, and send the unmute only once footage is moving again
// (an unmute during that transition wedges it, and the watchdog would mute it back).
window.addEventListener('blur',()=>{setTimeout(()=>{
 const el=document.activeElement,p=pool.current;
 if(p&&p.kind==='embed'&&el===p.element){p.noteInteraction?.();S.unmuteHint=false;render();return;}
 if(!p||p.kind!=='provider'||el!==p.element)return;
 S.audioAsked=0;p.audioLocked=false;p.clickedAt=performance.now();
 const unmute=()=>{if(!saved.muted&&pool.current===p&&!p.audioLocked)p.muted=false;render();};
 if(!S.playing){unmute();return;}
 p.resume?.();
 const started=performance.now(),mark=p.lastTime;
 const wait=setInterval(()=>{if(p.lastTime>mark+.2||performance.now()-started>4000||pool.current!==p){clearInterval(wait);unmute();}},150);
 render();
},0);});
$('games').onclick=e=>{
 const add=e.target.closest('[data-add-stream]');if(add?.dataset?.addStream){e.preventDefault?.();S.streamOpener=add.dataset.addStream;openStreams(add.dataset.addStream);return;}
 const b=e.target.closest('[data-game]');if(!b)return;const id=b.dataset.game,g=gameState(id);
 if(b.dataset.pastWeek){void openPastReplay(Number(b.dataset.pastWeek),id);return;}
 if(!g||b.disabled)return;
 if(S.mode==='live'&&g.state==='in'&&sourceFor(id)&&(S.detectedBreaks.has(id)||S.breaks.has(id))){revealBreak(id);return;}
 if(excluded().has(id))return;
 S.startOnLanding=false;
 if(S.pinned===id){S.pinned=null;S.selection=null;director.reset();render();return;}
 selectGame(id);$('watchTitle').scrollIntoView?.({block:'start'});$('watchTitle').focus({preventScroll:true});
};
// Fullscreen where the browser allows it (Safari needs the webkit names); otherwise a fixed theater layout.
// A request that is refused, unsupported, or simply never answered (embedded browsers) falls back to the theater within a moment.
$('fullButton').onclick=async()=>{
 const stage=document.querySelector('.stage'),d=document;
 const active=d.fullscreenElement||d.webkitFullscreenElement;
 const request=++S.fullscreenRequest;
 if(active||stage.classList.contains('theater')||S.fullscreenWanted){
  S.fullscreenWanted=false;stage.classList.remove('theater');
  try{if(active)await (d.exitFullscreen?d.exitFullscreen():d.webkitExitFullscreen());}catch{}
  render();return;
 }
 S.fullscreenWanted=true;stage.classList.add('theater');render();let timer;
 try{
  const req=stage.requestFullscreen||stage.webkitRequestFullscreen;
  if(!req)throw new Error('no fullscreen');
  const slow=new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('no answer')),800);});
  const entered=Promise.resolve(req.call(stage,{navigationUI:'hide'})).then(async()=>{
   // A delayed browser response must not undo an explicit exit or Escape.
   if(request!==S.fullscreenRequest&&!S.fullscreenWanted&&(d.fullscreenElement||d.webkitFullscreenElement)===stage){
    await (d.exitFullscreen?d.exitFullscreen():d.webkitExitFullscreen());
   }
  });
  await Promise.race([entered,slow]);
  if(!(d.fullscreenElement||d.webkitFullscreenElement))throw new Error('not granted');
 }catch{if(request===S.fullscreenRequest&&S.fullscreenWanted){stage.classList.add('theater');render();}}
 finally{clearTimeout(timer);}
};
for(const ev of ['fullscreenchange','webkitfullscreenchange'])document.addEventListener(ev,()=>{
 const full=!!(document.fullscreenElement||document.webkitFullscreenElement),stage=document.querySelector('.stage');
 document.body.classList.toggle('is-full',full);
 if(full)stage.classList.remove('theater');
 else if(!stage.classList.contains('theater'))S.fullscreenWanted=false;
 render();
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'){S.fullscreenWanted=false;S.fullscreenRequest++;const stage=document.querySelector('.stage');if(stage.classList.contains('theater')){stage.classList.remove('theater');render();$('fullButton').focus();}return;}
 if(e.metaKey||e.ctrlKey||e.altKey||e.defaultPrevented||e.target.closest('input,textarea,select,dialog,[contenteditable]'))return;
 if(e.target.closest('button,a,summary,#gamesPanel,#scores')&&(e.key===' '||e.key==='Enter'))return;
 if(e.key===' '||e.key==='k'){e.preventDefault();if(S.started||S.archive)setPlaying(!S.playing);}
 else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&S.mode==='replay'){e.preventDefault();seekTo(S.at+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?60:10));}
 else if(e.key==='m'){if(!$('muteButton').hidden)$('muteButton').click();}else if(e.key==='f')$('fullButton').click();
 else if(e.key==='n'&&S.mode==='replay')$('nextButton').click();
});
// A replay pauses while the page is hidden and picks up again when it comes back.
document.addEventListener('visibilitychange',()=>{
 if(document.hidden){S.resumeOnShow=S.mode==='replay'&&S.playing;if(S.resumeOnShow)setPlaying(false);}
 else{void refreshStreamLinks();if(S.resumeOnShow){S.resumeOnShow=false;setPlaying(true);}}
});

// ---------- modes ----------
async function setMode(mode){
 if(mode==='live')S.startOnLanding=false;
 if(mode===S.mode)return;
 S.wontPlay=null;
 if(mode==='replay'&&!S.archive){$('replayMode').disabled=true;const ok=await loadReplayArchive();$('replayMode').disabled=false;if(!ok||!S.archive){toast('The replay is unavailable. Live games still work.','warn');return;}if(S.mode==='replay')return;}
 if(S.mode==='replay'){S.replayAt=S.at;S.replayLineup=lineupSnapshot();}
 else S.liveLineup=lineupSnapshot();
 $('games').scrollLeft=0;S.stripScrolled=false;S.stripTarget=null;
 setPlaying(false);pool.destroy();S.mode=mode;S.program={kind:'idle'};S.pending=null;S.pinned=null;S.selection=null;S.highlight=null;S.started=false;S.autoAttempted=false;
 S.streamChoices.clear();S.streamRotations.clear();
 if(mode==='live'&&S.liveLineup){saved={...saved,...S.liveLineup};S.liveLineup=null;}
 else if(mode==='replay'&&S.replayLineup)saved={...saved,...S.replayLineup};
 S.resumeOnShow=false;S.pausedAt=null;S.unmuteHint=false;S.audioAsked=0;S.driftSince=null;S.usedClips=new Map();S.failedClips=new Map();franchiseOptions();
 streamFinder.cancel();S.leagueRequest=(S.leagueRequest||0)+1;$('importLeague').disabled=false;S.live.generation++;S.live.feed=new LiveFeed();S.live.games=[];S.live.fetched=0;S.live.error='';S.live.scores.clear();S.live.summaryAt={};S.liveClips=[];S.games=[];S.coverageStart=null;S.decision=null;S.seekHold=false;S.stall=null;coverage.reset();director.reset();S.sources.clear();S.cooldown.clear();S.recordingEnds.clear();S.holdBudget=STANDBY_HOLD;S.ads.clear();S.breaks.clear();resetBreaks();S.lastAt=null;
 $('replayMode').setAttribute('aria-pressed',String(mode==='replay'));$('liveMode').setAttribute('aria-pressed',String(mode==='live'));
 if(mode==='live'){S.at=Date.now()/1000;pollLive(S.live.generation);pollLiveClips(S.live.generation);}
 else{seekTo(S.replayAt??firstAction(day())??clock.at);}
 if(mode==='replay')void landOnLatest();
 // A landing still under way decides the week, and the lineup is asked for that week once it settles.
 S.weeks.lineupDue=false;if(mode==='replay'&&S.weeks.landing)S.weeks.lineupDue=true;else if(saved.leagueId)importLeague({refresh:true,quiet:true});
 if(mode==='replay')void refreshWeekVideos(S.archive?.data.week);
 render();
}
$('replayMode').onclick=()=>setMode('replay');$('liveMode').onclick=()=>setMode('live');
async function espn(path,signal){const r=await fetch(ESPN+path,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal});if(!r.ok)throw new Error('ESPN unavailable');return r.json();}
async function pollLive(generation){
 if(generation!==S.live.generation||S.mode!=='live')return;
 let summaries;
 try{
  const board=espn('scoreboard',AbortSignal.timeout(8000));S.live.board={at:Date.now(),board};
  const raw=await board,games=liveGames(raw);
  if(generation!==S.live.generation||S.mode!=='live')return;
  // A tab left open across a week change: the strip and the week list move on with it.
  if(S.weeks.listed&&!S.weeks.listing&&(Number(raw.week?.number)>S.weeks.current||latestCompletedWeek(raw)>S.weeks.latest)){S.weeks.listed=false;void loadWeekList();}
  for(const g of games)g.scores=S.live.scores.get(g.id)||[];
  S.live.error='';S.live.fetched=Date.now();S.live.feed.push(games,Date.now()/1000);S.live.games=S.live.feed.latest;if(S.discoveryReady)void refreshStreamLinks();if($('streamsStatus').textContent==='Refreshing the schedule…')$('streamsStatus').textContent='Schedule updated.';
  const teams=rosterTeams(roster());
  const pending=S.live.summaryPending,capacity=Math.max(0,4-[...pending.values()].filter(request=>request.generation===generation).length);
  summaries=Promise.allSettled(games.filter(g=>g.state!=='pre'&&g.teams.some(t=>teams.has(t.abbr))&&pending.get(g.id)?.generation!==generation&&Date.now()-(S.live.summaryAt?.[g.id]||0)>(g.state==='post'?600000:25000)).sort((a,b)=>(S.live.summaryAt?.[a.id]||0)-(S.live.summaryAt?.[b.id]||0)).slice(0,capacity).map(async g=>{
   // Space failed attempts too, so one unavailable group cannot starve later games.
   S.live.summaryAt={...S.live.summaryAt,[g.id]:Date.now()};
   const request={generation};pending.set(g.id,request);
   try{
   const summary=await espn('summary?event='+g.id,AbortSignal.timeout(10000));
   if(generation!==S.live.generation||S.mode!=='live')return;
   const previous=S.live.scores.get(g.id)||[],scores=liveScores(summary,g,previous);g.scores=scores;S.live.scores.set(g.id,scores);
   const onAir=S.highlight?.playing&&!S.highlight.done?S.highlight.item.id:null;
   for(const id of coverage.reconcile(g,previous,roster(),{playing:onAir})){
    if(id===onAir&&coverage.log.some(e=>e.id===id))continue;   // same play, corrected wording: the replay on screen finishes untouched
    // Retire in-flight resolvers as well as ready clips. Their identity guards
    // prevent a late result from restoring an overturned or reassigned score.
    S.sources.delete(id);
    const h=S.highlight;
    if(h?.item.id===id){h.done=true;closeHighlight();}
    else if(h?.previousView?.item.id===id){if(h.previousKey)pool.close(h.previousKey);h.previousKey=null;h.previousView=null;if(S.program.kind==='highlight'&&S.program.id===id)S.program={kind:'standby'};}
   }
   const clips=normalizeHighlights(summary,g).filter(c=>c.kind==='clip').map(c=>({...c,inlinePlayable:playable(c),athletes:[],short:!/(?:highlights|best plays|every|all .*plays)/i.test(c.title)}));
   S.liveClips=[...new Map([...S.liveClips,...clips].map(c=>[c.id,c])).values()].slice(-240);
   }finally{if(pending.get(g.id)===request)pending.delete(g.id);}
  }));
 }catch{if(generation===S.live.generation){S.live.error='unavailable';$('streamsStatus').textContent='Could not refresh games. Retrying automatically.';}}
 // Commercial decisions use the scoreboard. Slow highlight/score summaries
 // must not add their ten-second timeout to its next polling interval.
 finally{if(generation===S.live.generation&&S.mode==='live')setTimeout(()=>pollLive(generation),S.live.games.some(g=>g.state==='in'||nearStart(g))?5000:30000);}
 await summaries;
 if(generation!==S.live.generation||S.mode!=='live')return;
 retryMissedReplays();
 if(!S.live.games.length&&S.mode==='live')render();
}
async function pollLiveClips(generation){
 if(generation!==S.live.generation)return;
 try{const r=await fetch('/api/nfl-highlights',{cache:'no-store',signal:AbortSignal.timeout(30000)});if(r.ok){const data=await r.json();if(generation!==S.live.generation||S.mode!=='live')return;S.liveClips=[...new Map([...S.liveClips,...(Array.isArray(data.clips)?data.clips:[])].map(c=>[c.id,c])).values()].slice(-240);retryMissedReplays();}}catch{}
 finally{if(generation===S.live.generation)setTimeout(()=>pollLiveClips(generation),S.live.games.some(g=>g.state==='in')?60000:300000);}
}

// ---------- league and roster ----------
function franchiseOptions(){
 const teams=saved.league?.teams||[];
 put('scoreTeam',`<option value="">${teams.length?'Choose your team…':'Connect ESPN to choose a team'}</option>`+teams.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''));
 $('scoreTeam').value=saved.teamId||'';$('scoreTeam').disabled=!teams.length;$('lineupDialog').dataset.connected=String(!!saved.leagueId);
}
// Someone trying a replay with the sample team who connects ESPN or adds players meant it for good: Live must not put the sample back.
function keepSampleChoice(){if(S.mode==='replay'&&S.liveLineup&&!S.liveLineup.lineupReady&&S.liveLineup.teamName==='Sample lineup')S.liveLineup=null;}
function useRoster(players,{teamName,teamId=''}){
 const next=parseRoster(formatRoster(players));
 const changed=!hasLineup()||formatRoster(next)!==formatRoster(saved.roster);
 if(S.mode==='live'&&(changed||saved.teamId!==teamId||saved.teamName!==teamName))S.replayLineup=null;
 keepSampleChoice();
 saved={...saved,roster:next,teamName,teamId,lineupReady:true};persist();
 // A refresh of the same starters must not interrupt the channel or erase coverage.
 if(!changed){franchiseOptions();render();return;}
 if(S.highlight){S.highlight.done=true;closeHighlight();}pool.destroy();S.program={kind:S.started?'standby':'idle'};S.pending=null;S.lastAt=null;S.ads.clear();S.cooldown.clear();S.decision=null;S.stall=null;
 coverage.reset();S.usedClips=new Map();S.failedClips=new Map();S.coverageStart=S.mode==='live'?S.at-saved.delay:S.at;coverage.skipTo(S.games,S.coverageStart);director.reset();if(!S.selection?.hold){S.pinned=null;S.selection=null;}S.sources.clear();   // the lineup answer for a past tile's week can land just after the tile
 franchiseOptions();S.range=null;S.streamSignature=null;render();
}
function chooseLeagueTeam(id){
 const fresh=S.mode==='live'&&fantasyFeed.data?.leagueId===saved.leagueId?fantasyFeed.data:null;
 const league=fresh||saved.league,team=league?.teams.find(t=>t.id===id);if(!team)return;
 try{
  S.leagueRequest=(S.leagueRequest||0)+1;$('importLeague').disabled=false;S.matchupId=null;
  if(fresh)saved.league=fresh;
  useRoster(team.players,{teamName:team.name,teamId:team.id});fillRosterRows(team.players);
  $('lineupStatus').textContent=`Following ${team.name}. Your lineup is saved.`;toast(`${team.name} · ${starterCount(team.players.length)}`);
 }catch(error){$('lineupError').textContent=error.message;toast(error.message,'warn');}
}
$('scoreTeam').onchange=e=>chooseLeagueTeam(e.target.value);
$('matchupSelect').onchange=e=>{S.matchupId=e.target.value;renderScoreboard();};
async function importLeague({refresh=false,quiet=false}={}){
 const request=S.leagueRequest=(S.leagueRequest||0)+1,mode=S.mode;
 const typed=(refresh?saved.leagueId:$('leagueId').value).trim(),leagueId=/leagueId=(\d{1,12})/i.exec(typed)?.[1]||typed;
 if(!/^\d{1,12}$/.test(leagueId)){$('leagueStatus').textContent='Paste your ESPN league link, or type its ID number.';return;}
 // Cookies typed for this import travel with the request; they are kept only once ESPN accepts them.
 const entered=refresh?null:{swid:$('espnSwid').value.trim(),s2:$('espnS2').value.trim()},using=entered??saved.espn;
 const cookies=using?.swid||using?.s2?{swid:using.swid,s2:using.s2}:{};
 $('importLeague').disabled=true;$('leagueStatus').textContent='Getting your league from ESPN…';
 try{
  S.importing=request;   // this answer carries every score, so the fantasy feed need not ask as well
  const r=await fetch('/api/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId,...(S.mode==='replay'?{week:S.archive.data.week,season:S.archive.data.season}:{}),...cookies}),signal:AbortSignal.timeout(15000)});
  if(!r.headers.get('Content-Type')?.includes('application/json'))throw new Error('The roster service is unavailable. Try again, or add your players below.');
  const data=await r.json();if(request!==S.leagueRequest||mode!==S.mode)return;if(!r.ok){if(data.code==='LEAGUE_PRIVATE'){$('leagueImport').open=true;$('privateLeague').open=true;$('espnSwid').focus?.();}throw new Error(data.error||'Could not import this league.');}
  if(!refresh)keepSampleChoice();
  if(entered){saved.espn=entered;persist();}
  // Team IDs are local to a league: team "1" in a new league is not necessarily yours.
  const previousTeamId=saved.leagueId===leagueId?saved.teamId:'';
  if(S.mode==='live'&&saved.leagueId!==data.leagueId)S.replayLineup=null;
  data.fetchedAt=Date.now();saved.league=data;saved.leagueId=data.leagueId;$('forgetESPN').hidden=false;chatRoom();
  const team=data.teams.find(t=>t.id===previousTeamId)||data.teams.find(t=>t.id===data.ownedTeamId);
  if(!team)saved.teamId='';
  if(!team){persist();franchiseOptions();render();$('leagueStatus').textContent=`${data.name}: choose your team below.`;$('scoreTeam').focus();return;}
  useRoster(team.players,{teamName:team.name,teamId:team.id});
  $('leagueStatus').textContent=`${data.name}: following ${team.name}.`;
  fillRosterRows(team.players);$('lineupStatus').textContent='';$('leagueImport').open=false;$('playersState').textContent=starterCount(team.players.length)+' · your ESPN lineup isn’t changed';
  if(!quiet)toast(`${team.name} · ${starterCount(team.players.length)}`);
 }catch(error){if(request!==S.leagueRequest||mode!==S.mode)return;$('leagueStatus').textContent=error.name==='TimeoutError'?'ESPN took too long. Try again.':error.message;}
 finally{if(request===S.leagueRequest)$('importLeague').disabled=false;if(S.importing===request)S.importing=0;}
}
$('importLeague').onclick=()=>importLeague();
$('leagueId').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();importLeague();}};
$('saveRoster').onclick=()=>{try{
 // Nothing entered and nothing saved yet: Done just closes.
 const typed=[...$('rosterRows').querySelectorAll('input,select')];if(!hasLineup()&&typed.every(f=>!String(f.value||'').trim())){if($('leagueId').value.trim()!==(saved.leagueId||'')){importLeague();return;}$('lineupError').textContent='';closeLineupEditor();return;}
 for(const field of $('rosterRows').querySelectorAll('input,select'))field.removeAttribute('aria-invalid');
 const players=parseRoster([...$('rosterRows').querySelectorAll('.roster-entry')].map(row=>[...row.querySelectorAll('input,select')].map(x=>x.value.trim()).join(', ')).join('\n'));
 const imported=saved.teamId&&saved.league?.teams.find(t=>t.id===saved.teamId);
 S.leagueRequest=(S.leagueRequest||0)+1;$('importLeague').disabled=false;
 useRoster(players,imported?{teamName:imported.name,teamId:imported.id}:{teamName:'My lineup'});$('lineupError').textContent='';closeLineupEditor();toast('Your lineup is saved. Finding game streams…');
}catch(error){$('lineupError').textContent=error.message;const row=$('rosterRows').children[(error.line||1)-1],field=row?.querySelectorAll('input,select')[error.field||0];if(field){field.setAttribute('aria-invalid','true');field.focus();}}};
function fillRosterRows(players){$('rosterRows').replaceChildren();for(const player of players)addPlayerRow(player);}
function addPlayerRow(player={name:'',team:'',position:''}){
 const row=document.createElement('div');row.className='roster-entry';
 row.innerHTML=`<label><span>Player name</span><input value="${esc(player.name)}" placeholder="Player name" maxlength="60"></label><label><span>NFL team</span><select><option value="">Team</option>${TEAMS.map(t=>`<option ${t===player.team?'selected':''}>${t}</option>`).join('')}</select></label><label><span>Position</span><select><option value="">Pos</option>${POSITIONS.map(t=>`<option ${t===player.position?'selected':''}>${t}</option>`).join('')}</select></label><button type="button" class="remove-player" aria-label="Remove ${esc(player.name||'player')}" title="Remove">×</button>`;
 row.querySelector('button').onclick=()=>{row.remove();$('addPlayer').focus();};$('rosterRows').append(row);return row;
}
$('addPlayer').onclick=()=>{if($('rosterRows').children.length>=20){$('lineupError').textContent='Use up to 20 starters.';return;}addPlayerRow().querySelector('input').focus();};
function openLineup(){
 $('lineupTitle').textContent=S.mode==='replay'?'Fantasy team · Replay':'Fantasy team';
 $('leagueId').value=saved.leagueId||'';$('espnSwid').value=saved.espn?.swid||'';$('espnS2').value=saved.espn?.s2||'';
 const populated=S.mode==='replay'||hasLineup();
 fillRosterRows(populated?roster():[{}]);
 $('lineupError').textContent='';$('lineupStatus').textContent=sampleTeam()?'This is a sample team. Connect ESPN or add your own players, and they’ll carry over to Live.':S.mode==='replay'?'Players you change here apply to replays only, not your live team.':'';
 $('leagueImport').open=!saved.leagueId||fantasyFeed.needsConnection;$('privateLeague').open=fantasyFeed.needsConnection||!!(saved.espn?.swid||saved.espn?.s2);$('forgetESPN').hidden=!(saved.leagueId||saved.espn?.swid||saved.espn?.s2);$('playersState').textContent=sampleTeam()?'A sample team · your ESPN lineup is never changed':populated?starterCount(roster().length)+' · your ESPN lineup is never changed':'Add them by hand, or connect ESPN above';franchiseOptions();$('lineupDialog').showModal();$('lineupButton').setAttribute('aria-expanded','true');
}
function closeLineupEditor(){$('lineupDialog').close();$('lineupButton').setAttribute('aria-expanded','false');}
$('lineupButton').onclick=openLineup;
$('closeLineup').onclick=()=>closeLineupEditor();
function openESPNConnection(){openLineup();$('leagueImport').open=true;if(fantasyFeed.needsConnection)$('privateLeague').open=true;(fantasyFeed.needsConnection?$('espnSwid'):$('leagueId')).focus?.();};
$('addByHand').onclick=()=>{const first=$('rosterRows').querySelector('input');first?.scrollIntoView?.({block:'center'});first?.focus?.();};
// Forget means every league page's copy, the lineups kept for the other mode, nothing still on its way, and no feed left asking ESPN for a league that's gone. The players themselves stay until they're changed.
$('forgetESPN').onclick=()=>{S.leagueRequest=(S.leagueRequest||0)+1;$('importLeague').disabled=false;const blank={espn:{swid:'',s2:''},leagueId:'',teamId:'',league:null};Object.assign(saved,blank);for(const snapshot of [S.liveLineup,S.replayLineup])if(snapshot)Object.assign(snapshot,blank);persist();forgetESPN(localStorage);for(const id of ['leagueId','espnSwid','espnS2'])$(id).value='';$('leagueStatus').textContent='Paste your ESPN league link.';$('forgetESPN').hidden=true;$('privateLeague').open=false;chatRoom();franchiseOptions();render();toast('ESPN is disconnected, and your login is forgotten on this device.');};
$('leagueAction').onclick=()=>{const open=!$('leagueImport').open;$('leagueImport').open=open;if(open)$('leagueId').focus?.();};
$('lineupDialog').addEventListener('close',()=>$('lineupButton').setAttribute('aria-expanded','false'));
$('connectFromBoard').onclick=()=>openESPNConnection();
$('retryFantasy').onclick=()=>{if(fantasyFeed.needsConnection||!saved.leagueId){openESPNConnection();return;}fantasyFeed.next=0;renderScoreboard();};
$('lineupForm').onsubmit=e=>{e.preventDefault();$('saveRoster').click();};
// No public lounge: a connected league selects the open room.
function chatRoom(){if(!S.chat)return;const room=chatRoomFor('nfl',saved.leagueId);if(!room&&!$('chatPanel').hidden)showPanel('matchup');S.chat.setRoom(room,room?`${saved.league?.name||'Your league'} room`:'');}
// ---------- replay weeks: the calibrated Week 7 and the latest completed week from ESPN ----------
function applyReplayLinks(data){for(const g of data.games){if(g.id in saved.replayLinks)g.embed=saved.replayLinks[g.id];if(saved.replayDurations[g.id]&&saved.replayDurationEmbeds[g.id]===g.embed){g.recordingDuration=saved.replayDurations[g.id];g.durationGuessed=false;}}}
// Every completed week of the season is a replay. Week 7 ships calibrated; the
// others are built from ESPN's play-by-play the first time you choose them, and
// their videos come from the replay listing (or a link you paste).
const weekKey=week=>'w'+week;
// The week the stage is waiting on (-1 while the latest week is still being looked up); before playback the viewer sees that, not the week being replaced.
const landingWeek=()=>S.mode==='replay'&&!S.started?S.weeks.landing:0;
const chooseWeek=()=>{S.startOnLanding=false;S.weekChosen=true;S.weeks.landing=0;if(S.weeks.lineupDue)void importWeekLineup();};
function switchArchive(key,{quiet=false,keepPlaying=true}={}){
 const data=S.archives.get(key);if(!data||key===S.archiveKey&&data===S.archive?.data)return;
 if(!data.calibrated)applyReplayLinks(data);
 const resume=keepPlaying&&S.mode==='replay'&&S.started&&S.playing;
 if(S.mode==='replay'&&S.started)setPlaying(false);
 S.archiveKey=key;S.archive=new ReplayArchive(data);S.syncs.clear();S.clips=data.calibrated?S.week7Clips:[];S.replayAt=null;
 $('daySelect').innerHTML=S.archive.sessions.map((s,i)=>`<option value="${i}">${esc(s.label)}</option>`).join('');
 const sunday=Math.max(0,S.archive.sessions.findIndex(s=>s.label.startsWith('Sunday')));
 if(S.mode==='replay')setDay(sunday);else{S.day=sunday;clock.end=day().end;clock.seek(firstAction(day())??day().start,performance.now());$('daySelect').value=String(sunday);}
 if(resume){setPlaying(true);step(performance.now());}
 if(S.mode==='replay')void importWeekLineup();
 S.streamSignature=null;renderWeekOptions();if(!quiet)render();
}
// The lineup follows the week on screen; a replay not started yet opens where the new lineup first plays.
async function importWeekLineup(){
 S.weeks.lineupDue=false;if(S.mode!=='replay'||!saved.leagueId)return;
 const key=S.archiveKey,before=formatRoster(saved.roster);await importLeague({refresh:true,quiet:true});
 if(S.mode==='replay'&&!S.started&&S.archiveKey===key&&formatRoster(saved.roster)!==before){const first=firstAction(day());if(first!==null)seekTo(first);}
}
function renderWeekOptions(){
 const latest=S.weeks.latest,options=[];
 for(let n=Math.max(latest,S.archives.has(weekKey(7))?7:0);n>=1;n--){
  const data=S.archives.get(weekKey(n)),loading=S.weeks.loading===n,failed=S.weeks.failed?.[n];
  options.push([weekKey(n),`Week ${n}${n===latest?' · latest':''}${loading?' · loading…':failed?' · unavailable':''}`]);
 }
 if(!options.length)options.push([S.archiveKey,`Week ${S.archive?.data.week||7}`]);
 put('weekSelect',options.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join(''));$('weekSelect').value=landingWeek()>0?weekKey(landingWeek()):S.archiveKey;$('weekSelect').title=S.weeks.failed?.[S.weeks.loading]||'';
}
// The listing's videos for a week, by the teams in each game's address.
const teamSlug=name=>String(name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function applyWeekVideos(data,videos){
 let changed=0;
 for(const g of data.games){
  if(g.embed&&!S.deadEmbeds.has(g.embed))continue;const away=teamSlug(g.teams[0].name),home=teamSlug(g.teams[1].name);
  const hit=videos.find(v=>v.embed&&v.embed!==g.embed&&(v.away===away&&v.home===home||v.away===home&&v.home===away));
  if(hit){if(g.embed){g.recordingDuration=0;g.durationGuessed=false;}g.embed=hit.embed;g.page=hit.page;changed++;}
 }
 return changed;
}
// A failure or a game not posted yet does not stick: when each week last asked, so coming back to it asks again, at most every few minutes.
function askWeekVideos(week){
 S.weekVideos.set(week,{at:Date.now(),failed:false});
 return fetch('/api/nfl-replays?week='+week,{signal:AbortSignal.timeout(90000)}).then(r=>r.json()).catch(()=>null).then(found=>{const failed=!Array.isArray(found?.games)||!!found.error;S.weekVideos.set(week,{at:Date.now(),failed});return failed?null:found.games;});
}
async function refreshWeekVideos(week){
 const data=S.archives.get(weekKey(week));if(!data||data.calibrated||!data.games.some(g=>!g.embed||S.deadEmbeds.has(g.embed)))return;
 const last=S.weekVideos.get(week);if(last&&Date.now()-last.at<(last.failed?120000:300000))return;
 const videos=await askWeekVideos(week);if(!videos){if(S.mode==='replay'&&S.archive?.data===data)toast(`The replay videos for Week ${week} aren’t answering · following on the game tracker for now.`,'warn');return;}
 applyWeekVideos(data,videos);
 if(S.archive?.data===data&&applyWeekVideos(S.archive,videos)){applyReplayLinks(S.archive);S.syncs.clear();S.streamSignature=null;render();}
}
// One load per week at a time; a second caller (a past tile clicked while the week list is still loading) waits for the same result.
const weekLoads=new Map();
function loadWeekArchive(week){
 const key=weekKey(week),hit=S.archives.get(key);if(hit&&!hit.partial){void refreshWeekVideos(week);return Promise.resolve(hit);}
 if(weekLoads.has(week))return weekLoads.get(week);
 const task=fetchWeekArchive(week).finally(()=>weekLoads.delete(week));weekLoads.set(week,task);return task;
}
async function fetchWeekArchive(week){
 const key=weekKey(week);S.weeks.loading=week;renderWeekOptions();
 try{
  // The week's videos can take seconds on a cold server: asked for up front, so the play-by-play below does not queue behind them. The browser keeps the answer as long as the server says.
  const videos=askWeekVideos(week);
  const season=S.weeks.season,cacheKey=`fantasy-stream-archive-${season}-w${week}`;let data=null;
  try{data=JSON.parse(localStorage.getItem(cacheKey)||'null');}catch{}
  // A copy an earlier release kept short of a game the strip knows about is built again.
  if(!data||data.version!==2||!data.games?.length||S.pastWeeks.find(w=>w.week===week)?.games.length>data.games.length){
   const board=await espn(`scoreboard?dates=${season}&seasontype=2&week=${week}`,AbortSignal.timeout(10000));
   const events=(board.events||[]).filter(e=>e.competitions?.[0]?.status?.type?.completed),entries=[];
   for(let i=0;i<events.length;i+=4)await Promise.all(events.slice(i,i+4).map(async e=>{try{const raw=await espn('summary?event='+encodeURIComponent(e.id),AbortSignal.timeout(12000));const codes=[...(e.competitions?.[0]?.competitors||[])].sort((a,b)=>(a.homeAway==='away'?0:1)-(b.homeAway==='away'?0:1)).map(t=>alias(t.team?.abbreviation||''));entries.push({raw,meta:{id:String(e.id),name:codes.length===2&&codes.every(Boolean)?codes.join(' @ '):e.shortName||e.name,date:e.date}});}catch{}}));
   data=buildArchive(entries,{season,week,title:`Week ${week}`});
   if(!data.games.length)throw new Error('ESPN has no play-by-play for that week yet.');
   // A game whose summary did not answer: this copy serves the view for now, and the next visit builds the week again.
   data.partial=data.games.length<events.length;
   // Only the latest week stays cached: older weeks would eat the storage every page needs for its own settings.
   if(week===S.weeks.latest&&!data.partial)try{for(const k of Object.keys(localStorage))if(/^fantasy-stream-archive-/.test(k)&&k!==cacheKey)localStorage.removeItem(k);localStorage.setItem(cacheKey,JSON.stringify(data));}catch{}
  }
  const found=await videos;if(found)applyWeekVideos(data,found);else if(S.mode==='replay'&&S.weeks.landing===week)toast(`The replay videos for Week ${week} aren’t answering · following on the game tracker for now.`,'warn');
  S.archives.set(key,data);delete S.weeks.failed?.[week];return data;
 }catch(error){const kept=S.archives.get(key)||null;if(!kept)S.weeks.failed={...(S.weeks.failed||{}),[week]:error.message};return kept;}
 finally{if(S.weeks.loading===week)S.weeks.loading=0;renderWeekOptions();}
}
async function selectWeek(week){
 const request=++S.weekRequest;S.weeks.landing=week;render();
 const data=await loadWeekArchive(week);
 if(request!==S.weekRequest)return;   // a later choice stands
 if(S.weeks.landing===week)S.weeks.landing=0;
 if(data)switchArchive(weekKey(week),{quiet:S.mode!=='replay'});else{toast(`Week ${week} isn’t available right now.`,'warn');renderWeekOptions();render();}
 if(S.weeks.lineupDue)void importWeekLineup();
}
// Replay opens on the latest completed week, built when someone comes for it and never for a Live page that may not open
// Replay. A week the viewer chose or started stays: the latest one just joins the list. If it fails, the calibrated Week 7 is the replay.
async function landOnLatest(){
 if(S.weekChosen||S.mode!=='replay')return;
 if(S.weeks.listing){S.weeks.landing=-1;render();return;}   // the week list comes back here when ESPN answers
 const latest=S.weeks.latest,key=weekKey(latest);
 if(!latest||key===S.archiveKey){S.weeks.landing=0;if(S.weeks.lineupDue)void importWeekLineup();renderWeekOptions();render();return;}
 S.weeks.landing=latest;renderWeekOptions();render();
 const data=await loadWeekArchive(latest);
 if(S.weeks.landing===latest)S.weeks.landing=0;
 if(data&&!S.weekChosen)switchArchive(key,{quiet:S.mode!=='replay'});
 else{if(S.weeks.lineupDue)void importWeekLineup();if(!data&&!S.weekChosen&&S.mode==='replay')toast(`Week ${latest} isn’t available right now · showing Week ${S.archive?.data.week||7}.`,'warn');renderWeekOptions();render();}
}
async function loadWeekList(){
 if(S.weeks.listed)return;S.weeks.listed=true;S.weeks.listing=true;
 try{
  // The week and season come from the board the live poll asked for a moment ago, or is still asking for.
  const shared=Date.now()-(S.live.board?.at||0)<60000?await S.live.board.board.catch(()=>null):null;
  const current=shared||await espn('scoreboard',AbortSignal.timeout(10000));const latest=latestCompletedWeek(current),season=Number(current.season?.year)||new Date().getFullYear(),type=Number(current.season?.type)||2,week=Number(current.week?.number)||0;
  // After the regular season ESPN's week numbers start again at 1: the strip keeps all 18 weeks and labels this week's games by name.
  S.weeks={...S.weeks,season,latest,current:type===2?week:type>=3?19:0,label:type===2?week:current.week?.text||'Playoffs'};renderWeekOptions();
  void loadPastWeeks();
 }catch(error){S.weeks.listed=false;S.weeks.failed={...(S.weeks.failed||{}),0:error.message};renderWeekOptions();}
 finally{S.weeks.listing=false;}
 void landOnLatest();
}
// Earlier weeks' finals for the strip, oldest first, so the season reads left to right up to this week.
// One small record per game; the season's set is cached so a reload costs ESPN nothing.
const WEEKS_STORE=season=>`fantasy-stream-weeks-${season}`;
const pastGame=g=>({id:g.id,name:g.name,date:g.date,detail:g.detail,teams:g.teams.map(t=>({id:t.id,abbreviation:t.abbreviation,abbr:t.abbr,name:t.name,color:t.color,score:t.score}))});
async function loadPastWeeks(){
 const {season,current}=S.weeks;if(!season||current<2||S.pastLoading)return;S.pastLoading=true;
 let store={season,weeks:{}};try{const hit=JSON.parse(localStorage.getItem(WEEKS_STORE(season))||'null');if(hit?.season===season&&hit.weeks)store=hit;}catch{}
 const show=()=>{S.pastWeeks=Object.keys(store.weeks).map(Number).filter(w=>w<current).sort((a,b)=>a-b).map(week=>({week,games:store.weeks[week]}));render();};
 if(Object.keys(store.weeks).length)show();
 const missing=[];for(let w=1;w<current;w++)if(!store.weeks[w])missing.push(w);
 try{
  for(let i=0;i<missing.length;i+=3)await Promise.all(missing.slice(i,i+3).map(async week=>{
   try{const board=await espn(`scoreboard?dates=${season}&seasontype=2&week=${week}`,AbortSignal.timeout(10000));const games=liveGames(board).filter(g=>g.state==='post');if(games.length)store.weeks[week]=games.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).map(pastGame);}catch{}
  }));
  show();try{for(const k of Object.keys(localStorage))if(/^fantasy-stream-weeks-/.test(k)&&k!==WEEKS_STORE(season))localStorage.removeItem(k);localStorage.setItem(WEEKS_STORE(season),JSON.stringify(store));}catch{}
 }finally{S.pastLoading=false;}
}
// The season so far barely changes, so its tiles are built once per set of weeks, lineup and "this week" label.
const pastMemo={weeks:null,who:'',label:0,html:'',kept:0};
function pastRun(label){
 const who=roster().map(p=>p.team+':'+p.name).join();
 if(pastMemo.weeks!==S.pastWeeks||pastMemo.who!==who||pastMemo.label!==label)Object.assign(pastMemo,{weeks:S.pastWeeks,who,label,html:S.pastWeeks.map(w=>`<li class="week-label" aria-hidden="true">Week ${w.week}</li>`+w.games.map(g=>pastTile(g,w.week)).join('')).join('')+(label?`<li class="week-label" aria-hidden="true">${typeof label==='number'?'Week '+label:esc(label)}</li>`:''),kept:S.pastWeeks.reduce((n,w)=>n+w.games.length+1,0)+(label?1:0)});
 return pastMemo;
}
function pastTile(g,week){
 const known=g.teams.every(t=>Number.isFinite(Number(t.score))),diff=known?Number(g.teams[0].score)-Number(g.teams[1].score):0,nick=t=>{const words=String(t.name||'').trim().split(/\s+/);return words.length>1?words.at(-1):t.name||t.abbr;};
 const rows=g.teams.map((t,i)=>{const logo=teamLogo(t),lead=known&&(i===0?diff>0:diff<0),trail=known&&(i===0?diff<0:diff>0);return `<span class="g-team${lead?' lead':''}${trail?' trail':''}"><span class="team-logo">${logo?`<img src="${esc(logo)}" alt="" width="22" height="22" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span class="team-code">${esc(t.abbr)}</span><span class="team-name">${esc(nick(t))}</span><b class="team-score">${known?esc(t.score):'—'}</b></span>`;}).join('');
 const mine=rosterIn(g),names=mine.map(p=>`<span>${esc(p.name)}</span>`).join(''),when=g.date?PAST_DAY.format(new Date(g.date)):'';
 return `<li class="tile past${mine.length?' mine':''}" style="--away:${teamColor(g.teams[0])};--home:${teamColor(g.teams[1])}"><button class="game" tabindex="-1" data-game="${esc(g.id)}" data-past-week="${week}" aria-label="${esc(g.teams.map(t=>(t.name||t.abbr)+(known?' '+t.score:'')).join(' at ')+', final, week '+week+', '+when+'. Watch the replay')}"><span class="g-status"><span class="tag final">FINAL</span><span class="g-when">${esc(when)}</span></span><span class="g-matchup">${rows}</span><span class="g-drive quiet"><span>Week ${week} · ${esc(g.detail||'Final')}</span></span><span class="g-bar idle" aria-hidden="true"></span></button><div class="g-footer"><span class="g-names">${names||'<span>Other game</span>'}</span><span class="g-cta">Replay</span></div></li>`;
}
// A past tile opens that week's replay at the game's kickoff.
async function openPastReplay(week,id){
 const button=$('games').querySelector?.(`[data-game="${CSS.escape?CSS.escape(id):id}"]`);if(button)button.disabled=true;
 // The choice stands only once that week is on the stage: a load that fails leaves Replay free to land on the latest week.
 const chosen=S.weekChosen,request=++S.weekRequest;let landed=false;S.weekChosen=true;S.weeks.landing=week;
 try{
  if(S.mode!=='replay'){await setMode('replay');if(S.mode!=='replay')return;}
  const data=await loadWeekArchive(week);
  // Live was clicked, or another week or tile chosen, while this loaded: that click stands.
  if(S.mode!=='replay'||request!==S.weekRequest)return;
  if(!data){toast(`Week ${week}'s replay is unavailable right now.`,'warn');return;}
  switchArchive(weekKey(week),{quiet:true,keepPlaying:false});landed=true;
  const game=archiveGame(id),index=S.archive.sessions.findIndex(s=>s.gameIds.includes(id));
  if(!game||index<0){toast('That game has no replay yet.','warn');render();return;}
  if(index!==S.day)setDay(index);
  selectGame(id,{hold:true});$('watchTitle').scrollIntoView?.({block:'start'});
 }finally{if(button)button.disabled=false;if(S.weeks.lineupDue)void importWeekLineup();if(request===S.weekRequest){if(!landed)S.weekChosen=chosen;if(S.weeks.landing===week){S.weeks.landing=0;renderWeekOptions();render();}}}
}
function renderSetup(){
 $('storageNotice').hidden=!S.storageError;
 const ready=S.live.games.filter(g=>g.state!=='post'&&streamURLs(g).length).length,upcoming=S.live.games.filter(g=>g.state!=='post').length;
 const latestGames=S.mode==='replay'&&!S.archive?.data.calibrated?(S.archive?.games||[]):null;
 const ofGames=(k,n,rest,what)=>`${k} of ${n} ${n===1?'game':'games'}${rest} ${k===1||n===1?'has':'have'} ${what}`,withVideo=latestGames?latestGames.filter(g=>hasVideo(g.id)).length:0;
 setText('streamSummary',latestGames?ofGames(withVideo,latestGames.length,'','a replay video'):S.mode==='replay'?'Replay videos are already included':upcoming?ofGames(ready,upcoming,' this week','a stream ready'):'No games left this week');
 const latestReplay=S.mode==='replay'&&!S.archive?.data.calibrated;
 setText('streamsCount',S.mode==='live'&&ready?String(ready):'');$('streamsButton').hidden=!(S.mode==='live'||latestReplay);$('streamsButton').title=latestReplay?'Replay videos for this week':'';
}
function renderScoreboard(){
 const live=S.mode==='live',games=live?S.live.games:S.games,players=live&&!hasLineup()?[]:roster();
 const week=live?games.find(g=>g.week)?.week:S.archive?.data.week;
 const age=S.live.fetched?Date.now()-S.live.fetched:Infinity;
 setText('scoreboardUpdated',!live?'Following replay time':S.live.error||age>90000?(S.live.fetched?'Scores delayed · retrying':'Connecting to ESPN…'):'Updated '+CLOCK_TIME.format(S.live.fetched));
 setText('scoreboardCaption',live?'Live scores may be ahead of your stream. Gamecast opens ESPN in a new tab.':'Scores follow your replay timeline, so future results stay hidden.');
 const connected=live&&!!saved.leagueId;
 const season=games.find(g=>g.season)?.season;
 if(!S.importing)fantasyFeed.sync(connected?{leagueId:saved.leagueId,teamId:saved.teamId,...(week&&season?{week,season}:{}),swid:saved.espn.swid,s2:saved.espn.s2}:null,saved.league);
 const data=fantasyFeed.data,match=connected&&saved.teamId?fantasyMatchup(data,saved.teamId,S.games,S.matchupId):null;
 const league=live&&data?.leagueId===saved.leagueId?data:saved.league;
 const cached=league?.teams?.find(t=>t.id===saved.teamId),knownPlayers=cached?.players||players;
 const rosterOnly=!match?.yours&&knownPlayers.length?fantasyBoard({scoring:{week,teams:[{id:'local',players:knownPlayers.map(p=>({...p,points:null})),points:null,complete:false}]}},'local',S.games):null;
 const board=match?.yours||(rosterOnly?{...rosterOnly,name:cached?.name||saved.teamName}:null),opponent=match?.opponent;
 $('scoreboard').dataset.empty=String(!board?.rows&&!opponent?.rows);
 $('scoreTeamPicker').hidden=false;$('scoreTeam').disabled=!league?.teams?.length;
 $('retryFantasy').hidden=(!live||!fantasyFeed.error)&&!sampleTeam();$('retryFantasy').disabled=!!fantasyFeed.pending;setText('retryFantasy',sampleTeam()?'Connect ESPN':fantasyFeed.needsConnection?'Reconnect ESPN':'Retry scores');
 put('scoreTeam',`<option value="">${league?.teams?.length?'Choose a team…':saved.leagueId?'Loading league teams…':'Connect ESPN to choose a team'}</option>`+(league?.teams||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join(''));
 $('scoreTeam').value=saved.teamId||'';
 const matches=match?.matches||[];$('matchupPicker').hidden=matches.length<2;
 put('matchupSelect',matches.map(m=>{const other=m.home?.teamId===saved.teamId?m.away:m.home;return `<option value="${esc(m.id)}">${esc(league?.teams.find(t=>t.id===other?.teamId)?.name||'Bye')}</option>`;}).join(''));
 $('matchupSelect').value=match?.matchupId||'';
 setText('scoreboardMeta',week?'Wk '+week:'');$('scoreboardMeta').title=[league?.name||'ESPN fantasy football',week?'Week '+week:''].filter(Boolean).join(' · ');
 const sample=sampleTeam();setText('youHeader',sample?'Sample team':'You');setText('fantasyTitle',shownTeam(board?.name)||(live&&hasLineup()?saved.teamName:'Your team'));
 setText('opponentTitle',opponent?.name||(match?.matchupId?'Bye week':'Your opponent'));$('fantasyTitle').title=$('fantasyTitle').textContent;$('opponentTitle').title=$('opponentTitle').textContent;
 setText('lineupButton','Fantasy team');$('lineupButton').title=saved.teamName||'Manage your fantasy team';
 setText('fantasyTotal',board?.points||'—');setText('opponentTotal',opponent?.points||'—');
 const period=match?.weeks.length>1?'Weeks '+match.weeks.join(' + '):board?.week?'Week '+board.week:week?'Week '+week:'This week';
 setText('fantasyWeek',period);setText('opponentWeek',period);
 $('fantasyTable').hidden=!board?.rows;$('fantasyTable').classList.toggle('solo',!opponent?.players);$('fantasyTable').classList.toggle('nopoints',false);
 put('fantasyPlayers',board?.players?headToHead(board,opponent):'');const bench=board?.players?benchRows(board,opponent):'';put('fantasyBench',bench);$('benchTable').hidden=!bench;$('benchTable').classList.toggle('solo',!opponent?.players);$('benchTable').classList.toggle('nopoints',false);put('fantasyCols',matchupColumns(!!opponent?.players));put('benchCols',matchupColumns(!!opponent?.players));
 const mineValue=match?.yours?.value,theirValue=match?.opponent?.value,scored=Number.isFinite(mineValue)&&Number.isFinite(theirValue);
 const share=scored&&mineValue+theirValue>0?mineValue/(mineValue+theirValue):.5,standing=!scored?'':mineValue>theirValue?'ahead':mineValue<theirValue?'behind':'tied';
 $('matchupBar').style.width=(share*100).toFixed(1)+'%';$('scoreboard').dataset.state=standing;$('scoreboard').dataset.connect=String(live&&!connected);
 $('headerScore').hidden=!scored;$('headerScore').dataset.state=standing;$('headerScore').title=match?.status||'';
 put('headerScore',scored?`<span>You</span><b>${esc(match.yours.points)}</b><i>–</i><b>${esc(match.opponent.points)}</b>`:'');
 setText('leagueState',!saved.leagueId?'Not connected':fantasyFeed.needsConnection?'Needs reconnecting':`${league?.name||'League '+saved.leagueId} · connected`);
 setText('leagueAction',saved.leagueId&&!fantasyFeed.needsConnection?'Change':'Connect');
 setText('matchupStatus',match?.status||(live?'Your team vs. your opponent':'Fantasy totals are available in Live games.'));
 $('opponentEmpty').hidden=!!opponent?.rows||!connected;setText('opponentEmpty',match?.matchupId&&!opponent?'No opponent this week.':'Your opponent’s starters appear once ESPN responds.');
 $('fantasyTable').title=sample?'A sample team we picked. Connect ESPN or add your own players under Fantasy team.':!match?'Saved players. Fantasy points appear after ESPN connects.':`${board?.official?'ESPN matchup totals':'Starter totals where ESPN matchup totals are unavailable'}. Player rows are week ${board?.week||week||'—'}; bench points never count.`;
 setText('fantasyStatus',sample?'This is a sample team we picked. Connect ESPN or add your own players under Fantasy team.':!live?'Fantasy totals are available in Live games.':!connected?'Connect ESPN to load your league’s teams, opponent and live fantasy points.':fantasyFeed.error?(fantasyFeed.updated?'Last update '+CLOCK_TIME.format(fantasyFeed.updated)+'. ':'')+fantasyFeed.error:!saved.teamId?'Choose your team using Fantasy team in the top bar.':!match?'Getting your matchup from ESPN… Your saved players are shown while it loads.':'Updated '+CLOCK_TIME.format(fantasyFeed.updated)+' · Refreshes every 30 seconds');
 // Only say something when it needs attention; a healthy matchup speaks for itself.
 $('fantasyStatus').hidden=live&&(!connected||!fantasyFeed.error&&!!saved.teamId&&!!match);

}
function renderStreams(){
 // Only games still to watch, live first then by kickoff.
 const watchable=S.live.games.filter(g=>g.state!=='post').sort((a,b)=>(a.state==='in'?0:1)-(b.state==='in'?0:1)||(Date.parse(a.date)||0)-(Date.parse(b.date)||0));
 const games=S.mode==='live'&&hasLineup()?watchable.filter(g=>hasRoster(g,roster())):[],others=S.mode==='live'?watchable.filter(g=>!hasLineup()||!hasRoster(g,roster())):[];
 const latest=S.mode==='replay'&&!S.archive?.data.calibrated?(S.archive?.games||[]).map(g=>[g.id,g.name,g.date,g.embed||'']):null;
 const signature=JSON.stringify([S.mode,S.archiveKey,hasLineup(),S.live.games.length>0,games.map(g=>[g.id,gameKey(g)]),others.map(g=>[g.id,gameKey(g)]),latest]);if(signature===S.streamSignature)return;S.streamSignature=signature;
 const drafts=S.streamDrafts??=new Map();for(const i of streamFields())drafts.set(i.dataset.key+(i.dataset.backup==='true'?':backup':''),i.value);
 $('streamsModeNote').textContent=latest?'':S.mode==='replay'?'Switch to Live to set up streams for this week’s games.':!S.live.games.length?'Waiting for the NFL schedule.':!watchable.length?'Every game in this slate is final.':'';$('allStreamsTitle').textContent=games.length?'Other games':'This week’s games';
 $('streamGroupTitle').textContent=latest?'Replay videos':'Your games';
 $('streamsHelp').textContent=latest?'Replay videos are found automatically. If a game has none and you have a link to it on ok.ru, paste it here.':S.mode==='replay'?'Replay videos are included. No stream links needed.':'Each game finds a stream automatically. To use your own, choose My link and paste its address.';
 $('streamBadge').textContent=S.mode==='replay'&&!latest?'Included':'';
 const kickoff=g=>{const d=new Date(g.date);return Number.isFinite(d.getTime())?d.toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'}):'';};
 const inputs=list=>S.mode==='live'?list.map(g=>{const key=gameKey(g),own=drafts.get(key)??saved.streams[key]??'',backup=drafts.get(key+':backup')??saved.streamBackups[key]??'';
  const showing=(own||backup)&&(saved.streamModes[key]||'custom')==='custom'||drafts.has(key)&&drafts.get(key)!==(saved.streams[key]??'');
  const logos=g.teams.map(t=>{const src=teamLogo(t);return src?`<img src="${esc(src)}" alt="" width="20" height="20" loading="lazy" referrerpolicy="no-referrer">`:'';}).join('');
  return `<div class="stream-row" data-stream-game="${esc(g.id)}"><div class="stream-game"><span class="stream-logos">${logos}</span><span class="stream-name"><b>${esc(g.name)}</b><small>${esc(kickoff(g))} · <span class="source-state" data-source-state="${esc(g.id)}"></span></small></span></div><div class="stream-source-options" data-sources="${esc(g.id)}"></div><div class="stream-fields" data-fields="${esc(g.id)}" ${showing?'':'hidden'}><label>Link<input type="text" data-key="${esc(key)}" value="${esc(own)}" placeholder="Paste a link to the stream" aria-label="Stream for ${esc(g.name)}"></label><label>Backup <span class="muted">optional</span><input type="text" data-key="${esc(key)}" data-backup="true" value="${esc(backup)}" placeholder="https://…" aria-label="Backup stream for ${esc(g.name)}"></label></div></div>`;}).join(''):'';
 const replayRows=latest?latest.map(([id,name,date,embed])=>`<div class="stream-row replay" data-stream-game="${esc(id)}"><div class="stream-game"><span class="stream-name"><b>${esc(name)}</b><small>${esc(new Date(date).toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}))} · <span class="source-state${embed?' ok':''}">${embed?'Replay video saved':'No replay found yet · following on the game tracker'}</span></small></span></div><div class="stream-fields one"><label>Have a link? (optional)<input type="text" data-replay-link="${esc(id)}" value="${esc(embed)}" placeholder="https://ok.ru/videoembed/…" aria-label="Replay video for ${esc(name)}"></label></div></div>`).join(''):'';
 $('streamInputs').innerHTML=latest?replayRows:inputs(games);$('backupInputs').innerHTML=inputs(others);$('backupStreams').hidden=S.mode!=='live'||!others.length;$('backupStreams').open=!games.length;
 renderSourceOptions();
 $('saveStreams').hidden=latest?false:S.mode!=='live'||!S.live.games.length;$('refreshStreams').hidden=S.mode!=='live';
}
function streamFields(){return [...$('streamInputs').querySelectorAll('input'),...$('backupInputs').querySelectorAll('input')];}
$('refreshStreams').onclick=()=>{S.live.generation++;pollLive(S.live.generation);pollLiveClips(S.live.generation);$('streamsStatus').textContent='Refreshing the schedule…';};
async function restoreConnection(){
 if(saved.leagueId){await importLeague({refresh:true,quiet:true});return;}
 const request=S.leagueRequest;
 try{const r=await fetch('/api/session',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)return;const session=await r.json();
  if(request!==S.leagueRequest||hasLineup())return;
  if(session.savedLeagueId){$('leagueId').value=session.savedLeagueId;await importLeague({quiet:true});}}catch{}
}

async function refreshStreamLinks(){
 if(document.hidden||S.mode!=='live'||!S.live.games.length||streamFinder.pending)return;
 const generation=S.live.generation;streamFinder.enabled=saved.autoDiscover;
 const manual=[...Object.values(saved.streams),...Object.values(saved.streamBackups)].filter(Boolean);
 const task=streamFinder.refresh(S.live.games,'nfl',manual),discovery=streamFinder.generation;await task;
 if(S.mode!=='live'||generation!==S.live.generation||discovery!==streamFinder.generation)return;
 setText('discoveryStatus',streamFinder.status);renderSourceOptions();render();
 if(!S.autoAttempted&&!S.started&&saved.leagueId&&saved.teamId&&hasLineup()&&S.live.games.some(g=>g.state==='in'&&streamURLs(g).length))setPlaying(true);
}
$('optDiscover').checked=saved.autoDiscover;
$('optDiscover').onchange=e=>{saved.autoDiscover=e.target.checked;streamFinder.enabled=saved.autoDiscover;streamFinder.cancel();persist();void refreshStreamLinks();render();};

// ---------- settings ----------
function openSettings(tab='viewing'){
 $('settingsError').textContent='';
 $('optDefense').checked=saved.includeDefense;$('optHighlights').checked=saved.highlights;$('optData').checked=saved.dataOnly;$('optDelay').value=saved.delay;
 $('optData').disabled=S.mode!=='replay';
 $('optReconnect').checked=saved.autoReconnect;
 $('syncGame').innerHTML=(S.archive?.games||[]).map(g=>`<option value="${esc(g.id)}">${esc(g.name)}</option>`).join('');
 const cur=currentGameId();if(cur&&S.mode==='replay')$('syncGame').value=cur;
 syncStatus();showTab(tab);$('settings').showModal();
}
function showTab(name){for(const b of document.querySelectorAll('[data-tab]')){const active=b.dataset.tab===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;}for(const p of document.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==name;}
for(const b of document.querySelectorAll('[data-tab]'))b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')],i=tabs.indexOf(b),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;showTab(tabs[next].dataset.tab);tabs[next].focus();};
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>showTab(b.dataset.tab);
$('settingsButton').onclick=()=>openSettings();$('closeSettings').onclick=()=>$('settings').close();
for(const id of ['optDefense','optHighlights','optData'])$(id).onchange=()=>{
 saved.includeDefense=$('optDefense').checked;saved.highlights=$('optHighlights').checked;
 if(!saved.highlights){if(S.highlight){item(S.highlight).status='skipped';S.highlight.done=true;closeHighlight();}coverage.queue.length=0;for(const entry of coverage.log)if(['queued','waiting'].includes(entry.status))entry.status='skipped';S.sources.clear();}
 const data=$('optData').checked;if(data!==saved.dataOnly){
  saved.dataOnly=data;if(!data){clock.rate=1;$('speed').value='1';}
  if(S.mode==='replay'){
   if(S.highlight){const interrupted=S.highlight.item;S.highlight.done=true;closeHighlight();if(saved.highlights)coverage.requeue(interrupted);}
   pool.destroy();resetBreaks();S.program={kind:S.started?'standby':'idle'};S.pending=null;S.stall=null;S.lastAt=null;S.sources.clear();S.cooldown.clear();S.seekHold=false;
  }
 }
 persist();director.reset();render();
};
$('optDelay').onchange=e=>{saved.delay=Math.max(0,Math.min(600,Number(e.target.value)||0));resetBreaks();persist();};
$('optReconnect').onchange=e=>{saved.autoReconnect=e.target.checked;for(const slot of pool.slots.values())slot.player.setAutoReconnect?.(saved.autoReconnect);persist();render();};
function renderSourceOptions(){
 for(const box of document.querySelectorAll('[data-sources]')){
  const g=S.live.games.find(g=>g.id===box.dataset.sources);if(!g)continue;const key=gameKey(g),custom=saved.streams[key],mode=saved.streamModes[key]||'custom';
  const providers=[...new Set(streamFinder.options(g).map(x=>x.provider))];
  const choices=[['auto','Auto'],...['NTV','StreamCorner'].filter(p=>providers.includes(p)).map(p=>[p,p]),['custom','My link']];
  const selected=mode==='custom'&&!custom?'auto':mode,kind=custom&&streamFinder.resolved.get(custom)?.kind,ready=streamURLs(g).length>0;
  const state=selected==='custom'?(kind==='page'?'Your link · webpage':kind==='video'?'Your link · direct video':kind==='player'?'Your link · player':'Your link'):providers.length?'Found on '+providers.join(' & ')+(outsideURL(g)?' · opens in a new tab':''):streamFinder.pending?'Searching…':'No stream found yet';
  box.innerHTML=`<div class="seg" role="group" aria-label="Play ${esc(g.name)} from">`+choices.map(([id,label])=>`<button type="button" data-source-game="${esc(g.id)}" data-source-mode="${esc(id)}" aria-pressed="${selected===id}">${esc(label)}</button>`).join('')+'</div>';
  for(const line of document.querySelectorAll(`[data-source-state="${String(g.id).replace(/["\\]/g,'')}"]`)){line.textContent=state;line.classList.toggle('ok',ready);}
 }
}
function applyStreamChoice(id){
 const g=gameState(id);if(!g)return;const primary=streamURLs(g)[0],slot=pool.get(id);
 S.streamRotations.delete(id);S.cooldown.delete(id);S.streamChoices.delete(id);
 if(slot&&slot.url===primary){S.streamChoices.set(id,primary);return;}
 pool.close(id);S.ads.delete(id);if(S.pending?.id===id)S.pending=null;
 if(S.program.kind==='game'&&S.program.id===id){S.program={kind:'standby'};S.lastAt=null;}
}
$('streamsPanel').onclick=event=>{
 const button=event.target.closest('[data-source-game]');if(!button)return;const g=S.live.games.find(g=>g.id===button.dataset.sourceGame);if(!g)return;
 const mode=button.dataset.sourceMode;if(!['custom','auto','NTV','StreamCorner'].includes(mode))return;
 const fields=document.querySelector(`[data-fields="${String(g.id).replace(/["\\]/g,'')}"]`);
 // With no saved link yet, My link only opens the field; it takes effect once there is a link to play.
 const restore=()=>{for(const input of fields?.querySelectorAll?.('input')||[]){const key=input.dataset.key,backup=input.dataset.backup==='true';input.value=(backup?saved.streamBackups:saved.streams)[key]??'';input.removeAttribute?.('aria-invalid');S.streamDrafts?.delete(key+(backup?':backup':''));}};
 if(mode==='custom'&&!saved.streams[gameKey(g)]){fields.hidden=!fields.hidden;if(fields.hidden)restore();else fields.querySelector('input')?.focus();return;}
 if(fields){fields.hidden=mode!=='custom';if(fields.hidden)restore();}
 saved.streamModes[gameKey(g)]=mode;persist();applyStreamChoice(g.id);director.reset();renderSourceOptions();render();
};
// An ok.ru video link in any of its spellings, or an iframe snippet carrying one.
function replayLinkFrom(value){const m=/ok\.ru\/(?:videoembed|video)\/(\d{1,20})/i.exec(String(value||''));return m?`https://ok.ru/videoembed/${m[1]}`:'';}
function saveReplayLinks(){
 const inputs=[...($('streamInputs').querySelectorAll?.('input')||[])].filter(i=>i.dataset?.replayLink);let changed=0;
 for(const input of inputs){const id=input.dataset.replayLink,value=String(input.value||'').trim(),link=replayLinkFrom(value);
  if(value&&!link){input.setAttribute('aria-invalid','true');$('streamsError').textContent='Paste a link to the video on ok.ru, such as https://ok.ru/videoembed/123456.';input.focus?.();return;}
  input.removeAttribute('aria-invalid');if((saved.replayLinks[id]||'')===link)continue;changed++;
  // A different video has a different length: forget what the old one taught us.
  if(link)saved.replayLinks[id]=link;else delete saved.replayLinks[id];delete saved.replayDurations[id];delete saved.replayDurationEmbeds[id];S.deadEmbeds.delete(link);
  for(const data of [...[...S.archives.values()].filter(a=>!a.calibrated).map(a=>a.games),S.archive?.games||[]])for(const g of data)if(g.id===id){g.embed=link;g.recordingDuration=0;g.durationGuessed=false;}
  S.syncs.delete(id);S.recordingEnds.delete(id);pool.close(id);if(S.program.kind==='game'&&S.program.id===id){S.program={kind:'standby'};S.pending=null;}
 }
 persist();$('streamsError').textContent='';$('streamsDetails').close?.();if(changed)toast(changed===1?'Replay video saved.':changed+' replay videos saved.');S.streamSignature=null;resetBreaks();render();
}
$('saveStreams').onclick=async()=>{
 if(S.mode==='replay'){saveReplayLinks();return;}
 const streams={...saved.streams},backups={...saved.streamBackups};
 for(const input of streamFields()){
  if(input.closest?.('[data-fields]')?.hidden)continue;
  try{const url=safeVideo(input.value.trim());(input.dataset.backup==='true'?backups:streams)[input.dataset.key]=url;input.removeAttribute('aria-invalid');}
  catch(error){input.setAttribute('aria-invalid','true');input.closest?.('[data-fields]')?.removeAttribute('hidden');$('streamsDetails').open=true;$('streamsError').textContent=error.message;input.focus();return;}
 }
 const changed=S.games.filter(g=>{const key=gameKey(g);return (saved.streams[key]||'')!==(streams[key]||'')||(saved.streamBackups[key]||'')!==(backups[key]||'');}).map(g=>g.id);
 saved.streams=streams;saved.streamBackups=backups;for(const id of changed)saved.streamModes[gameKey(gameState(id))]='custom';persist();
 const request=S.streamSaveRequest=(S.streamSaveRequest||0)+1,generation=S.live.generation;
 // Direct links apply synchronously. Page links keep the existing picture until resolution completes.
 for(const id of changed){const g=gameState(id);if(!streams[gameKey(g)]||streamFinder.playable(streams[gameKey(g)]))applyStreamChoice(id);}
 $('streamsError').textContent='';$('streamsStatus').textContent='';$('streamsDetails').close?.();if(changed.length)toast('Links saved. Finding the video…');render();
 await Promise.allSettled(changed.flatMap(id=>{const g=gameState(id);return [streams[gameKey(g)],backups[gameKey(g)]];}).filter(Boolean).map(url=>streamFinder.resolve(url)));
 if(request!==S.streamSaveRequest||generation!==S.live.generation||S.mode!=='live')return;
 for(const id of changed)applyStreamChoice(id);
 director.reset();renderSourceOptions();void refreshStreamLinks();render();
};
function syncStatus(){const g=archiveGame($('syncGame').value);if(!g)return;const sync=syncFor(g);const n=saved.marks[g.id]?.length||0;$('syncStatus').textContent=`${g.name}: ${n===0?'no marks yet':n===1?'1 mark saved':n+' marks saved'}.${pool.visible===g.id?` Video is at ${Math.floor(pool.current.currentTime/60)}:${String(Math.floor(pool.current.currentTime%60)).padStart(2,'0')}.`:' Open this game on screen to mark it.'}`;void sync;}
$('syncGame').onchange=syncStatus;
$('addSync').onclick=()=>{
 try{const g=archiveGame($('syncGame').value);if(!g||S.mode!=='replay'||pool.visible!==g.id)throw new Error('Switch to Replay and open this game first, then pause on the play you want to mark.');
  const wall=wallForClock(g,$('syncQuarter').value,$('syncClock').value);
  saved.marks[g.id]=addMark(saved.marks[g.id]||[],wall,pool.current.currentTime);persist();S.syncs.delete(g.id);S.recordingEnds.delete(g.id);resetBreaks();
  $('settingsError').textContent='';syncStatus();toast('Saved. The video will line up with this moment.');
 }catch(error){$('settingsError').textContent=error.message;}
};
$('clearSync').onclick=()=>{const id=$('syncGame').value;delete saved.marks[id];persist();S.syncs.delete(id);S.recordingEnds.delete(id);resetBreaks();syncStatus();};

// ---------- start ----------
// A link can open a panel directly: #streams, #team, #settings.
function openFromHash(){const hash=window.location?.hash||'';if(hash==='#streams')openStreams();else if(hash==='#team')openLineup();else if(hash==='#settings')openSettings();}
window.addEventListener?.('hashchange',openFromHash);
async function init(){
 S.discoveryReady=true;franchiseOptions();restoreConnection();render();setInterval(()=>frame(performance.now()),100);pollLive(S.live.generation);pollLiveClips(S.live.generation);setInterval(refreshStreamLinks,15000);
 S.chat=mountChat({$,sport:'nfl',getName:()=>saved.chatName,setName:name=>{saved.chatName=name;persist();},defaultName:()=>hasLineup()?saved.teamName:'',isOpen:()=>!$('chatPanel').hidden,origin:window.location?.origin||''});S.chat.suggestName();chatRoom();
 // The replay archive (a third of a megabyte) loads after the live page is up, or at once when the page opens in Replay mode.
 const replayFirst=window.location&&new URLSearchParams(window.location.search).get('mode')==='replay';
 if(replayFirst){await loadReplayArchive();setMode('replay');}
 else{void loadWeekList();setTimeout(()=>void loadReplayArchive(),1200);}
 openFromHash();
}
// Loads the calibrated archive once; Replay mode waits for it instead of refusing while it is on its way.
function loadReplayArchive(){
 if(S.archiveLoad)return S.archiveLoad;
 S.archiveLoad=(async()=>{
  try{
   const [archive,clips]=await Promise.all([fetch('/week7.json',{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw new Error('The replay archive is unavailable. Reload to try again.');return r.json();}),fetch('/nfl-highlights.json',{signal:AbortSignal.timeout(15000)}).then(r=>r.ok?r.json():{clips:[]}).catch(()=>({clips:[]}))]);
   archive.calibrated=true;S.archives.set(weekKey(archive.week||7),archive);S.week7Clips=clips.clips||[];S.archiveKey='';switchArchive(weekKey(archive.week||7),{quiet:true});void loadWeekList();
   render();return true;
  }catch(error){S.archiveLoad=null;$('replayMode').disabled=true;$('replayMode').title=error.message;render();return false;}
 })();
 return S.archiveLoad;
}
init();
