// Fictional games and players; never represented as today's NFL data.
export function demoData(step=0, now=Date.now()) {
  const possession=step%5;
  const player=(id,name,teamId,position,starter=true)=>({id,name,teamId,position,starter,injury:''});
  const games=[
    {id:'demo-1',yardsToGoal:possession===0?12:60,name:'CHI @ GB',teams:[{id:'3',abbreviation:'CHI',score:'21'},{id:'9',abbreviation:'GB',score:'24'}],possession:possession===0?'3':'9',redZone:possession===0,detail:'4:18 - 4th',clock:'4:18',period:4,down:2,downDistance:'2nd & 6',lastPlay:'Demo: Chicago moves inside the 20.'},
    {id:'demo-2',yardsToGoal:possession===1?8:70,name:'PHI @ DAL',teams:[{id:'21',abbreviation:'PHI',score:'14'},{id:'6',abbreviation:'DAL',score:'10'}],possession:possession===1?'21':'6',redZone:possession===1,detail:'8:42 - 3rd',clock:'8:42',period:3,down:3,downDistance:'3rd & 4',lastPlay:'Demo: Philadelphia moves the chains.'},
    {id:'demo-3',yardsToGoal:possession===2?6:65,name:'IND @ HOU',teams:[{id:'11',abbreviation:'IND',score:'17'},{id:'34',abbreviation:'HOU',score:'17'}],possession:possession===2?'11':'34',redZone:possession===2,detail:'11:20 - 3rd',clock:'11:20',period:3,down:1,downDistance:'1st & 10',lastPlay:'Demo: Indianapolis starts a new series.'}
    ,{id:'demo-4',name:'SEA @ SF',teams:[{id:'26',abbreviation:'SEA',score:'20'},{id:'25',abbreviation:'SF',score:'23'}],possession:'25',yardsToGoal:possession===3?3:possession===4?18:24,redZone:possession>=3,detail:'2:10 - 4th',period:4,clock:'2:10',down:2,downDistance:'2nd & goal',lastPlay:'Demo: San Francisco threatens to score. No roster players in this game.'}
  ].map(g=>({...g,state:'in',statusName:'STATUS_IN_PROGRESS',fetchedAt:now}));
  return {games, league:{week:7,teams:[{id:'demo',name:'Sunday Test Roster',players:[player('a','Example Quarterback','3','QB'),player('b','Example Receiver','21','WR'),player('c','Example Running Back','11','RB'),player('d','Example Bench Receiver','9','WR',false)]}]}};
}

export function demoHighlights(step=0,now=Date.now()) {
  return [
    {id:'demo-clip-1',kind:'clip',gameId:'demo-1',gameName:'CHI @ GB',title:'Demo: Example Quarterback finds the end zone',description:'Fictional preview of a player-matched ESPN clip. Real clips open on ESPN.',athleteIds:['a'],teamIds:['3'],url:null,duration:34,publishedAt:now-120000,discoveredAt:now-120000,opened:false},
    {id:'demo-play-1',kind:'play',gameId:'demo-2',gameName:'PHI @ DAL',title:'Passing touchdown',description:'Demo: Example Receiver catches a 24-yard touchdown pass.',athleteIds:['b'],teamIds:['21'],url:null,period:3,clock:'8:42',publishedAt:now-60000,discoveredAt:now-60000,opened:false},
    ...(step>=3?[{id:'demo-play-2',kind:'play',gameId:'demo-4',gameName:'SEA @ SF',title:'Scoring threat',description:'Demo: San Francisco reaches the 3-yard line while your roster rests.',athleteIds:[],teamIds:['25'],url:null,period:4,clock:'2:10',publishedAt:now,discoveredAt:now,opened:false}]:[])
  ];
}
