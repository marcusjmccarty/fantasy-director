// Rebuilds web/week7.json from ESPN game summaries.
//   node scripts/build-archive.mjs [summaryDir]
// With no directory, summaries are fetched from ESPN's public site API.
// Replay provider metadata (embed, page, recordingDuration, verified sync
// anchors) is carried over from the existing archive.
import {readFile,writeFile} from 'node:fs/promises';
import {parseScoringPlay} from '../web/scoring.js';
import {RecordingSync,clockSpan} from '../web/sync.js';

const ARCHIVE=new URL('../web/week7.json',import.meta.url);
const dir=process.argv[2];
const previous=JSON.parse(await readFile(ARCHIVE,'utf8'));
const readings=JSON.parse(await readFile(new URL('./scorebug-anchors.json',import.meta.url),'utf8'));

async function summary(id){
 if(dir)return JSON.parse(await readFile(`${dir}/${id}.json`,'utf8'));
 const response=await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`);
 if(!response.ok)throw new Error(`ESPN summary ${id}: ${response.status}`);
 return response.json();
}
const tidy=text=>String(text||'').replace(/^\((?:Shotgun|No Huddle(?:, Shotgun)?|Punt formation|Field Goal formation|Kick formation)\)\s*/i,'').replace(/\s+/g,' ').trim();
const shortText=text=>{const t=tidy(text);return t.length>120?t.slice(0,117).replace(/\s+\S*$/,'')+'…':t;};

// ESPN's yardsToEndzone is unreliable on stoppages and some kicks; the
// possession text ("BAL 16") is not. Distance is from the offense's view.
function yardsToGoal(start,abbr){
 const m=/^([A-Z]+)\s+(\d{1,2})$/.exec(start.possessionText||'');
 if(m&&start.team)return m[2]==='50'?50:m[1]===abbr[String(start.team.id)]?100-Number(m[2]):Number(m[2]);
 if(start.possessionText==='50')return 50;
 const y=start.yardsToEndzone;return Number.isFinite(y)&&y>0&&y<=100?y:null;
}
// A scorebug reading taken while the clock was stopped could be anywhere in
// that stoppage. Readings with a running clock pin the recording on their own;
// the others are placed where that partial alignment says the footage was.
function resolveReadings(game,readings,typeNames){
 const spans=readings.map(([media,period,clock])=>({media,...clockSpan(game,period,clock),label:`Q${period} ${clock}`}));
 const exact=spans.filter(r=>r.hi-r.lo<=20).map(r=>({wall:Math.round((r.lo+r.hi)/2),media:r.media}));
 const guide=new RecordingSync(game,{types:typeNames,anchors:exact});
 const anchors=spans.map(r=>{
  if(r.hi-r.lo<=20)return {wall:Math.round((r.lo+r.hi)/2),media:r.media};
  let best=r.lo,error=Infinity;
  for(let w=r.lo;w<=r.hi;w++){const e=Math.abs(guide.media(w)-r.media);if(e<error){error=e;best=w;}}
  if(error>90)console.warn(`  ${game.name||''} ${r.label}: ${Math.round(error)}s from the running-clock alignment`);
  return {wall:best,media:r.media};
 }).sort((a,b)=>a.wall-b.wall);
 return anchors.filter((a,i)=>!i||a.wall>anchors[i-1].wall&&a.media>anchors[i-1].media);
}
const types=new Map();
const typeIndex=name=>{if(!types.has(name))types.set(name,types.size);return types.get(name);};
const games=[];let playCount=0,scoreCount=0;
for(const meta of previous.games){
 const raw=await summary(meta.id);
 const competitors=raw.header.competitions[0].competitors;
 const away=competitors.find(c=>c.homeAway==='away'),home=competitors.find(c=>c.homeAway==='home');
 const teamIds=[String(away.team.id),String(home.team.id)];
 const side=id=>teamIds.indexOf(String(id??''));
 const abbr=Object.fromEntries([away,home].map(c=>[String(c.team.id),c.team.abbreviation]));
 const plays=(raw.drives?.previous||[]).flatMap(d=>d.plays).filter(p=>p.wallclock).sort((a,b)=>Number(a.sequenceNumber)-Number(b.sequenceNumber));
 const kickoff=Date.parse(plays[0].wallclock)/1000;
 let last=0;const index=new Map();
 const rows=plays.map((p,i)=>{
  const t=Math.max(last,Math.round(Date.parse(p.wallclock)/1000-kickoff));last=t;index.set(String(p.id),i);
  const s=p.start||{},ytg=yardsToGoal(s,abbr);
  return [t,p.period?.number||0,p.clock?.displayValue||'',typeIndex(p.type?.text||'Play'),side(s.team?.id),s.down||0,s.distance||0,ytg,p.awayScore??0,p.homeScore??0,shortText(p.text)];
 });
 // ESPN's marker rows can carry a stale pre-conversion tally; a scoreboard never goes backwards.
 for(let k=1;k<rows.length;k++){rows[k][8]=Math.max(rows[k][8],rows[k-1][8]);rows[k][9]=Math.max(rows[k][9],rows[k-1][9]);}
 const scores=[];
 for(const s of raw.scoringPlays||[]){
  const i=index.get(String(s.id));if(i===undefined)continue;
  const team=side(s.team?.id),offense=rows[i][4];
  const parsed=parseScoringPlay(s.text,s.type?.text,s.scoringType?.name);
  scores.push({i,t:rows[i][0],team,kind:parsed.kind,defensive:team>=0&&offense>=0&&team!==offense||parsed.defensive,text:s.text.trim(),players:parsed.players,away:s.awayScore,home:s.homeScore,period:s.period?.number||0,clock:s.clock?.displayValue||''});
 }
 const anchors=resolveReadings({plays:rows,recordingDuration:meta.recordingDuration},readings[meta.id]||[],[...types.keys()]);
 games.push({id:meta.id,name:meta.name,teams:[away,home].map(c=>({id:String(c.team.id),abbreviation:c.team.abbreviation,name:c.team.displayName})),date:meta.date,start:kickoff,end:kickoff+rows.at(-1)[0]+30,page:meta.page,embed:meta.embed,summary:meta.summary,recordingDuration:meta.recordingDuration,anchors,plays:rows,scores});
 playCount+=rows.length;scoreCount+=scores.length;
}
games.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
const out={version:2,season:previous.season,week:previous.week,title:previous.title,
 fields:['t','period','clock','type','offense','down','distance','yardsToGoal','awayScore','homeScore','text'],
 types:[...types.keys()],coverage:{games:games.length,plays:playCount,scores:scoreCount},games};
await writeFile(ARCHIVE,JSON.stringify(out));
console.log(`Wrote ${games.length} games, ${playCount} plays, ${scoreCount} scoring plays.`);
