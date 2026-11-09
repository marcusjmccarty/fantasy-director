export {normalizeLeague, normalizeScoreboard, scoringDistance} from './adapters.js';
export const VERSION='3.2.0';
export const DEFAULTS={schemaVersion:3,leagueId:'28375786',season:new Date().getFullYear(),teamId:'',focusMode:'fantasy',includeBench:false,pollSeconds:5,holdSeconds:8,maxDwellSeconds:90,delaySeconds:0,muteOthers:true,highlightsEnabled:true,autoHighlights:true};
export function migrateConfig(saved={}) {
  const config={...DEFAULTS,...saved};
  if(saved.schemaVersion!==3)Object.assign(config,{schemaVersion:3,pollSeconds:5,holdSeconds:8,delaySeconds:0});
  return config;
}
export function validateConfig(input={},old=DEFAULTS) {
  const c={...DEFAULTS,...old,...input};
  if(!/^\d{1,12}$/.test(String(c.leagueId)))throw new Error('Enter a numeric league ID.');
  if(!Number.isInteger(Number(c.season)) || c.season<2000 || c.season>2100)throw new Error('Enter a valid season year.');
  for(const [key,min,max] of [['pollSeconds',5,30],['holdSeconds',2,30],['maxDwellSeconds',30,600],['delaySeconds',0,120]]) {
    c[key]=Number(c[key]);if(!Number.isInteger(c[key]) || c[key]<min || c[key]>max)throw new Error(`${key} must be a whole number between ${min} and ${max}.`);
  }
  if(!['fantasy','nfl'].includes(c.focusMode))throw new Error('Choose Fantasy roster or NFL RedZone.');
  return {schemaVersion:3,leagueId:String(c.leagueId),season:Number(c.season),teamId:String(c.teamId || ''),focusMode:c.focusMode,includeBench:!!c.includeBench,pollSeconds:c.pollSeconds,holdSeconds:c.holdSeconds,maxDwellSeconds:c.maxDwellSeconds,delaySeconds:c.delaySeconds,muteOthers:c.muteOthers!==false,highlightsEnabled:c.highlightsEnabled!==false,autoHighlights:c.autoHighlights!==false};
}
export function rankGames(games,roster=[],config={}) {
  const selected=config.focusMode==='nfl'?[]:roster.filter(p=>config.includeBench || p.starter);
  return games.map(g=>{
    const players=selected.filter(p=>g.teams.some(t=>t.id===p.teamId));
    const eligible=g.state==='in' && !g.buffering && g.phase!=='between-drives' && !/HALFTIME|DELAY|SUSPEND|END_PERIOD/i.test(g.statusName);
    const available=players.filter(p=>!['OUT','INJURY_RESERVE','SUSPENSION','IR'].includes(p.injury));
    const offense=available.filter(p=>['QB','RB','WR','TE'].includes(p.position) && p.teamId===g.possession);
    const defense=available.filter(p=>p.position==='D/ST' && g.possession && p.teamId!==g.possession);
    const kickers=available.filter(p=>p.position==='K' && p.teamId===g.possession && g.down===4);
    const involved=eligible?[...offense,...defense,...kickers]:[];
    const yards=Number.isFinite(g.yardsToGoal)?g.yardsToGoal:null;
    const redZone=!!g.possession && (yards!==null?yards<=20:!!g.redZone);
    const threat=!g.possession?0:yards!==null?100-yards:redZone?80:1;
    const close=g.period>=4 && Math.abs(Number(g.teams[0].score)-Number(g.teams[1].score))<=8;
    const score=eligible?10+threat+(close?0.3:0)+(involved.length?1000+Math.min(involved.length,4)*4:0):0;
    let reason=g.buffering?'Filling this stream’s timing buffer':g.phase==='between-drives'?'Score completed · waiting for the next drive':!eligible?(g.state==='post'?'Game finished':g.state==='pre'?'Not started':'Game break / delayed'):
      (yards!==null?`${yards} yards to goal`:redZone?'Red zone · exact field position unavailable':g.possession?'Field position unavailable':'Possession unavailable');
    if(involved.length)reason=(offense.length?'Your offense has possession':defense.length?'Your defense faces the opposing possession':'Your kicker: fourth-down opportunity')+' · '+reason;
    else if(eligible)reason='Around the league · '+reason;
    return {...g,players,involved,eligible,redZone,rosterActive:!!involved.length,score,reason,directorMode:involved.length?'roster':'redzone'};
  }).sort((a,b)=>b.score-a.score || a.id.localeCompare(b.id));
}
// The director is pure. Every response carries its candidate state so the
// coordinator can evaluate holds on 1s pulses without another network request.
export function chooseGame(ranked,bindings,r,c=DEFAULTS,now=Date.now()) {
  const stay=(code,reason,extra={})=>({game:null,code,reason,candidate:null,...extra});
  if(!r.running)return stay('stopped','Director stopped');
  if(r.replay)return stay('replay','Highlight break · Return to live to resume');
  if(r.lockGame)return stay('locked','Manual lock · Resume Auto to release');
  if(r.feedError || !r.fetchedAt)return stay('stale','Feed unavailable or stale · holding the current stream');
  const available=ranked.filter(g=>g.eligible && bindings[g.id] && !bindings[g.id].unavailable);
  const current=available.find(g=>g.id===r.currentGame),best=available[0];
  if(!best)return stay('no-live','No assigned game is ready for a live cut.');
  if(now-r.fetchedAt>Math.max(20000,(c.pollSeconds || 5)*3000))return stay('stale','Feed unavailable or stale · holding the current stream');
  if(current && r.manualUntil>now)return stay('preview',`Watch preview · Auto resumes in ${Math.ceil((r.manualUntil-now)/1000)}s`,{mode:current.directorMode});
  const shotAge=now-(r.switchedAt || 0);
  const cut=(game,code,reason)=>({game,code,reason,candidate:null,mode:game.directorMode});
  // Finished games, known scoring breaks and missing assignments leave at once.
  if(!current)return cut(best,'take','Taking the best available live opportunity · '+best.reason);
  if(available.length===1)return stay('one-stream','Only one eligible assigned stream · '+current.reason,{mode:current.directorMode});
  const sameTier=best.rosterActive===current.rosterActive;
  const urgent=best.id!==current.id && (
    (best.rosterActive && !current.rosterActive) ||
    (r.lastSwitchMode==='roster' && !current.rosterActive) ||
    (sameTier && best.redZone && !current.redZone) ||
    (sameTier && best.yardsToGoal!==null && best.yardsToGoal<=10 && (current.yardsToGoal===null || current.yardsToGoal>10))
  );
  // Two seconds is an anti-flap floor, not a 45s broadcast hold. A newly gained
  // roster possession or new scoring threat never waits for the routine hold.
  if(urgent && shotAge>=2000)return cut(best,'urgent','Immediate opportunity · '+best.reason);
  if(urgent)return stay('cooldown','Finishing a two-second transition guard',{mode:current.directorMode,nextId:best.id});
  const margin=best.rosterActive?8:0.5;
  let target=best.id!==current.id && best.score>=current.score+margin?best:null,rotation=false;
  if(!target && !current.redZone && shotAge>=c.maxDwellSeconds*1000 && sameTier && best.score-current.score<=(current.rosterActive?8:0.5)) {
    target=available.filter(g=>g.id!==current.id && g.rosterActive===best.rosterActive && Math.abs(g.score-best.score)<=(best.rosterActive?8:0.5)).sort((a,b)=>(r.lastShown?.[a.id] || 0)-(r.lastShown?.[b.id] || 0))[0];
    rotation=!!target;
  }
  if(!target)return stay('follow',`Following this drive · ${current.reason}`,{mode:current.directorMode});
  const candidate=r.candidate?.id===target.id?r.candidate:{id:target.id,since:now};
  const wait=Math.max(c.holdSeconds*1000-shotAge,2000-(now-candidate.since),0);
  if(wait>0)return stay('pending',`${target.name} up next · ${Math.ceil(wait/1000)}s`,{candidate,nextId:target.id,mode:current.directorMode});
  return cut(target,rotation?'rotation':'priority',(rotation?'Coverage rotation':'Better opportunity')+' · '+target.reason);
}
export function delayedGames(history,seconds,now=Date.now()) {
  return [...history].reverse().find(s=>s.at<=now-seconds*1000)?.games || null;
}
export function alignedGames(latest,history,bindings,defaultDelay,now=Date.now()) {
  return latest.map(g=>{
    const seconds=bindings[g.id]?.delaySeconds ?? defaultDelay;
    if(!seconds)return g;
    const old=delayedGames(history,seconds,now)?.find(x=>x.id===g.id);
    return old?{...old,alignmentSeconds:seconds}:{...g,buffering:true,alignmentSeconds:seconds};
  });
}
export function sameStreamURL(a,b) {
  try {const x=new URL(a),y=new URL(b);x.hash='';y.hash='';return x.href===y.href;}catch{return false;}
}
