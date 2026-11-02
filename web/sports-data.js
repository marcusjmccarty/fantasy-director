import {safeVideo} from './roster.js';
export const SPORTS={nba:{label:'NBA',name:'Basketball',path:'basketball/nba',fantasy:'basketball'},nhl:{label:'NHL',name:'Hockey',path:'hockey/nhl',fantasy:'hockey'},mlb:{label:'MLB',name:'Baseball',path:'baseball/mlb',fantasy:'baseball'}};
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function localDate(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');}
export function normalizeSportGames(raw,sport){
 if(!Object.hasOwn(SPORTS,sport))return [];
 return (raw.events||[]).map(event=>{
  const c=event.competitions?.[0],status=c?.status||event.status||{},type=status.type||{};
  const teams=(c?.competitors||[]).slice().sort((a,b)=>(a.homeAway==='away'?0:1)-(b.homeAway==='away'?0:1)).map(t=>({id:String(t.team?.id||t.id),abbr:t.team?.abbreviation||'',name:t.team?.displayName||'',score:t.score!==undefined&&t.score!==''&&Number.isFinite(Number(t.score))?Number(t.score):null}));
  const interrupted=/POSTPON|CANCEL|SUSPEND|DELAY/i.test(type.name||'');
  const onBreak=interrupted||/HALFTIME|END_PERIOD|INTERMISSION|TIMEOUT|END_INNING/i.test(type.name||'');
  return {id:String(event.id),key:sport+':'+event.id,sport,name:event.shortName||event.name||SPORTS[sport].label+' game',date:event.date,teams,state:interrupted?'hold':type.state||'pre',onBreak,detail:type.shortDetail||type.description||'',period:Number(status.period)||0,clock:status.displayClock||'',situation:c?.situation||{},season:Number(event.season?.year||raw.season),statusName:type.name||''};
 }).filter(g=>g.teams.length===2&&/^\d+$/.test(g.id));
}
export function normalizeSportPreferences(value={}){
 const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};value=object(value);
 const streams={};for(const [key,entry] of Object.entries(object(value.streams))){if(!/^(nba|nhl|mlb):\d+$/.test(key))continue;const links={};for(const field of ['primary','backup'])try{if(typeof entry?.[field]==='string')links[field]=safeVideo(entry[field]);}catch{}links.mode=['custom','auto','NTV','StreamCorner'].includes(entry?.mode)?entry.mode:'custom';streams[key]=links;}
 return {streams,leagueId:/^\d{1,12}$/.test(value.leagueId)?value.leagueId:'',teamId:/^\d+$/.test(value.teamId)?value.teamId:'',swid:typeof value.swid==='string'?value.swid.slice(0,80):'',s2:typeof value.s2==='string'?value.s2.slice(0,2048):'',muted:!!value.muted,auto:value.auto!==false,autoReconnect:value.autoReconnect!==false,autoDiscover:value.autoDiscover!==false,leagueSeason:Number.isInteger(value.leagueSeason)?value.leagueSeason:null,delay:Math.min(600,Math.max(0,Number.isFinite(Number(value.delay))?Number(value.delay):30))};
}
export function sportPriority(game,followed=[]){
 const mine=game.teams.some(t=>followed.includes(t.id)),scores=game.teams.map(t=>t.score),known=scores.every(s=>s!==null),difference=known?Math.abs(scores[0]-scores[1]):Infinity;
 const late=game.sport==='nba'?game.period>=4:game.sport==='nhl'?game.period>=3:game.period>=7;
 const close=difference<=(game.sport==='nba'?10:2);
 const runners=game.sport==='mlb'&&!!(game.situation.onSecond||game.situation.onThird);
 return (mine?100:0)+(late&&close?25:close?5:0)+(runners?10:0);
}
export function chooseSportGame(games,{streams={},followed=[],currentId=null,manual=false,blocked=new Set(),now=Date.now(),lastSwitch=0}={}){
 const eligible=games.filter(g=>g.state==='in'&&!g.onBreak&&!blocked.has(g.id)&&!!(streams[g.key]?.primary||streams[g.key]?.backup));
 const current=games.find(g=>g.id===currentId),stillAvailable=eligible.some(g=>g.id===currentId);
 if(stillAvailable&&(manual||now-lastSwitch<60000||!current.onBreak))return current;
 return eligible.sort((a,b)=>sportPriority(b,followed)-sportPriority(a,followed)||a.id.localeCompare(b.id))[0]||null;
}
export function sportMatchup(data,teamId,matchId){
 const yours=data?.teams?.find(t=>t.id===teamId);if(!yours)return null;
 const matches=(data.matchups||[]).filter(m=>m.home?.teamId===teamId||m.away?.teamId===teamId),match=matches.find(m=>m.id===matchId)||matches[0];
 const mine=match?.home?.teamId===teamId?match.home:match?.away,other=match?.home?.teamId===teamId?match.away:match?.home;
 return {yours,opponent:data.teams.find(t=>t.id===other?.teamId)||null,yourPoints:mine?.points??null,opponentPoints:other?.points??null,matches,matchId:match?.id||''};
}
