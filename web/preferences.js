import {SAMPLE,parseRoster,formatRoster,safeVideo} from './roster.js';
const record=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const text=(value,fallback='',limit=160)=>typeof value==='string'?value.slice(0,limit):fallback;
const players=value=>parseRoster(formatRoster(value));

// Persisted browser data can come from an older release or an interrupted save.
// Validate each preference independently so one damaged field cannot break startup.
export function normalizePreferences(value={}){
 const raw=record(value),out={roster:SAMPLE.map(p=>({...p})),teamName:'Sample lineup',teamId:'',leagueId:'',league:null,streams:{},marks:{},muted:false,includeDefense:true,highlights:true,dataOnly:false,delay:30,espn:{swid:'',s2:''},lineupReady:false};
 let validRoster=false;try{out.roster=players(raw.roster);validRoster=true;}catch{}
 if(validRoster){out.teamName=text(raw.teamName,'Sample lineup');out.lineupReady=typeof raw.lineupReady==='boolean'?raw.lineupReady:out.teamName!=='Sample lineup';}
 for(const key of ['muted','includeDefense','highlights','dataOnly'])if(typeof raw[key]==='boolean')out[key]=raw[key];
 if(typeof raw.delay==='number'&&Number.isFinite(raw.delay))out.delay=Math.max(0,Math.min(600,raw.delay));
 out.leagueId=/^\d{1,12}$/.test(raw.leagueId)?String(raw.leagueId):'';
 out.teamId=/^\d+$/.test(raw.teamId)?String(raw.teamId):'';
 const league=record(raw.league);
 if(Array.isArray(league.teams)){
  const teams=league.teams.flatMap(t=>{try{if(!/^\d+$/.test(t?.id))return [];return [{id:String(t.id),name:text(t.name,'Team '+t.id),players:t.players?.length?players(t.players):[]}];}catch{return [];}});
  if(teams.length)out.league={name:text(league.name,'ESPN league'),leagueId:out.leagueId,season:league.season,week:league.week,ownedTeamId:text(league.ownedTeamId),teams};
 }
 for(const [key,url] of Object.entries(record(raw.streams)))try{if(/^[A-Z]{2,3}-[A-Z]{2,3}$/.test(key)&&typeof url==='string')out.streams[key]=safeVideo(url);}catch{}
 for(const [id,marks] of Object.entries(record(raw.marks)))if(Array.isArray(marks))out.marks[id]=marks.filter(m=>m&&Number.isFinite(m.wall)&&Number.isFinite(m.media)&&m.media>=0).map(({wall,media})=>({wall,media}));
 out.espn={swid:text(raw.espn?.swid,'',40),s2:text(raw.espn?.s2,'',2048)};
 return out;
}
