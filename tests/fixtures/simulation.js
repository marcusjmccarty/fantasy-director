export const SAMPLE_ROSTER = [
 {name:'Caleb Williams',team:'CHI',position:'QB'},
 {name:'A.J. Brown',team:'PHI',position:'WR'},
 {name:'Jonathan Taylor',team:'IND',position:'RB'}
];
export function simulation(seconds){
 const phase=Math.min(5,Math.floor(seconds/12));
 const spec=[['CHI','GB',21,24,'3','9'],['PHI','DAL',14,10,'21','6'],['IND','HOU',17,17,'11','34'],['SEA','SF',20,23,'26','25']];
 const games=spec.map(([a,b,sa,sb,aid,bid],i)=>({id:`test-${i}`,name:`${a} @ ${b}`,teams:[{id:aid,abbreviation:a,score:String(sa)},{id:bid,abbreviation:b,score:String(sb)}],state:'in',phase:'scrimmage',statusName:'STATUS_IN_PROGRESS',possession:bid,yardsToGoal:65+i*3,down:2,downDistance:'2nd & 6',period:4,clock:'4:18',detail:'4th · 4:18',redZone:false}));
 if(phase<3){games[phase].possession=games[phase].teams[0].id;games[phase].yardsToGoal=[34,18,8][phase];games[phase].redZone=phase>0;}
 if(phase===3){games[3].yardsToGoal=3;games[3].redZone=true;games[3].downDistance='2nd & goal';}
 if(phase===4){games.forEach(g=>{g.yardsToGoal=70;g.statusName='STATUS_HALFTIME';g.detail='Drive break';});}
 if(phase===5){games[0].possession='3';games[0].yardsToGoal=9;games[0].redZone=true;games[0].downDistance='1st & goal';}
 return games;
}
