// Installed only in a provider document inside a verified Fantasy Stream tab.
// Keep the real user activation available for the parent channel's request.
// Letting a disposable provider video enter fullscreen first consumes it.
(()=>{
 if(window.__fantasyStreamFullscreen)return;window.__fantasyStreamFullscreen=true;
 const route=exit=>{window.dispatchEvent(new CustomEvent('fantasy-stream-fullscreen',{detail:{exit}}));return Promise.resolve();};
 for(const name of ['requestFullscreen','webkitRequestFullscreen','webkitRequestFullScreen']){
  if(typeof Element.prototype[name]==='function')Element.prototype[name]=function(){return route(false);};
 }
 for(const name of ['webkitEnterFullscreen','webkitEnterFullScreen']){
  if(typeof HTMLVideoElement.prototype[name]==='function')HTMLVideoElement.prototype[name]=function(){return route(false);};
 }
 for(const name of ['exitFullscreen','webkitExitFullscreen','webkitCancelFullScreen']){
  if(typeof document[name]==='function')document[name]=()=>route(true);
 }
})();
