// Turns ESPN game summaries into the replay archive the director reads
// (the same shape as web/week7.json, version 2). Shared by the build script
// and the page, which builds the latest completed week on demand.
import {parseScoringPlay} from './scoring.js';
const tidy=text=>String(text||'').replace(/^\((?:Shotgun|No Huddle(?:, Shotgun)?|Punt formation|Field Goal formation|Kick formation)\)\s*/i,'').replace(/\s+/g,' ').trim();
const shortText=text=>{const t=tidy(text);return t.length>120?t.slice(0,117).replace(/\s+\S*$/,'')+'…':t;};
// ESPN's yardsToEndzone is unreliable on stoppages and some kicks; the
// possession text ("BAL 16") is not. Distance is from the offense's view.
export function yardsToGoal(start,abbr){
 const m=/^([A-Z]+)\s+(\d{1,2})$/.exec(start.possessionText||'');
 if(m&&start.team)return m[2]==='50'?50:m[1]===abbr[String(start.team.id)]?100-Number(m[2]):Number(m[2]);
 if(start.possessionText==='50')return 50;
 const y=start.yardsToEndzone;return Number.isFinite(y)&&y>0&&y<=100?y:null;
}
export class PlayTypes{
 constructor(names=[]){this.map=new Map(names.map((n,i)=>[n,i]));}
 index(name){if(!this.map.has(name))this.map.set(name,this.map.size);return this.map.get(name);}
 get names(){return [...this.map.keys()];}
}
// One game from its ESPN summary. meta carries what ESPN does not know: the
// replay embed, its page and length, and any scorebug anchors.
export function buildGame(raw,meta,types){
 const competitors=raw?.header?.competitions?.[0]?.competitors||[];
 const away=competitors.find(c=>c.homeAway==='away'),home=competitors.find(c=>c.homeAway==='home');
 if(!away||!home)throw new Error('The game summary has no teams.');
 const teamIds=[String(away.team.id),String(home.team.id)];
 const side=id=>teamIds.indexOf(String(id??''));
 const abbr=Object.fromEntries([away,home].map(c=>[String(c.team.id),c.team.abbreviation]));
 const plays=[...(raw.drives?.previous||[]),...(raw.drives?.current?[raw.drives.current]:[])].flatMap(d=>d?.plays||[]).filter(p=>p.wallclock).sort((a,b)=>Number(a.sequenceNumber)-Number(b.sequenceNumber));
 if(!plays.length)throw new Error('The game summary has no plays yet.');
 const kickoff=Date.parse(plays[0].wallclock)/1000;
 let last=0;const index=new Map();
 const rows=plays.map((p,i)=>{
  const t=Math.max(last,Math.round(Date.parse(p.wallclock)/1000-kickoff));last=t;index.set(String(p.id),i);
  const s=p.start||{},ytg=yardsToGoal(s,abbr);
  return [t,p.period?.number||0,p.clock?.displayValue||'',types.index(p.type?.text||'Play'),side(s.team?.id),s.down||0,s.distance||0,ytg,p.awayScore??0,p.homeScore??0,shortText(p.text)];
 });
 // ESPN's marker rows can carry a stale pre-conversion tally; a scoreboard never goes backwards.
 for(let k=1;k<rows.length;k++){rows[k][8]=Math.max(rows[k][8],rows[k-1][8]);rows[k][9]=Math.max(rows[k][9],rows[k-1][9]);}
 const scores=[];
 for(const s of raw.scoringPlays||[]){
  const i=index.get(String(s.id));if(i===undefined)continue;
  const team=side(s.team?.id),offense=rows[i][4];
  const parsed=parseScoringPlay(s.text,s.type?.text,s.scoringType?.name);
  scores.push({i,t:rows[i][0],team,kind:parsed.kind,defensive:team>=0&&offense>=0&&team!==offense||parsed.defensive,text:String(s.text||'').trim(),players:parsed.players,away:s.awayScore,home:s.homeScore,period:s.period?.number||0,clock:s.clock?.displayValue||''});
 }
 const name=meta.name||`${away.team.abbreviation} at ${home.team.abbreviation}`;
 return {id:String(meta.id||raw.header?.id||''),name,teams:[away,home].map(c=>({id:String(c.team.id),abbreviation:c.team.abbreviation,name:c.team.displayName})),date:meta.date||raw.header?.competitions?.[0]?.date||'',start:kickoff,end:kickoff+rows.at(-1)[0]+30,page:meta.page||'',embed:meta.embed||'',summary:meta.summary||'',recordingDuration:Number(meta.recordingDuration)||0,anchors:meta.anchors||[],plays:rows,scores};
}
// A whole week: every game that has plays, sorted by kickoff.
export function buildArchive(entries,{season,week,title='',types=new PlayTypes()}={}){
 const games=[];
 for(const {raw,meta} of entries){try{games.push(buildGame(raw,meta,types));}catch{}}
 games.sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id));
 return {version:2,season,week,title:title||`Week ${week}`,fields:['t','period','clock','type','offense','down','distance','yardsToGoal','awayScore','homeScore','text'],types:types.names,
  coverage:{games:games.length,plays:games.reduce((n,g)=>n+g.plays.length,0),scores:games.reduce((n,g)=>n+g.scores.length,0)},games};
}
// The most recent regular-season week whose games have all finished.
// Only regular-season weeks have an archive: in the postseason the last regular week stays current.
export function latestCompletedWeek(scoreboard){
 const type=Number(scoreboard?.season?.type)||2;if(type===3)return 18;if(type!==2)return 0;
 const week=Number(scoreboard?.week?.number)||0,events=scoreboard?.events||[];
 if(!week)return 0;
 const done=events.length>0&&events.every(e=>e.competitions?.[0]?.status?.type?.completed);
 return done?week:Math.max(0,week-1);
}
