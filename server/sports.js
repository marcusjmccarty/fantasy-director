import {sameSite,ownCookies} from './api.js';
// Only these ESPN services can be reached; callers cannot provide upstream URLs.
export const SPORT_SERVICES={nba:{path:'basketball/nba',fantasy:'fba',bench:[8,9],positions:{1:'PG',2:'SG',3:'SF',4:'PF',5:'C'},slots:['PG','SG','SF','PF','C','G','F','UTIL','BE','IR']},nhl:{path:'hockey/nhl',fantasy:'fhl',bench:[6,7],positions:{1:'C',2:'LW',3:'RW',4:'D',5:'G'},slots:['C','LW','RW','D','G','UTIL','BE','IR']},mlb:{path:'baseball/mlb',fantasy:'flb',bench:[16,17],positions:{1:'SP',2:'C',3:'1B',4:'2B',5:'3B',6:'SS',7:'LF',8:'CF',9:'RF',10:'DH',11:'RP'},slots:['C','1B','2B','3B','SS','OF','2B/SS','1B/3B','LF','CF','RF','DH','UTIL','P','SP','RP','BE','IL']}};
const sportJSON=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
export function validSportDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export async function sportsScoreboardAPI(request,fetcher=fetch){
 if(request.method!=='GET')return sportJSON({error:'Use GET.'},405);
 const url=new URL(request.url),sport=url.searchParams.get('sport'),config=Object.hasOwn(SPORT_SERVICES,sport)?SPORT_SERVICES[sport]:null,date=url.searchParams.get('date');
 if(!config||!validSportDate(date||''))return sportJSON({error:'Choose NBA, NHL or MLB and a valid date.'},400);
 try{
  const response=await fetcher(`https://site.api.espn.com/apis/site/v2/sports/${config.path}/scoreboard?dates=${date.replaceAll('-','')}&limit=100`,{signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!response.ok)throw Object.assign(new Error('upstream'),{code:'ESPN_HTTP_'+response.status});const raw=await response.json();if(!Array.isArray(raw.events))throw new Error('invalid');
  return sportJSON({sport,date,season:raw.leagues?.[0]?.season?.year||raw.season?.year,events:raw.events,fetchedAt:Date.now()});
 }catch(error){console.warn('ESPN sports scoreboard failed',error?.name,error?.message);return sportJSON({error:'ESPN game updates are unavailable. Try again shortly.',code:error?.code||error?.cause?.code||'ESPN_NETWORK'},502);}
}
export function normalizeSportLeague(raw,sport,proTeams=[],swid=''){
 const config=Object.hasOwn(SPORT_SERVICES,sport)?SPORT_SERVICES[sport]:null;if(!config||!Array.isArray(raw.teams)||!raw.teams.length)throw new Error('No league teams returned.');
 const period=Number(raw.scoringPeriodId),matchupPeriod=Number(raw.status?.currentMatchupPeriod),scoringType=raw.settings?.scoringSettings?.scoringType||'';
 const isPoints=/POINTS/.test(scoringType),scheduled=(raw.schedule||[]).filter(m=>Number(m.matchupPeriodId)===matchupPeriod);
 const teamNames=new Map(proTeams.map(t=>[String(t.id),t]));
 const teams=raw.teams.map(team=>{
  const side=scheduled.flatMap(m=>[m.home,m.away]).find(s=>String(s?.teamId)===String(team.id));
  const entries=side?.rosterForCurrentScoringPeriod?.entries??team.roster?.entries??[];
  const players=entries.map(entry=>{const p=entry.playerPoolEntry?.player||{},pro=teamNames.get(String(p.proTeamId));const slot=Number(entry.lineupSlotId);const stat=(p.stats||[]).find(s=>Number(s.scoringPeriodId)===period&&s.statSourceId===0&&s.statSplitTypeId===1);
   return {id:String(p.id||''),name:p.fullName||'Empty slot',team:pro?.abbrev||'',teamId:String(p.proTeamId||''),position:config.positions[p.defaultPositionId]||'UTIL',slot:config.slots[slot]||'Reserve',active:slot>=0&&slot<config.bench[0],points:isPoints?numeric(stat?.appliedTotal):null,injury:p.injuryStatus&&p.injuryStatus!=='ACTIVE'?p.injuryStatus.replaceAll('_',' '):''};
  });
  return {id:String(team.id),name:team.name||[team.location,team.nickname].filter(Boolean).join(' ')||team.abbrev||'Team '+team.id,players};
 });
 const side=s=>s?.teamId==null?null:{teamId:String(s.teamId),points:isPoints?(numeric(s.totalPointsLive)??numeric(s.totalPoints)):null};
 return {name:raw.settings?.name||'ESPN league',scoringPeriod:period,matchupPeriod,scoringType,isPoints,teams,matchups:scheduled.map(m=>({id:String(m.id),home:side(m.home),away:side(m.away)})),ownedTeamId:swid?String(raw.teams.find(t=>t.owners?.some(o=>String(o).toUpperCase()===swid.toUpperCase()))?.id||''):''};
}
// Public fantasy metadata contains the authoritative pro-team IDs. Cache only
// this public data, never a league response or the viewer's access cookies.
const sportMetadataCache=new Map();
async function sportMetadata(sport,season,fetcher){
 const key=sport+':'+season,cached=sportMetadataCache.get(key);if(cached&&cached.until>Date.now()&&fetcher===fetch)return cached.data;
 const response=await fetcher(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/${SPORT_SERVICES[sport].fantasy}/seasons/${season}?view=proTeamSchedules_wl`,{redirect:'manual',signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('metadata');const data=await response.json();if(!Array.isArray(data.settings?.proTeams))throw new Error('metadata');
 const teams=data.settings.proTeams.map(({id,abbrev})=>({id,abbrev}));if(fetcher===fetch){if(sportMetadataCache.size>=9)sportMetadataCache.clear();sportMetadataCache.set(key,{until:Date.now()+3600000,data:teams});}return teams;
}
export async function sportsLeagueAPI(request,fetcher=fetch){
 if(request.method!=='POST')return sportJSON({error:'Use POST.'},405);
 const origin=request.headers.get('Origin');if(origin&&!sameSite(origin,request.url))return sportJSON({error:'Invalid request origin.'},403);
 let input;try{if(Number(request.headers.get('Content-Length')||0)>4096)return sportJSON({error:'Request too large.'},413);const text=await request.text();if(text.length>4096)return sportJSON({error:'Request too large.'},413);input=JSON.parse(text);}catch{return sportJSON({error:'Enter a valid league ID.'},400);}
 const config=Object.hasOwn(SPORT_SERVICES,input?.sport)?SPORT_SERVICES[input.sport]:null,id=String(input?.leagueId||''),season=Number(input?.season);
 if(!config||!/^\d{1,12}$/.test(id)||!Number.isInteger(season)||season<2018||season>new Date().getUTCFullYear()+1)return sportJSON({error:'Choose a sport, league ID and valid season.'},400);
 let own;try{own=ownCookies(input);}catch(error){return sportJSON({error:error.message,code:'CONNECTION_INVALID'},400);}
 const headers={Accept:'application/json'};if(own)headers.Cookie=`SWID=${own.swid}; espn_s2=${own.s2}`;
 try{
  const response=await fetcher(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/${config.fantasy}/seasons/${season}/segments/0/leagues/${id}?view=mTeam&view=mRoster&view=mSettings&view=mMatchup&view=mMatchupScore&view=mLiveScoring`,{headers,redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(response.status>=300&&response.status<400)return sportJSON({error:'Reconnect ESPN with fresh credentials.',code:'ESPN_REDIRECT'},401);
  if([401,403,404].includes(response.status))return sportJSON({error:response.status===404?'ESPN could not find this league for the selected sport and season.':'This league requires your current ESPN SWID and espn_s2 cookies.',code:'ESPN_DENIED'},response.status===404?404:401);
  if(!response.ok)throw new Error('upstream');const raw=await response.json();
  const teams=await sportMetadata(input.sport,season,fetcher);return sportJSON({...normalizeSportLeague(raw,input.sport,teams,own?.swid),sport:input.sport,leagueId:id,season,fetchedAt:Date.now()});
 }catch{return sportJSON({error:'ESPN could not return this league right now. Check the connection and retry.'},502);}
}
