'use strict';
// Display candidates only. Warning queries always use the current GPS position.
// Preserve 25 km / 500-point browsing; avoid rereading it on every GPS jitter.
function reusable(entry,center,now){
 if(!entry||now<entry.time||now-entry.time>=10000)return false;
 const dy=(center.lat-entry.center.lat)*111320;
 const dx=(center.lon-entry.center.lon)*111320*Math.cos(center.lat*Math.PI/180);
 return Math.hypot(dx,dy)<100;
}
module.exports={reusable};
