import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSportLeague,sportsLeagueAPI,sportsScoreboardAPI,SPORT_SERVICES,validSportDate} from '../server/sports.js';
import {normalizeSportGames,normalizeSportPreferences,chooseSportGame,sportMatchup,localDate} from '../web/sports-data.js';
const event=(id='1',extra={})=>({id,date:'2026-11-01T22:00Z',shortName:'A @ B',season:{year:2027},competitions:[{status:{period:4,type:{state:'in',name:'STATUS_IN_PROGRESS',shortDetail:'4th 2:10'}},competitors:[{homeAway:'home',team:{id:'2',abbreviation:'B',displayName:'Home'},score:'99'},{homeAway:'away',team:{id:'1',abbreviation:'A',displayName:'Away'},score:'100'}],...extra}]});
const entry=(id,slot,points)=>({lineupSlotId:slot,playerPoolEntry:{appliedStatTotal:999,player:{id,fullName:'Player '+id,proTeamId:1,defaultPositionId:1,stats:[{scoringPeriodId:0,statSourceId:0,statSplitTypeId:0,appliedTotal:999},{scoringPeriodId:13,statSourceId:1,statSplitTypeId:1,appliedTotal:44},{scoringPeriodId:13,statSourceId:0,statSplitTypeId:1,appliedTotal:points}]}}});
const league=(sport='nba',scoringType='H2H_POINTS')=>({scoringPeriodId:13,status:{currentMatchupPeriod:2},settings:{name:'Test league',scoringSettings:{scoringType}},teams:[{id:1,name:'My team',owners:['{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}'],roster:{entries:[entry(1,0,12.5),entry(2,SPORT_SERVICES[sport].bench[0],100)]}},{id:2,name:'Opponent',roster:{entries:[entry(3,0,-2)]}}],schedule:[{id:1,matchupPeriodId:1,home:{teamId:1,totalPoints:900},away:{teamId:2,totalPoints:900}},{id:2,matchupPeriodId:2,home:{teamId:1,totalPoints:120,totalPointsLive:0},away:{teamId:2,totalPoints:118.5}}]});
const pro=[{id:1,abbrev:'ATL'}];
test('daily schedules preserve home/away scores, sport identity and baseball doubleheaders',()=>{
 for(const sport of ['nba','nhl','mlb']){const games=normalizeSportGames({events:[event('11'),event('12')],season:2027},sport);assert.deepEqual(games[0].teams.map(t=>t.score),[100,99]);assert.equal(games[0].key,sport+':11');assert.notEqual(games[0].key,games[1].key);assert.equal(games[0].season,2027);}
 assert.deepEqual(normalizeSportGames({events:[event()]},'__proto__'),[]);
});
test('postponed and intermission games cannot be mistaken for live action',()=>{
 for(const name of ['STATUS_POSTPONED','STATUS_DELAYED','STATUS_CANCELED','STATUS_SUSPENDED']){const [g]=normalizeSportGames({events:[event('1',{status:{type:{state:'in',name}}})]},'mlb');assert.equal(g.state,'hold');assert.equal(g.onBreak,true);}
 for(const name of ['STATUS_HALFTIME','STATUS_END_PERIOD','STATUS_INTERMISSION']){const [g]=normalizeSportGames({events:[event('1',{status:{type:{state:'in',name}}})]},'nhl');assert.equal(g.onBreak,true);}
});
test('all new fantasy sports use official matchup totals and dated actual player stats',()=>{
 for(const sport of ['nba','nhl','mlb']){const data=normalizeSportLeague(league(sport),sport,pro,'{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}');assert.equal(data.ownedTeamId,'1');assert.equal(data.teams[0].players[0].points,12.5);assert.equal(data.teams[0].players[0].active,true);assert.equal(data.teams[0].players[1].active,false);assert.equal(data.teams[0].players[0].team,'ATL');const match=sportMatchup(data,'1');assert.equal(match.yourPoints,0);assert.equal(match.opponentPoints,118.5);assert.equal(match.opponent.name,'Opponent');assert.equal(sportMatchup(data,'2').yourPoints,118.5);}
});
test('missing current-day stats cannot use cumulative pool or projection totals',()=>{
 const raw=league();raw.teams[0].roster.entries[0].playerPoolEntry.player.stats.pop();assert.equal(normalizeSportLeague(raw,'nba',pro).teams[0].players[0].points,null);
});
test('category and rotisserie leagues never manufacture fantasy point totals',()=>{
 for(const type of ['ROTO','H2H_CATEGORY','H2H_MOST_CATEGORIES','WEEKLY_ALL_PLAY_CATEGORY']){const data=normalizeSportLeague(league('nba',type),'nba',pro);assert.equal(data.isPoints,false);assert.equal(data.teams[0].players[0].points,null);assert.equal(sportMatchup(data,'1').yourPoints,null);}
});
test('matchups support bye weeks, multiple opponents and lineup snapshots',()=>{
 const raw=league();raw.schedule[1].home.rosterForCurrentScoringPeriod={entries:[entry(90,0,8)]};raw.schedule.push({id:3,matchupPeriodId:2,home:{teamId:1,totalPoints:8}});const data=normalizeSportLeague(raw,'nba',pro);assert.equal(data.teams[0].players[0].id,'90');assert.equal(sportMatchup(data,'1').matches.length,2);assert.equal(sportMatchup(data,'1','3').opponent,null);
});
test('sports preferences reject unsafe links and preserve independent event links and zero delay',()=>{
 const p=normalizeSportPreferences({streams:{'nba:1':{primary:'javascript:alert(1)',backup:'https://example.com/a.m3u8'},'mlb:1':{primary:'https://example.com/first'},'mlb:2':{primary:'https://example.com/second'},'__proto__':{primary:'https://example.com'}},delay:0,leagueId:'123',teamId:'2',leagueSeason:2027});assert.equal(p.streams['nba:1'].primary,undefined);assert.equal(p.streams['nba:1'].backup,'https://example.com/a.m3u8');assert.notEqual(p.streams['mlb:1'].primary,p.streams['mlb:2'].primary);assert.equal(p.delay,0);assert.equal(p.leagueSeason,2027);
});
test('automatic selection follows fantasy teams, respects manual viewing and waits for breaks',()=>{
 const games=normalizeSportGames({events:[event('1'),event('2',{competitors:[{team:{id:'3'},score:'1'},{team:{id:'4'},score:'2'}]})]},'nba');const streams={'nba:1':{primary:'https://a.test'},'nba:2':{primary:'https://b.test'}};
 assert.equal(chooseSportGame(games,{streams,followed:['3']}).id,'2');assert.equal(chooseSportGame(games,{streams,followed:['3'],currentId:'1',lastSwitch:1,now:999999}).id,'1');
 games[0].onBreak=true;assert.equal(chooseSportGame(games,{streams,followed:['3'],currentId:'1',manual:true,lastSwitch:1,now:999999}).id,'2');
 games[1].state='post';assert.equal(chooseSportGame(games,{streams}),null);
});
test('a game with no primary can still use its backup; blocked streams are not selected',()=>{
 const games=normalizeSportGames({events:[event()]},'nhl'),streams={'nhl:1':{backup:'https://example.test'}};assert.equal(chooseSportGame(games,{streams}).id,'1');assert.equal(chooseSportGame(games,{streams,blocked:new Set(['1'])}),null);
});
test('calendar dates reject rollover and the scoreboard always requests the exact chosen day',async()=>{
 assert.equal(validSportDate('2026-02-30'),false);assert.equal(validSportDate('2026-11-01'),true);assert.equal(localDate(new Date(2026,10,1,23,30)),'2026-11-01');let called='';
 const response=await sportsScoreboardAPI(new Request('https://site.test/api/sports?sport=mlb&date=2026-11-01'),async url=>{called=url;return Response.json({season:{year:2026},events:[]});});assert.equal(response.status,200);assert.match(called,/baseball\/mlb\/scoreboard\?dates=20261101&limit=100$/);assert.deepEqual((await response.json()).events,[]);
 for(const sport of ['__proto__','constructor','nfl','https://evil.test'])assert.equal((await sportsScoreboardAPI(new Request('https://site.test/api/sports?sport='+sport+'&date=2026-11-01'))).status,400);
});
test('fantasy endpoint isolates cookies to the chosen league origin and fetches public team metadata separately',async()=>{
 const calls=[];const response=await sportsLeagueAPI(new Request('https://site.test/api/sports/league',{method:'POST',headers:{Origin:'https://site.test'},body:JSON.stringify({sport:'nba',leagueId:'123',season:2027,swid:'{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}',s2:'test-token'})}),async(url,options)=>{calls.push({url,options});return Response.json(url.includes('/leagues/')?league():{settings:{proTeams:pro}});});assert.equal(response.status,200);assert.match(calls[0].url,/games\/fba\/seasons\/2027\/segments\/0\/leagues\/123/);assert.match(calls[0].options.headers.Cookie,/SWID=/);assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[1].options.headers,undefined);const data=await response.json();assert.equal(data.sport,'nba');assert.equal(data.leagueId,'123');assert.equal(data.season,2027);
});
test('fantasy endpoint rejects foreign origins and malformed payloads without reaching ESPN',async()=>{
 const fetcher=()=>{throw new Error('Should not fetch');};
 for(const [payload,status] of [[null,400],[{sport:'constructor',leagueId:'1',season:2027},400],[{sport:'nba',leagueId:'1',season:2027,swid:'bad',s2:'bad'},400]]){const r=await sportsLeagueAPI(new Request('https://site.test/api/sports/league',{method:'POST',body:JSON.stringify(payload)}),fetcher);assert.equal(r.status,status);}
 assert.equal((await sportsLeagueAPI(new Request('https://site.test/api/sports/league',{method:'POST',headers:{Origin:'https://evil.test'},body:'{}'}),fetcher)).status,403);
});
test('fantasy redirects cannot forward session cookies and show reconnect instead',async()=>{
 let calls=0;const response=await sportsLeagueAPI(new Request('https://site.test/api/sports/league',{method:'POST',body:JSON.stringify({sport:'nhl',leagueId:'123',season:2027})}),async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://evil.test'}});});assert.equal(response.status,401);assert.equal(calls,1);assert.equal((await response.json()).code,'ESPN_REDIRECT');
});
test('scoreboard fetch works at the Cloudflare edge and rejects upstream redirects',async()=>{
 let calls=0;
 const edgeFetch=async(url,options)=>{calls++;if(!['follow','manual'].includes(options.redirect))throw new TypeError('Invalid redirect value at the edge');assert.equal(options.redirect,'manual');return calls===1?Response.json({events:[]}):new Response(null,{status:302,headers:{Location:'https://elsewhere.test'}});};
 const request=new Request('https://site.test/api/sports?sport=nhl&date=2026-11-01');
 assert.equal((await sportsScoreboardAPI(request,edgeFetch)).status,200);
 const redirected=await sportsScoreboardAPI(request,edgeFetch);assert.equal(redirected.status,502);assert.equal((await redirected.json()).code,'ESPN_HTTP_302');assert.equal(calls,2);
});
