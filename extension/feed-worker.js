import {FeedLoop} from './feed.js';
import {rehearsalFrame} from './rehearsal.js';
const feed=new FeedLoop({emit:packet=>postMessage(packet)});
let pulse,labTimer;
self.onmessage=({data})=>{
  if(data.type==='start'){
    clearInterval(pulse);clearInterval(labTimer);feed.stop();
    if(data.lab){
      const tick=()=>{const now=Date.now(),frame=rehearsalFrame((now-data.lab.startedAt)/1000,now);
        postMessage({...frame,type:frame.offline?'feedError':'feed',error:frame.offline?'Rehearsal connection outage':'',token:data.token,meta:{receivedAt:now,startedAt:now,networkMs:0},nextPollAt:now+1000,lab:true});
      };tick();labTimer=setInterval(tick,1000);
    }else void feed.start(data);
    pulse=setInterval(()=>postMessage({type:'pulse',token:data.token,at:Date.now(),nextPollAt:feed.nextAt}),1000);
  } else if(data.type==='stop'){clearInterval(pulse);clearInterval(labTimer);feed.stop();}
  else if(data.type==='poke')void feed.poke();
};
