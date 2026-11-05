// Moderator key comes from stdin or the environment, never from command-line arguments.
// Examples: node scripts/moderate-chat.mjs --purge-lounges
//           node scripts/moderate-chat.mjs --room nfl:league:123 --id 42
import {readFileSync} from 'node:fs';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
const key=(process.env.CHAT_MODERATOR_KEY||(!process.stdin.isTTY?readFileSync(0,'utf8'):'')).trim();
if(key.length<32||key.length>256)throw new Error('Supply CHAT_MODERATOR_KEY through the environment or stdin.');
const site=new URL(args.includes('--url')?value('--url'):'https://fantasy-stream.fantasy-hub.workers.dev/');
if(site.protocol!=='https:'&&!(site.protocol==='http:'&&['localhost','127.0.0.1'].includes(site.hostname)))throw new Error('Use HTTPS for the deployed site.');
const purge=args.includes('--purge-lounges'),rooms=purge?['nfl','nba','nhl','mlb'].map(s=>s+':lounge'):[args.includes('--room')?value('--room'):''];
if(rooms.some(room=>!/^(nfl|nba|nhl|mlb):(league:\d{1,12}|lounge)$/.test(room)))throw new Error('Choose --room nfl:league:123 or --purge-lounges.');
const id=args.includes('--id')?Number(value('--id')):null,clear=purge||args.includes('--clear');
if(clear&&id!==null||!clear&&(!Number.isSafeInteger(id)||id<=0))throw new Error('Choose exactly one of --id 42 or --clear.');
for(const room of rooms){
 const url=new URL('/api/chat',site);url.searchParams.set('room',room);
 const response=await fetch(url,{method:'DELETE',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(clear?{clear:true}:{id}),signal:AbortSignal.timeout(15000),redirect:'error'});
 const data=await response.json();
 if(!response.ok)throw new Error(room+': '+(data.error||'Moderation failed.'));
 console.log(room+': removed '+data.removed.length+' message(s).');
}
