// Return only the original provider embeds in the fixed week catalog.
// Playback stays at the provider; no server-generated media URL is sent to browsers.
function mediaJSON(value,status=200){return new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export async function replaySourceAPI(request,catalog){
 if(request.method!=='GET')return mediaJSON({error:'Use GET.'},405);
 const id=new URL(request.url).searchParams.get('id'),game=catalog.find(game=>game.id===id);
 if(!game||!/^https:\/\/ok\.ru\/videoembed\/\d+$/.test(game.embed))return mediaJSON({error:'Unknown replay.'},404);
 return mediaJSON({id:game.id,name:game.name,page:game.page,duration:Number(game.recordingDuration)||0,sources:[{quality:'provider',url:game.embed,type:'provider/ok'}],expiresAt:Date.now()+86400000,provider:'OK embedded player',sync:'uncalibrated'});
}
