import test from 'node:test';
import assert from 'node:assert/strict';
import {liveClipCandidates,highlightPage,canRetryReplay} from '../web/live-highlights.js';
const kickoff=Date.parse('2026-11-01T18:00:00Z'),now=kickoff+3600000;
const score={id:'A:1',at:(kickoff+1200000)/1000,kind:'TD',text:'Jonathan Taylor 4 Yd Rush',players:[{name:'Jonathan Taylor',role:'scorer'}]};
const game={id:'A',date:new Date(kickoff).toISOString(),season:2026,week:8,teams:[{abbr:'IND',name:'Indianapolis Colts'},{abbr:'MIN',name:'Minnesota Vikings'}],scores:[score]};
const item={id:score.id,gameId:game.id,score,at:score.at};
const clip={id:'clip',kind:'nfl',title:'Taylor reaches the end zone',description:'Indianapolis Colts running back Jonathan Taylor scores a 4-yard touchdown.',teams:['IND'],athletes:['Jonathan Taylor'],publishedAt:score.at*1000+120000,short:true,url:'https://www.nfl.com/videos/taylor-scores'};
const match=(c=clip,games=[game],options={})=>liveClipCandidates(item,[c],games,{now,...options});

test('an unscoped NFL clip joins through publication time, team, player and scoring distance',()=>{
 const found=match();assert.equal(found.length,1);assert.equal(found[0].gameId,'A');assert.equal(found[0].association,'time-team-score');assert.equal(clip.gameId,undefined);
});
test('explicit season, week and both teams can associate a clip without a timestamp',()=>{
 const c={...clip,publishedAt:0,season:2026,week:8,teams:['IND','MIN']};assert.equal(match(c)[0].association,'season-week-teams-score');
 for(const patch of [{season:2025},{week:7},{week:undefined},{teams:['IND']}])assert.equal(match({...c,...patch}).length,0);
});
test('discovery time, missing dates, old clips, future dates and conflicting teams are rejected',()=>{
 for(const patch of [{publishedAt:0},{publishedAt:undefined,discoveredAt:now},{publishedAt:score.at*1000-86400000},{publishedAt:now+3600000},{teams:['IND','GB']},{description:clip.description+' During the 2025 NFL season.'}])assert.equal(match({...clip,...patch}).length,0,JSON.stringify(patch));
});
test('incorrect yardage, incomplete identity, nonscoring plays, reels and negated scores cannot match',()=>{
 for(const patch of [
  {description:'Jonathan Taylor scores a 9-yard touchdown.'},
  {description:'A runner scores a 4-yard touchdown.',title:'A touchdown',athletes:[]},
  {description:'Jonathan Taylor runs for 4 yards.',title:'Taylor gets a first down'},
  {title:'Every Jonathan Taylor touchdown'},
  {title:'Jonathan Taylor 4-yard touchdown overturned'},
  {title:'Jonathan Taylor stopped short of the goal line on a 4-yard run'},
  {title:'Jonathan Taylor makes a touchdown-saving tackle'},
  {description:'Jonathan Taylor scores a touchdown.',title:'Taylor touchdown'}
 ])assert.equal(match({...clip,...patch}).length,0,JSON.stringify(patch));
});
test('two similar scores or two possible matchups are ambiguous rather than two uses of a clip',()=>{
 const repeated={...score,id:'A:2',at:score.at+300};assert.equal(match(clip,[{...game,scores:[score,repeated]}]).length,0);
 assert.equal(match(clip,[game,{...game,id:'B'}]).length,0);
});
test('a corrected score cannot borrow the unique clip match belonging to another score',()=>{
 const corrected={...score,text:'Jonathan Taylor 9 Yd Rush'},other={...score,id:'A:other'};
 assert.equal(match(clip,[{...game,scores:[corrected,other]}]).length,0);
});
test('game-specific ESPN clips use descriptions while preserving expiry and device restrictions',()=>{
 const c={...clip,kind:'clip',gameId:'A',publishedAt:0,mediaUrl:'https://espnmedia-cdn.akamaized.net/a.mp4'};assert.equal(match(c).length,1);
 for(const patch of [{gameId:'B'},{expiresAt:now-1},{embargoAt:now+1},{desktopAllowed:false},{inlinePlayable:false}])assert.equal(match({...c,...patch}).length,0);
 assert.equal(match({...c,inlinePlayable:false,expiresAt:now-1},[game],{allowUnavailable:true}).length,1,'the publisher page can remain usable when direct playback is not');
});
test('used and failed clips are excluded but an interrupted score may reuse its own clip',()=>{
 assert.equal(match(clip,[game],{used:new Map([['clip','other-score']])}).length,0);
 assert.equal(match(clip,[game],{used:new Map([['clip',item.id]])}).length,1);
 assert.equal(match(clip,[game],{failed:new Map([['clip',now+1000]])}).length,0);
 assert.equal(match(clip,[game],{failed:new Map([['clip',now-1]])}).length,1);
});
test('a missed field goal cannot stand in for a successful field goal',()=>{
 const s={...score,kind:'FG',text:'Test Kicker 45 Yd Field Goal',players:[{name:'Test Kicker',role:'kicker'}]},c={...clip,title:'Test Kicker misses a 45-yard field goal',description:'',athletes:['Test Kicker'],gameId:'A'};
 assert.equal(liveClipCandidates({...item,score:s},[c],[{...game,scores:[s]}],{now}).length,0);
});
test('publication pages are restricted to the publishers and retry windows remain bounded',()=>{
 assert.equal(highlightPage(clip.url),clip.url);
 for(const url of ['javascript:alert(1)','https://nfl.com.attacker.test/video','https://user:secret@www.nfl.com/videos/a','http://www.espn.com/','https://www.nfl.com:8443/a'])assert.equal(highlightPage(url),null);
 assert.equal(canRetryReplay(item,score.at+1799),true);assert.equal(canRetryReplay(item,score.at+1801),false);assert.equal(canRetryReplay({...item,seen:true},score.at+10),false);assert.equal(canRetryReplay({...item,status:'replayed'},score.at+10),false);
});
