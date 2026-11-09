import test from 'node:test';
import assert from 'node:assert/strict';
import {espnURL,normalizeHighlights,mergeHighlights,highlightView,relevance} from '../highlights.js';
const now=1000000,game={id:'123',name:'CHI @ GB'};
const raw={videos:[{id:20,headline:'Caleb Williams throws a touchdown',duration:38,categories:[{type:'athlete',athlete:{id:10}},{type:'team',team:{id:3}}],links:{web:{href:'https://www.espn.com/video/clip/_/id/20'}}}],scoringPlays:[{id:30,text:'Touchdown pass to Another Player.',type:{text:'Passing touchdown'},participants:[{athlete:{id:11}}],period:{number:2},clock:{displayValue:'5:00'},team:{id:3}}],plays:[{id:30,scoringPlay:true,text:'Touchdown pass to Another Player.',type:{text:'Passing touchdown'}},{id:31,statYardage:28,text:'A long run.',type:{text:'Rush'}},{id:32,statYardage:2,text:'Short run',type:{text:'Rush'}}]};
test('clips and play descriptions are distinct, play IDs deduplicate, and short plays stay out',()=> {
 const h=normalizeHighlights(raw,game,now);assert.equal(h.length,3);
 assert.equal(h[0].kind,'clip');assert.match(h[0].url,/espn.com/);
 assert.equal(h[1].kind,'play');assert.equal(h[1].url,'https://www.espn.com/nfl/playbyplay/_/gameId/123');assert.ok(!h.some(x=>x.id.endsWith(':32')));
});
test('only HTTPS ESPN destinations are accepted',()=> {
 for(const u of ['javascript:alert(1)','http://www.espn.com/','https://espn.com.evil.test/','https://user:pass@www.espn.com/','https://evil.test/'])assert.equal(espnURL(u),null);
 assert.equal(espnURL('https://www.espn.com/video/clip/_/id/20'),'https://www.espn.com/video/clip/_/id/20');
});
test('full name and athlete matches are distinguished from team relevance and substring collisions',()=> {
 const h=normalizeHighlights(raw,game,now)[0];
 assert.equal(relevance(h,[{id:'10',name:'Renamed Athlete',teamId:'9'}]).tier,'player');
 assert.equal(relevance({...h,athleteIds:[]},[{id:'99',name:'Caleb Williams',teamId:'9'}]).tier,'player');
 assert.equal(relevance(h,[{id:'99',name:'Caleb William',teamId:'9'}]).tier,'league');
 assert.equal(relevance(h,[{id:'99',name:'Someone Else',teamId:'3'}]).tier,'team');
});
test('repeated polling preserves opened state and first-seen time without duplicates',()=> {
 let h=normalizeHighlights(raw,game,now);h[0].opened=true;
 const merged=mergeHighlights(h,normalizeHighlights(raw,game,now+30000),now+30000);
 assert.equal(merged.length,3);assert.equal(merged.find(x=>x.id==='clip:20').opened,true);assert.equal(merged[0].discoveredAt,now);
});
test('delay buffer hides new highlights, old entries expire, and list size is bounded',()=> {
 const h=normalizeHighlights(raw,game,now);
 assert.equal(highlightView(h,[],30,now+29000).length,0);assert.equal(highlightView(h,[],30,now+30000).length,3);
 assert.equal(mergeHighlights(h,[],now+49*3600000).length,0);
 assert.equal(mergeHighlights([],Array.from({length:200},(_,i)=>({...h[0],id:String(i)})),now).length,160);
});
test('malformed summary fails visibly, legitimate no-video summary remains empty',()=> {
 assert.throws(()=>normalizeHighlights({unexpected:true},game));assert.deepEqual(normalizeHighlights({header:{}},game),[]);
});
test('live ESPN drive shape supplies big plays and links even when videos is empty',()=> {
 // Structure and sample values observed from DEN @ ARI on 2026-10-25,
 // summary?event=401873019. Video clips were empty in that live response.
 const observed={videos:[],header:{links:[{rel:['pbp','desktop','event'],href:'https://www.espn.com/nfl/playbyplay/_/gameId/401873019'}]},scoringPlays:[{id:'401873019292',type:{id:'59',text:'Field Goal Good'},text:'Wil Lutz 48 Yd Field Goal',period:{number:1},clock:{displayValue:'11:00'},team:{id:'7'}}],drives:{previous:[{plays:[{id:'40187301940',type:{text:'Kickoff'},text:'C.Ryland kicks 63 yards from ARZ 35 to DEN 2. M.Mims pushed ob at DEN 41 for 39 yards (K.Sharar).',statYardage:39,wallclock:'2026-10-25T20:05:45Z',period:{number:1},clock:{displayValue:'15:00'},teamParticipants:[{id:'7',type:'offense'},{id:'22',type:'defense'}]}]}],current:{plays:[]}}};
 const items=normalizeHighlights(observed,{id:'401873019',name:'DEN @ ARI'});
 assert.equal(items.length,2);assert.ok(items.every(h=>h.kind==='play'));assert.ok(items.every(h=>h.url===observed.header.links[0].href));assert.deepEqual(items[1].teamIds,['7','22']);
});
test('a published ESPN video URL works without a numeric ID; an unrelated URL cannot become a clip',()=> {
 const items=normalizeHighlights({videos:[{headline:'Published clip',links:{web:{href:'https://www.espn.com/video/clip/_/id/123'}}},{headline:'Bad link',links:{web:{href:'https://evil.test/'}}}]},game,now);
 assert.equal(items.length,1);assert.equal(items[0].url,'https://www.espn.com/video/clip/_/id/123');
});
