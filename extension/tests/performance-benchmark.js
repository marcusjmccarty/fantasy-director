import {pathToFileURL} from 'node:url';
import {Coordinator} from '../coordinator.js';
import {harness,game} from './helpers.js';
export async function measure(Controller=Coordinator){
 const h=harness();await h.setup('fantasy');
 const c=new Controller(h.api,{now:h.now,request:async()=>{throw new Error('No network in benchmark');}});await c.ready();
 c.s.config.focusMode='nfl';c.s.config.highlightsEnabled=false;
 c.s.runtime.league.teams=Array.from({length:12},(_,i)=>({id:String(i+1),name:`Fixture franchise ${i+1}`,players:Array.from({length:18},(_,j)=>({id:`${i}-${j}`,name:`Fixture Player ${i} ${j}`,teamId:'3',position:'WR',starter:j<9,injury:''}))}));
 await c.dispatch({action:'start'});let writes=0,bytesWritten=0;const set=h.api.storage.session.set;
 h.api.storage.session.set=async data=>{writes++;bytesWritten+=Buffer.byteLength(JSON.stringify(data));return set(data);};
 for(let second=1;second<=180;second++){
   h.advance(1000);const packet=second%5===0?{type:'feed',games:Array.from({length:14},(_,i)=>game(String(i+1),i===0?'3':'21',i===0?50:30,{fetchedAt:h.now()})),highlights:[],meta:{receivedAt:h.now(),networkMs:10}}:{type:'pulse'};
   await c.packet({...packet,token:c.s.runtime.engineToken});
 }
 const view=c.view();
 return {scenario:'180 simulated seconds, 14 games, 12 fantasy teams, zero video offset, highlights disabled; browser/storage APIs mocked',sessionWrites:writes,serializedWriteBytes:bytesWritten,deskPayloadBytes:Buffer.byteLength(JSON.stringify(view)),retainedHistorySnapshots:c.s.runtime.history.length,deskTimingSamples:view.runtime.timing.samples.length};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
 const result={v31:await measure()};
 if(process.argv[2])result.v30=await measure((await import(pathToFileURL(process.argv[2]).href)).Coordinator);
 console.log(JSON.stringify(result,null,2));
}
