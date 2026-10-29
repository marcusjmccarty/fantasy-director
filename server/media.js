// Return only the original provider embeds in the fixed week catalog.
// Playback stays at the provider; no server-generated media URL is sent to browsers.
function mediaJSON(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function replaySourceAPI(request,catalog){
 if(request.method!=='GET')return mediaJSON({error:'Use GET.'},405);
 const id=new URL(request.url).searchParams.get('id'),game=catalog.find(game=>game.id===id);
 if(!game||!/^https:\/\/ok\.ru\/videoembed\/\d+$/.test(game.embed))return mediaJSON({error:'Unknown replay.'},404);
 return mediaJSON({id:game.id,name:game.name,page:game.page,duration:Number(game.recordingDuration)||0,sources:[{quality:'provider',url:game.embed,type:'provider/ok'}],expiresAt:Date.now()+86400000,provider:'OK embedded player',sync:'uncalibrated'});
}

// First-party operational diagnostics: numbers and catalog IDs only, no URLs,
// cookies, user-agent strings, roster details, or free-form browser messages.
export async function playbackHealthAPI(request,catalog,env={},logger=console){
 if(request.method!=='POST')return mediaJSON({error:'Use POST.'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin||!env.ESPN_OWNER_ID||request.headers.get('oai-authenticated-user-id')!==env.ESPN_OWNER_ID)return mediaJSON({error:'Not authorized.'},403);
 if(Number(request.headers.get('Content-Length')||0)>1024)return mediaJSON({error:'Request too large.'},413);
 let data;try{const text=await request.text();if(text.length>1024)return mediaJSON({error:'Request too large.'},413);data=JSON.parse(text);}catch{return mediaJSON({error:'Invalid report.'},400);}
 if(!data||!['ready','failed'].includes(data.event)||!catalog.some(game=>game.id===data.game))return mediaJSON({error:'Invalid report.'},400);
 const count=(value,max)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value))):0;
 const record={kind:'playback-health',build:'browser-fetch-2',event:data.event,game:data.game,code:/^[A-Z0-9_]{1,40}$/.test(data.code||'')?data.code:'UNKNOWN',phase:['source','metadata','buffer','play','frame','ready','failed','cancelled'].includes(data.phase)?data.phase:'source',imported:count(data.imported,14),readyState:count(data.readyState,4),networkState:count(data.networkState,3),providerInitialized:data.providerInitialized===true,providerProgress:count(data.providerProgress,1000)};
 logger[data.event==='failed'?'error':'info'](JSON.stringify(record));return mediaJSON({ok:true});
}
