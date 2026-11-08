import {createHash} from 'node:crypto';

// A single revision across the module graph prevents Safari from combining a
// fresh page with old imported modules after a deployment. Source stays clean.
export function versionAssets(files){
 const revision=createHash('sha256').update(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,file])=>path+'\0'+file.body).join('\0')).digest('hex').slice(0,12);
 for(const [path,file] of Object.entries(files)){
  if(file.type==='text/html')file.body=file.body.replace(/\b(src|href)=(['"])(\/?[^'"?#]+\.(?:js|mjs|css))\2/g,(all,attr,q,url)=>files[url.startsWith('/')?url:'/'+url]?`${attr}=${q}${url}?v=${revision}${q}`:all);
  if(file.type==='text/javascript'&&!path.startsWith('/hls.'))file.body=file.body.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\/[^'"?#]+\.(?:js|mjs))\2/g,(all,prefix,q,url)=>files['/'+url.slice(2)]?`${prefix}${q}${url}?v=${revision}${q}`:all);
 }
 return revision;
}
