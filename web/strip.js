// What both league pages' game strips share: a tile that can always be tabbed to, arrow keys along the row, and side arrows that step aside at the ends.
export function stripEnds(list,prev,next){if(list.scrollWidth===undefined)return;prev.hidden=list.scrollLeft<=1;next.hidden=list.scrollLeft+list.clientWidth>=list.scrollWidth-1;}
// Past tiles take no Tab stop, so tonight's games are one press away. With no game today, the newest past tile takes the stop.
export function stripTabStop(list){const all=[...(list.querySelectorAll?.('.game')||[])].filter(b=>b.getAttribute);if(!all.length||all.some(b=>b.getAttribute('tabindex')!=='-1'))return;const last=all.at(-1);last.setAttribute('tabindex','0');}
export function stripKeys(event,list){
 if(event.altKey||event.ctrlKey||event.metaKey||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 const all=[...list.querySelectorAll('.game:not([disabled])')],at=all.indexOf(event.target.closest?.('.game'));if(at<0)return;
 const to=event.key==='Home'?0:event.key==='End'?all.length-1:Math.max(0,Math.min(all.length-1,at+(event.key==='ArrowRight'?1:-1)));
 event.preventDefault();event.stopPropagation();all[to].focus();all[to].scrollIntoView?.({block:'nearest',inline:'nearest'});
}
