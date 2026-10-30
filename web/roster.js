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
 return lines.map((line,index)=>{
  const [name,rawTeam,rawPosition,...rest]=line.split(',').map(x=>x.trim());
  const team=alias(rawTeam?.toUpperCase()),position=rawPosition?.toUpperCase().replace(/^(DST|DEF|D)$/,'D/ST');
  if(!name||name.length>60||!TEAMS.includes(team)||!POSITIONS.includes(position)||rest.length)throw new Error(`Line ${index+1}: use name, NFL team, position.`);
  return {name,team,position};
 });
}
export const formatRoster=roster=>roster.map(p=>`${p.name}, ${p.team}, ${p.position}`).join('\n');
export function safeVideo(value){
 if(!value)return '';
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||!/\.(mp4|webm|m3u8)$/i.test(u.pathname))throw new Error('Use a direct HTTPS .mp4, .webm or .m3u8 link.');
 return u.href;
}
export function gameKey(game){return game.teams.map(t=>alias(t.abbreviation||t.abbr)).sort().join('-');}
