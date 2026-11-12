'use strict';
// Function codes describe the control; model names and a stored speed limit do not.
function controlsSpeed(camera){
 const c=camera||{};
 if(c.camera_family==='dummy')return false;
 if(c.typeNamespace==='estrelka')return [15,192,199,227].includes(Number(c.typeCode));
 const code=c.mapcamTypeCode!=null?Number(c.mapcamTypeCode):c.typeNamespace==='mapcam'?Number(c.typeCode):null;
 if(code!==null)return [1,2,4,5,6].includes(code);
 if(c.source==='local-user')return c.type==='Камера скорости'||c.type==='Скорость + светофор';
 return false;
}
function compareWarnings(a,b){
 // A passed rear-facing control must not hide an upcoming point.
 const phase=Number(a.phase==='rear')-Number(b.phase==='rear');
 return phase||Number(controlsSpeed(b.camera))-Number(controlsSpeed(a.camera))||
  a.distanceM-b.distanceM||String(a.camera.id).localeCompare(String(b.camera.id));
}
module.exports={controlsSpeed,compareWarnings};
