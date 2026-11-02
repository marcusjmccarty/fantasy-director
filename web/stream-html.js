// Inspect published markup as text only. Never execute page scripts or supplied HTML.
export function publicPlayerURL(value,base='https://ntv.st'){
 try{if(typeof value!=='string'||!value.trim()||value.length>4096)return null;const u=new URL(value,base),h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||!h.includes('.')||h.includes(':')||/^\d/.test(h)||/\.(local|localhost|internal|test|invalid|arpa)$/.test(h))return null;return u.href;}catch{return null;}
}
export const decodeEmbedHTML=s=>s.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(?:x([\da-f]+)|(\d+));/gi,(_,hex,dec)=>String.fromCodePoint(Math.min(0x10ffff,parseInt(hex||dec,hex?16:10))));
const streamAttribute=(attrs,name)=>new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(["\'])(.*?)\\1','i').exec(attrs)?.[2];
const directMedia=url=>/\.(?:m3u8|mp4|webm|mov)(?:[?#]|$)/i.test(url);
export function embeddedPlayerFromHTML(html,page){
 const media=[];const add=(value,direct=false)=>{const u=publicPlayerURL(decodeEmbedHTML(value||'').replace(/\\\//g,'/'),page);if(u&&(!direct||directMedia(u)))media.push(u);};
 const markup=html.replace(/<!--[\s\S]*?-->/g,'');
 for(const m of markup.matchAll(/<video\b([^>]*)>([\s\S]*?)<\/video>/gi)){
  if(/\b(?:ad|advert|banner|promo)\b/i.test(m[1]))continue;
  add(streamAttribute(m[1],'src'),true);
  for(const src of m[2].matchAll(/<source\b([^>]+)>/gi))add(streamAttribute(src[1],'src'),true);
 }
 for(const m of markup.matchAll(/<meta\b([^>]+)>/gi))if(/^og:video(?::url|:secure_url)?$/i.test(streamAttribute(m[1],'property')||''))add(streamAttribute(m[1],'content'),true);
 // Common HTML5 player configurations (JW Player, Video.js, HLS). URLs only;
 // no arbitrary script execution, token decryption, or DRM circumvention.
 for(const m of markup.matchAll(/\b(?:file|source|src|hlsUrl)\s*["']?\s*[:=]\s*(["'])(https?:[^"'\s<>]+)\1/gi))add(m[2],true);
 const unique=[...new Set(media)];if(unique.length===1)return unique[0];
 const candidates=[];for(const match of markup.matchAll(/<iframe\b([^>]+)>/gi)){
  const attrs=match[1],src=streamAttribute(attrs,'src')||streamAttribute(attrs,'data-src');if(!src||/\b(?:ad|advert|banner|captcha|chat|tracking)\b/i.test(attrs))continue;
  const url=publicPlayerURL(decodeEmbedHTML(src),page);if(!url||/doubleclick|googlesyndication|adservice/i.test(new URL(url).hostname))continue;
  const strong=/(?:id|class|title)\s*=\s*["'][^"']*(?:player|stream|video)[^"']*["']/i.test(attrs)||/\/(?:embed|player)(?:\/|\?|$)/i.test(new URL(url).pathname);candidates.push({url,strong});
 }
 const strong=[...new Set(candidates.filter(c=>c.strong).map(c=>c.url))];return strong.length===1?strong[0]:null;
}
export async function boundedStreamText(response){
 if(Number(response.headers.get('Content-Length'))>600000)throw new Error('Page too large.');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>600000)throw new Error('Page too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder().decode(bytes);
}
