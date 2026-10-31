import {alias} from './scoring.js';
export const TEAMS='ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAC KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WAS'.split(' ');
export const POSITIONS=['QB','RB','WR','TE','K','D/ST'];
// A plausible lineup spread across the Week 7 slate, so the replay has
// something to direct before a league is connected.
export const SAMPLE=[
 {name:'Joe Burrow',team:'CIN',position:'QB'},{name:'Jonathan Taylor',team:'IND',position:'RB'},{name:'Tony Pollard',team:'TEN',position:'RB'},
 {name:'Zay Flowers',team:'BAL',position:'WR'},{name:'Jameson Williams',team:'DET',position:'WR'},{name:'Puka Nacua',team:'LAR',position:'WR'},
 {name:'Trey McBride',team:'ARI',position:'TE'},{name:'Will Reichard',team:'MIN',position:'K'},{name:'Buccaneers D/ST',team:'TB',position:'D/ST'}];
export function parseRoster(value){
 const lines=value.split('\n').map(x=>x.trim()).filter(Boolean);
 if(!lines.length)throw new Error('Add at least one starter.');
 if(lines.length>20)throw new Error('Use up to 20 starters.');
 const seen=new Set();
 return lines.map((line,index)=>{
  const [name,rawTeam,rawPosition,...rest]=line.split(',').map(x=>x.trim());
  const team=alias(rawTeam?.toUpperCase()),position=rawPosition?.toUpperCase().replace(/^(DST|DEF|D)$/,'D/ST');
  const field=!name||name.length>60?0:!TEAMS.includes(team)?1:!POSITIONS.includes(position)?2:rest.length?0:null;
  if(field!==null)throw Object.assign(new Error(`Player ${index+1}: ${['enter a name of 1–60 characters','choose an NFL team','choose a position'][field]}. Use name, NFL team, position.`),{line:index+1,field});
  const key=[name.toLowerCase().replace(/\s+/g,' '),team,position].join('|');
  if(seen.has(key))throw Object.assign(new Error(`${name} appears twice. Remove the duplicate player.`),{line:index+1,field:0});seen.add(key);
  return {name,team,position};
 });
}
export const formatRoster=roster=>roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n');
// A stream can be a direct video file, an HLS playlist, or any https page to embed.
export function safeVideo(value){
 if(!value)return '';
 let u;try{u=new URL(value);}catch{throw new Error('Enter a full https:// link.');}
 if(u.protocol!=='https:'||u.username||u.password)throw new Error('Use an https:// link without a login in it.');
 return u.href;
}
export function streamType(url){
 if(/\.m3u8(?:[?#]|$)/i.test(url))return 'application/vnd.apple.mpegurl';
 if(/\.(mp4|webm|mov)(?:[?#]|$)/i.test(url))return 'video/mp4';
 return 'embed/page';
}
export function gameKey(game){return game.teams.map(t=>alias(t.abbreviation||t.abbr)).sort().join('-');}
