// Keep newly added native caption tracks off, including tracks that appear
// after an HLS rendition change. Metadata tracks remain available to the player.
export function disableCaptions(video){
 const apply=()=>{for(const track of video.textTracks||[])if(['captions','subtitles'].includes(track.kind)&&track.mode!=='disabled')track.mode='disabled';};
 const tracks=video.textTracks;
 tracks?.addEventListener?.('addtrack',apply);tracks?.addEventListener?.('change',apply);
 video.addEventListener('loadedmetadata',apply);apply();
 return ()=>{tracks?.removeEventListener?.('addtrack',apply);tracks?.removeEventListener?.('change',apply);video.removeEventListener?.('loadedmetadata',apply);};
}
