// Only NTV's published HTTPS player gets the provider-specific sandbox exception.
// Watch pages still go through the resolver; arbitrary pages and other hosts do not.
export function ntvURL(value){
 try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!['ntv.st','www.ntv.st'].includes(u.hostname.replace(/\.$/,'')))return null;u.hostname='ntv.st';return u;}catch{return null;}
}
export function ntvEmbedURL(value){const u=ntvURL(value);return u?.pathname==='/embed'&&u.searchParams.get('t')?.trim()?u.href:null;}
