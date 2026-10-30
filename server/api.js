const TEAM={1:'ATL',2:'BUF',3:'CHI',4:'CIN',5:'CLE',6:'DAL',7:'DEN',8:'DET',9:'GB',10:'TEN',11:'IND',12:'KC',13:'LV',14:'LAR',15:'MIA',16:'MIN',17:'NE',18:'NO',19:'NYG',20:'NYJ',21:'PHI',22:'ARI',23:'PIT',24:'LAC',25:'SF',26:'SEA',27:'TB',28:'WAS',29:'CAR',30:'JAC',33:'BAL',34:'HOU'};
const POS={1:'QB',2:'RB',3:'WR',4:'TE',5:'K',16:'D/ST'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Sites dispatch supplies a Site-scoped identity. Account UUIDs are not interchangeable.
function isOwner(request,env){
 const userId=request.headers.get('oai-authenticated-user-id');
 if(userId&&env.ESPN_OWNER_ID&&userId===env.ESPN_OWNER_ID)return true;
 // A local preview has no identity header; its env.json is the owner's own machine.
 try{return !userId&&LOOPBACK.has(new URL(request.url).hostname)&&!!env.ESPN_LOCAL;}catch{return false;}
}
// Cookies pasted by the viewer for their own private league travel with the request and are used once.
function ownCookies(data){
 const swid=String(data.swid||'').trim(),s2=String(data.s2||'').trim();
 if(!swid||!s2)return null;
 if(!/^\{?[0-9A-Fa-f-]{36}\}?$/.test(swid)||s2.length>2048||/[\s;]/.test(s2))throw new Error('The ESPN cookies look wrong: SWID is a {GUID} and espn_s2 is one long token.');
 return {swid:swid.startsWith('{')?swid:`{${swid}}`,s2};
}
// Same origin, treating the loopback names as one host for local previews.
const LOOPBACK=new Set(['localhost','127.0.0.1','[::1]']);
export function sameSite(origin,url){
 try{const a=new URL(origin),b=new URL(url);return a.origin===b.origin||LOOPBACK.has(a.hostname)&&LOOPBACK.has(b.hostname)&&a.port===b.port;}catch{return false;}
}
export function sessionAPI(request,env={}){
 if(request.method!=='GET')return json({error:'Use GET.'},405);
 const userId=request.headers.get('oai-authenticated-user-id')||null;
 return json({userId,savedLeagueId:isOwner(request,env)&&env.ESPN_SWID&&env.ESPN_S2?env.ESPN_LEAGUE_ID:null});
}
export function normalizedLeague(raw,ownerSwid=''){
 if(!Array.isArray(raw.teams)||!raw.teams.length)throw new Error('No teams returned');
 return {name:raw.settings?.name||'ESPN league',week:raw.scoringPeriodId||0,ownedTeamId:ownerSwid?String(raw.teams.find(t=>t.owners?.some(x=>String(x).toUpperCase()===ownerSwid.toUpperCase()))?.id||''):'',teams:raw.teams.map(t=>({id:String(t.id),name:t.name||[t.location,t.nickname].filter(Boolean).join(' ')||t.abbrev||`Team ${t.id}`,players:(t.roster?.entries||[]).filter(e=>![20,21].includes(Number(e.lineupSlotId))).map(e=>{const p=e.playerPoolEntry?.player||{};return{id:String(p.id||''),name:p.fullName||'',team:TEAM[p.proTeamId]||'',position:POS[p.defaultPositionId]||''};}).filter(p=>p.name&&p.team&&p.position)}))};
}
export async function leagueAPI(request,env={},fetcher=fetch){
 if(request.method!=='POST')return json({error:'Use POST.'},405);
 const origin=request.headers.get('Origin');if(origin&&!sameSite(origin,request.url))return json({error:'Invalid request origin.'},403);
 let data;try{if(Number(request.headers.get('Content-Length')||0)>1024)return json({error:'Request too large.'},413);const text=await request.text();if(text.length>1024)return json({error:'Request too large.'},413);data=JSON.parse(text);}catch{return json({error:'Enter a valid league ID.'},400);}
 const id=String(data.leagueId||'');const now=new Date();const season=now.getUTCFullYear()-(now.getUTCMonth()<5?1:0);const year=Number(data.season||season);
 if(!/^\d{1,12}$/.test(id)||!Number.isInteger(year)||year<2018||year>season+1)return json({error:'Enter a numeric ESPN league ID.'},400);
 const week=data.week==null?null:Number(data.week);
 if(week!==null&&(!Number.isInteger(week)||week<1||week>25))return json({error:'Choose a valid scoring week.'},400);
 let own;try{own=ownCookies(data);}catch(error){return json({error:error.message},400);}
 const owner=isOwner(request,env);
 if(id===env.ESPN_LEAGUE_ID&&!owner&&!own)return json({error:'The saved ESPN connection is not linked to this signed-in session.',code:'CONNECTION_IDENTITY'},403);
 const useSaved=!own&&!!(owner&&id===env.ESPN_LEAGUE_ID&&env.ESPN_SWID&&env.ESPN_S2);
 if(!own&&owner&&id===env.ESPN_LEAGUE_ID&&!useSaved)return json({error:'The saved ESPN connection is missing its access credentials.',code:'CONNECTION_MISSING'},503);
 const headers={Accept:'application/json'};
 if(own)headers.Cookie=`SWID=${own.swid}; espn_s2=${own.s2}`;else if(useSaved)headers.Cookie=`SWID=${env.ESPN_SWID}; espn_s2=${env.ESPN_S2}`;
 const signedIn=!!(own||useSaved);
 // Workers throws synchronously for redirect:'error'. Manual also prevents cookie forwarding.
 try{const response=await fetcher(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${year}/segments/0/leagues/${id}?view=mRoster&view=mTeam&view=mSettings${week===null?'':'&scoringPeriodId='+week}`,{headers,redirect:'manual',signal:AbortSignal.timeout(12000)});
 if(response.status>=300&&response.status<400)return json({error:'ESPN redirected the roster request. Your saved ESPN login may need refreshing.',code:'ESPN_REDIRECT'},502);
 if([401,403,404].includes(response.status))return json({error:response.status===404?'ESPN has no league with that ID for this season.':signedIn?'ESPN would not open this league with those cookies. Copy fresh SWID and espn_s2 values from a browser where you are signed in to ESPN.':'This league is private. Paste your ESPN SWID and espn_s2 cookies below the league ID to import it.',code:signedIn?'ESPN_DENIED':'LEAGUE_PRIVATE'},response.status===404?404:401);
 if(!response.ok)return json({error:'ESPN is temporarily unavailable. Please try again.'},502);
 const raw=await response.json();if(!raw.teams?.length)return json({error:signedIn?'ESPN did not return your roster. The cookies may have expired.':'ESPN did not return this league. Check the ID and league visibility.'},422);
 return json({...normalizedLeague(raw,own?own.swid:useSaved?env.ESPN_SWID:''),leagueId:id,season:year});
 }catch(error){const timeout=error?.name==='TimeoutError'||error?.name==='AbortError';return json({error:timeout?'ESPN took too long to respond. Try importing again.':'The roster service could not reach ESPN. Try importing again.',code:timeout?'ESPN_TIMEOUT':'ESPN_NETWORK'},timeout?504:502);}
}
