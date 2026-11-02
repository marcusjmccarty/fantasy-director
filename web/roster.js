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
 value=String(value).trim();if(value.length>8192)throw new Error('That stream link is too long.');
 if(/^<iframe\b/i.test(value)){const match=/<iframe\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1/i.exec(value);if(!match)throw new Error('The iframe must include a player src URL.');value=match[2].replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'");}
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
// A bright, recognizable color per NFL team (the replay archive carries none),
// tuned to read on a dark background. ESPN's live feeds supply their own.
const NFL_COLORS={ARI:'c4294f',ATL:'d0213d',BAL:'7656d6',BUF:'2f6fe0',CAR:'1aa3e8',CHI:'e5642b',CIN:'fb5a1f',CLE:'ff5a1f',DAL:'3b78e7',DEN:'fb6a26',DET:'1d8fd6',GB:'ffbf33',HOU:'d33148',IND:'3f7fd6',JAC:'12a4b8',KC:'ef3346',LAC:'2aa3e6',LAR:'ffae2b',LV:'b9c0c5',MIA:'12b3bd',MIN:'8459cf',NE:'e0334f',NO:'d8c08f',NYG:'3a68d1',NYJ:'2fa36a',PHI:'12919c',PIT:'ffbf33',SEA:'75c83a',SF:'d8343f',TB:'e8303a',TEN:'5ca2e6',WAS:'c0504a'};
// ESPN's logo codes differ from the feed's abbreviations for a few teams.
const LOGO_CODES={WAS:'wsh',JAC:'jax'};
export function teamColor(team,sport='nfl'){
 const raw=(sport==='nfl'?NFL_COLORS[alias(team?.abbr||team?.abbreviation||'')]:'')||team?.color||'';
 if(!/^[0-9a-f]{6}$/i.test(raw))return '#5b6b84';
 // Many official primaries are near-black navy; lift those so they read on the dark page.
 let [r,g,b]=[0,2,4].map(i=>parseInt(raw.slice(i,i+2),16));const peak=Math.max(r,g,b);
 if(peak<120){const k=peak<50?.5:.38;[r,g,b]=[r,g,b].map(v=>Math.round(v+(255-v)*k));}
 return '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function teamLogo(team,sport='nfl'){
 if(/^https:\/\/a\.espncdn\.com\//.test(team?.logo||''))return team.logo;
 const code=String(LOGO_CODES[alias(team?.abbr||'')]||team?.abbreviation||team?.abbr||'').toLowerCase();
 return /^[a-z]{2,4}$/.test(code)?`https://a.espncdn.com/i/teamlogos/${sport}/500/${code}.png`:'';
}
