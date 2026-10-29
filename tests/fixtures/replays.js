export const SOURCES=[{id:'replay-phi',name:'Cowboys at Eagles',short:'DAL @ PHI',teams:[{id:'6',abbreviation:'DAL',score:''},{id:'21',abbreviation:'PHI',score:''}],embed:'https://ok.ru/videoembed/16641575946924',page:'https://nfl-video.com/dallas-cowboys-vs-philadelphia-eagles-full-game-replay-nfl-week-07-october-26-2026'},{id:'replay-ind',name:'Colts at Vikings',short:'IND @ MIN',teams:[{id:'11',abbreviation:'IND',score:''},{id:'16',abbreviation:'MIN',score:''}],embed:'https://ok.ru/videoembed/15876147841708',page:'https://nfl-video.com/indianapolis-colts-vs-minnesota-vikings-full-game-replay-nfl-week-07-october-25-2026'}];
export function scenarios(step){const g=SOURCES.map(s=>({...s,teams:s.teams.map(t=>({...t})),state:'in',statusName:'STATUS_IN_PROGRESS',phase:'scrimmage',possession:s.teams[1].id,yardsToGoal:70,down:2,downDistance:'2nd & 6',detail:'Scripted test event',redZone:false}));
 if(step===0){g[0].possession='21';g[0].yardsToGoal=42;}
 if(step===1){g[0].possession='6';g[1].possession='11';g[1].yardsToGoal=18;g[1].redZone=true;}
 if(step===2){g[0].possession='6';g[0].yardsToGoal=6;g[0].redZone=true;}
 if(step===3){for(const x of g){x.statusName='STATUS_HALFTIME';x.detail='Quiet moment';}}
 if(step===4){g[0].possession='6';g[1].possession='11';g[1].yardsToGoal=5;g[1].redZone=true;}
 return g;}
