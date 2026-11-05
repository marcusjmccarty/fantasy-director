import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePreferences} from '../web/preferences.js';
import {parseRoster,streamType} from '../web/roster.js';
const roster=[{name:'Jonathan Taylor',team:'IND',position:'RB'}];
test('valid saved lineups from before lineupReady existed remain usable',()=>{
 const saved=normalizePreferences({roster,teamName:'My team',leagueId:'123',teamId:'2',delay:45,muted:true,streams:{'IND-MIN':'https://example.com/a.m3u8'}});
 assert.deepEqual(saved.roster,roster);assert.equal(saved.lineupReady,true);assert.equal(saved.delay,45);assert.equal(saved.muted,true);assert.equal(saved.streams['IND-MIN'],'https://example.com/a.m3u8');
 assert.deepEqual(normalizePreferences(saved),saved,'normalizing twice must not erase a valid preference');
});
test('damaged saved fields cannot corrupt independent preferences',()=>{
 const saved=normalizePreferences({roster,teamName:'My team',streams:{'IND-MIN':'javascript:alert(1)','DAL-NYG':'https://example.com/g.mp4'},marks:{A:null,B:[null,{wall:100,media:70},{wall:'bad',media:20}]},league:{teams:'bad'},muted:'false',delay:NaN});
 assert.equal(saved.lineupReady,true);assert.equal(saved.league,null);assert.equal(saved.muted,false);assert.equal(saved.delay,30);assert.deepEqual(Object.keys(saved.streams),['DAL-NYG']);assert.deepEqual(saved.marks.B,[{wall:100,media:70}]);
 for(const value of [null,[],true,'bad',{roster:[null],teamName:'My team',lineupReady:true}])assert.equal(normalizePreferences(value).lineupReady,false);
});
test('cached imported franchises retain valid starters and discard malformed teams',()=>{
 const saved=normalizePreferences({roster,teamName:'My team',leagueId:'123',league:{name:'League',teams:[null,{id:'1',name:'My team',players:roster},{id:'2',name:'Empty',players:[]},{id:'3',players:[null]}]}});
 assert.deepEqual(saved.league.teams.map(t=>t.id),['1','2']);assert.deepEqual(saved.league.teams[0].players,roster);
});
test('a duplicate starter is rejected instead of increasing ranking and scoring credit',()=>{
 assert.throws(()=>parseRoster('Jonathan Taylor, IND, RB\njonathan taylor, IND, RB'),/appears twice/);
 try{parseRoster('Jonathan Taylor, , RB');assert.fail('must reject');}catch(error){assert.equal(error.line,1);assert.equal(error.field,1);}
});
test('direct video links with fragments retain their native player type',()=>{
 assert.equal(streamType('https://example.com/game.m3u8#live'),'application/vnd.apple.mpegurl');assert.equal(streamType('https://example.com/game.mp4#t=30'),'video/mp4');assert.equal(streamType('https://example.com/watch?id=123'),'embed/page');
});
test('automatic embed reconnect defaults off and preserves an explicit opt-in',()=>{
 assert.equal(normalizePreferences({}).autoReconnect,false);assert.equal(normalizePreferences({autoReconnect:true,prefsVersion:2}).autoReconnect,true);assert.equal(normalizePreferences({autoReconnect:true}).autoReconnect,false,'an older save held the old default, not a choice');assert.equal(normalizePreferences({}).prefsVersion,2);assert.equal(normalizePreferences({autoReconnect:false}).autoReconnect,false);
});
test('backup links migrate independently, reject unsafe URLs and survive repeated preference normalization',()=>{
 const saved=normalizePreferences({streams:{'IND-MIN':'https://streamcorner.st/stream/test'},streamBackups:{'IND-MIN':'https://another.example/watch','DAL-NYG':'javascript:bad','bad-key':'https://example.test/live'}});
 assert.deepEqual(saved.streamBackups,{'IND-MIN':'https://another.example/watch'});assert.equal(saved.streams['IND-MIN'],'https://streamcorner.st/stream/test');assert.deepEqual(normalizePreferences(saved),saved);
 assert.deepEqual(normalizePreferences({streamBackups:['https://example.test/live']}).streamBackups,{});
});

test('the video a saved length was measured on survives a save, and a damaged one does not',()=>{
 const saved=normalizePreferences({replayDurations:{'1':8000},replayDurationEmbeds:{'1':'https://ok.ru/videoembed/123','2':'https://evil.test/videoembed/1',bad:'https://ok.ru/videoembed/1','3':7}});
 assert.deepEqual(saved.replayDurationEmbeds,{'1':'https://ok.ru/videoembed/123'});assert.deepEqual(normalizePreferences(saved),saved);assert.deepEqual(normalizePreferences({}).replayDurationEmbeds,{});
});
