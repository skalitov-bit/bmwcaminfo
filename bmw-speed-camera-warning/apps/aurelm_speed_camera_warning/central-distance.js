'use strict';
// Display only: retain the authoritative warning, phase, speed and expiry.
// A forecast must never select a camera or trigger another announcement.
function centralDistance(event,presentation){
 const p=presentation,hit=p&&p.hit;
 if(!event||!event.camera||!hit||!hit.camera||!hit.active||p.estimated||
    event.camera.id!==hit.camera.id||(event.phase||'point')!==((hit.state&&hit.state.phase)||'point')||
    !Number.isFinite(p.distanceM)||p.distanceM<0)return event;
 return Object.assign({},event,{distanceM:p.distanceM});
}
module.exports={centralDistance};
