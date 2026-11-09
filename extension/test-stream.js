const $=id=>document.getElementById(id),gameId=new URL(location.href).searchParams.get('game');
async function update(){
  if(document.hidden)return;
  try{const response=await chrome.runtime.sendMessage({action:'labState'}),r=response?.data;
    if(!r){$('situation').textContent='Test finished or this tab is no longer assigned.';return;}
    const g=r.games.find(g=>g.id===gameId);if(!g)return;
    document.title='TEST · '+g.name;$('game').textContent=g.name;$('situation').textContent=`${g.possession?g.teams.find(t=>t.id===g.possession)?.abbreviation:'Unknown'} possession · ${g.yardsToGoal} yards to goal`;
    $('position').style.width=Math.max(0,Math.min(100,100-g.yardsToGoal))+'%';$('phase').textContent=r.lab.label;
    $('clock').textContent=`${r.lab.elapsed} / 72 seconds · ${r.lab.complete?'COMPLETE':r.running?'REHEARSAL RUNNING':'STOPPED'}`;
  }catch{$('situation').textContent='Reload the extension to reconnect.';}
}
$('stop').addEventListener('click',async()=>{await chrome.runtime.sendMessage({action:'stop'});await update();});
$('exit').addEventListener('click',()=>chrome.runtime.sendMessage({action:'exitRehearsal'}));
chrome.runtime.onMessage.addListener(m=>{if(m.target==='desk')void update();});
document.addEventListener('visibilitychange',update);void update();
