'use strict';
// Match explicit source codes, not model names or addresses.
function policeKind(c){
 if(!c)return null;
 if(c.typeNamespace==='estrelka')return Number(c.typeCode)===206?'post':null;
 const code=c.mapcamTypeCode!=null?Number(c.mapcamTypeCode):c.typeNamespace==='mapcam'?Number(c.typeCode):null;
 return code===20?'stationary':null;
}
function iconFor(c){return policeKind(c)?require('./police-icon'):require('./camera-icon');}
module.exports={policeKind,iconFor};
