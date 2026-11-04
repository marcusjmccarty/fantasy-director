import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNFLReplayListing,parseWatchLinks,okEmbedIn,nflReplayWeekAPI} from '../server/replays.js';

const listing=`<a href="/chicago-bears-vs-seattle-seahawks-full-game-replay-nfl-week-08-november-2-2026">CHI vs SEA</a>
<a href="https://nfl-video.com/miami-dolphins-vs-baltimore-ravens-full-game-replay-nfl-week-08-october-30-2026">MIA vs BAL</a>
<a href="/chicago-bears-vs-seattle-seahawks-full-game-replay-nfl-week-08-november-2-2026">again</a>
<a href="/green-bay-packers-vs-pittsburgh-steelers-full-game-replay-nfl-week-07-october-26-2026">week 7</a>`;
const gamePage=`<h1>Replay</h1><div id="video-player"><p>Pick a source</p><a href="https://nhlgamestoday.com/go/abc"><span>Watch</span></a><a href="https://nfl-video.com/other-week-08-x">Watch</a><a href="https://example.test/x">Watch</a><a href="https://nbaontv.com/go/def">Watch now</a></div>`;
const watchPage=`<html><body><iframe src="https://ok.ru/videoembed/1234567890?nochat=1"></iframe></body></html>`;

test('parseNFLReplayListing keeps one game page per matchup for the padded week',()=>{
 const games=parseNFLReplayListing(listing,8);
 assert.deepEqual(games.map(g=>[g.away,g.home]),[['chicago-bears','seattle-seahawks'],['miami-dolphins','baltimore-ravens']]);
 assert.equal(games[0].page,'https://nfl-video.com/chicago-bears-vs-seattle-seahawks-full-game-replay-nfl-week-08-november-2-2026');
 assert.deepEqual(parseNFLReplayListing(listing,7).map(g=>g.away),['green-bay-packers']);
});
test('parseWatchLinks takes the Watch anchors inside the player block, off the listing site',()=>{
 assert.deepEqual(parseWatchLinks(gamePage),['https://nhlgamestoday.com/go/abc','https://nbaontv.com/go/def']);
 assert.deepEqual(parseWatchLinks('<a href="https://nhlgamestoday.com/x">Watch</a>'),[],'links outside the player block are ignored');
});
test('okEmbedIn finds the ok.ru player wherever the page carries it',()=>{
 assert.equal(okEmbedIn(watchPage),'https://ok.ru/videoembed/1234567890');
 assert.equal(okEmbedIn('<iframe src="https://ok.ru/video/12"></iframe>'),'');assert.equal(okEmbedIn(''),'');
});
test('nflReplayWeekAPI walks the listing, the game page and its Watch page to the embed',async()=>{
 const calls=[];
 const fetcher=async(url)=>{calls.push(url);
  if(url==='https://nfl-video.com/2026')return new Response(listing,{status:200});
  if(url.startsWith('https://nfl-video.com/2026?page'))return new Response('<a href="/x-vs-y-full-game-replay-nfl-week-01-september-7-2026">old</a>',{status:200});
  if(url.includes('chicago-bears-vs-seattle'))return new Response(gamePage,{status:200});
  if(url.includes('miami-dolphins-vs-baltimore'))return new Response('<div id="video-player"></div>',{status:200});
  if(url==='https://nhlgamestoday.com/go/abc')return new Response(watchPage,{status:200});
  return new Response('nope',{status:404});
 };
 const r=await nflReplayWeekAPI(new Request('https://fantasy.example/api/nfl-replays?week=8'),fetcher);
 const data=await r.json();
 assert.equal(data.week,8);assert.equal(data.games.length,2);
 assert.equal(data.games.find(g=>g.away==='chicago-bears').embed,'https://ok.ru/videoembed/1234567890');
 assert.equal(data.games.find(g=>g.away==='miami-dolphins').embed,'','a game without a Watch page has no video');
 assert.ok(!calls.includes('https://nfl-video.com/2026?page2'),'the walk stops once the listing shows an older week');
 const r1=await nflReplayWeekAPI(new Request('https://fantasy.example/api/nfl-replays?week=1'),fetcher);assert.equal((await r1.json()).games.length,1);assert.ok(calls.includes('https://nfl-video.com/2026?page2'),'a week further back reads the next page');
 const bad=await nflReplayWeekAPI(new Request('https://fantasy.example/api/nfl-replays?week=99'),fetcher);assert.equal(bad.status,400);
});
