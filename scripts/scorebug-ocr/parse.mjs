// Turns OCR'd scorebug frames (results/<gameId>.tsv, from run-all.sh) into
// scorebug readings and writes them into scripts/scorebug-anchors.json under
// "<gameId>" as [media, quarter, clock, kind]; readings a person entered by
// hand are kept under "<gameId>:manual" for reference.
//   node scripts/scorebug-ocr/parse.mjs
import {readFile,writeFile,readdir} from 'node:fs/promises';
const root=new URL('../../',import.meta.url).pathname;
const here=new URL('./results/',import.meta.url).pathname;
const QUARTER={'1ST':1,'2ND':2,'3RD':3,'4TH':4,'OT':5,'1STI':1,'2NDI':2};
function parseLine(line){
 const [t,actual,text]=line.split('\t');if(!text||actual==='ERR')return null;
 const boxes=text.split(' | ').map(s=>{const m=/^(.*)@(\d+),(\d+),(\d+)$/.exec(s);return m?{s:m[1].trim(),x:+m[2],y:+m[3],w:+m[4]}:null;}).filter(Boolean);
 // the clock: m:ss with minutes <= 15, not part of a score line like "6:45 21"
 const clocks=[];for(const b of boxes){const m=/(?:^|\s)(\d{1,2}):([0-5]\d)(?:\s|$)/.exec(b.s);if(m&&+m[1]<=15)clocks.push({b,clock:`${+m[1]}:${m[2]}`});}
 // the quarter box: "3RD", or "2ND 14" on bugs that print the period with the clock; never a down ("2ND & 12")
 // The bug's small caps come back as Cyrillic look-alikes ("4тн"); map them back before matching.
 const latin=s=>s.replace(/[АВЕКМНОРСТХаеорстнух]/g,c=>'ABEKMHOPCTXaeopcTHyx'['АВЕКМНОРСТХаеорстнух'.indexOf(c)]);
 const quarters=[];for(const b of boxes){if(/&/.test(b.s))continue;const m=/^(1ST|2ND|3RD|4TH|OT)(?:\s|$)/i.exec(latin(b.s).trim());if(m)quarters.push({b,q:QUARTER[m[1].toUpperCase()]});}
 if(!clocks.length||!quarters.length)return null;
 // pick the quarter box nearest (horizontally) to the clock box
 let best=null;for(const c of clocks)for(const q of quarters){const d=Math.abs(c.b.x-q.b.x)+Math.abs(c.b.y-q.b.y)*2;if(!best||d<best.d)best={d,c,q};}
 if(best.d>200)return null;
 return [Number(actual),best.q.q,best.c.clock];
}
const anchors=JSON.parse(await readFile(root+'scripts/scorebug-anchors.json','utf8'));
const summary=[];
for(const file of (await readdir(here)).filter(f=>/^\d+\.tsv$/.test(f))){
 const game=file.replace('.tsv','');const lines=(await readFile(here+file,'utf8')).split('\n').filter(Boolean);
 const readings=lines.map(parseLine).filter(Boolean);
 // The game clock only moves forward through the recording, and never faster
 // than the footage (a skipped stretch of running clock is allowed up to 2 min).
 // The longest chain of readings that obeys this is the real sequence; the
 // rest are OCR slips (a wrong digit, "1ST" read off a 2nd-quarter bug).
 const elapsed=r=>r[1]<=4?(r[1]-1)*900+(900-(Number(r[2].split(':')[0])*60+Number(r[2].split(':')[1]))):3600+600-(Number(r[2].split(':')[0])*60+Number(r[2].split(':')[1]));
 const fits=(a,b)=>{const de=elapsed(b)-elapsed(a),dm=b[0]-a[0];return de>=0&&de<=dm*1.05+120;};
 const best=new Array(readings.length).fill(1),prev=new Array(readings.length).fill(-1);
 for(let i=0;i<readings.length;i++)for(let j=0;j<i;j++)if(fits(readings[j],readings[i])&&best[j]+1>best[i]){best[i]=best[j]+1;prev[i]=j;}
 let end=0;for(let i=1;i<readings.length;i++)if(best[i]>=best[end])end=i;
 const keep=new Set();for(let i=end;i>=0;i=prev[i])keep.add(i);
 const clean=readings.filter((r,i)=>keep.has(i));
 // A run of identical readings is a stopped clock. Its members say nothing
 // about where the snap is, except the last: when the next reading shows the
 // clock running again, it resumed (the snap) exactly the clock difference
 // before that reading. A lone reading whose neighbours advance with the
 // footage is a running clock and pins its own second.
 const secsOf=c=>Number(c.split(':')[0])*60+Number(c.split(':')[1]);
 const running=(a,b)=>!!a&&!!b&&a[1]===b[1]&&Math.abs((secsOf(a[2])-secsOf(b[2]))-(b[0]-a[0]))<=2;
 const out=[];
 for(let i=0;i<clean.length;){
  let j=i;while(clean[j+1]&&clean[j+1][1]===clean[i][1]&&clean[j+1][2]===clean[i][2])j++;
  const first=clean[i],last=clean[j],next=clean[j+1],prev=clean[i-1];
  if(j===i)out.push([last[0],last[1],last[2],running(prev,last)||running(last,next)?'run':'stop']);
  else{
   const delta=next&&next[1]===last[1]?secsOf(last[2])-secsOf(next[2]):NaN,gap=next?next[0]-last[0]:NaN;
   if(delta>0&&delta<=gap+2&&next[0]-delta>=last[0]-2)out.push([Math.round(next[0]-delta),last[1],last[2],'snap']);
   else out.push([last[0],last[1],last[2],'stop']);
  }
  i=j+1;
 }
 if(!anchors[game+':manual']&&anchors[game])anchors[game+':manual']=anchors[game];
 anchors[game]=out.map(([m,q,c,f])=>[Math.round(m),q,c,f]);
 summary.push(`${game}: ${lines.length} frames, ${readings.length} readings, ${clean.length} kept, ${out.length} anchors (${out.filter(r=>r[3]==='run').length} running, ${out.filter(r=>r[3]==='snap').length} snaps, ${out.filter(r=>r[3]==='stop').length} stopped)`);
}
const {_about,...rest}=anchors;const out={_about,...Object.fromEntries(Object.entries(rest).sort())};
await writeFile(root+'scripts/scorebug-anchors.json','{\n'+Object.entries(out).map(([k,v])=>JSON.stringify(k)+':'+JSON.stringify(v)).join(',\n')+'\n}\n');
console.log(summary.join('\n'));
