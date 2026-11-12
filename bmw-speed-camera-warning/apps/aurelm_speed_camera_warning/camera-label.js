'use strict';
// Category names from the MapCam type code; these are not hardware model names.
const {policeKind}=require('./point-kind');
const TYPES={
 1:['Стационарная камера скорости','СТАЦ. СКОРОСТЬ'],
 2:['Встроенная камера','ВСТРОЕННАЯ'],
 3:['Контроль проезда на красный','КРАСНЫЙ СВЕТ'],
 4:['Контроль средней скорости','СРЕДНЯЯ СКОР.'],
 5:['Мобильная камера','МОБИЛЬНАЯ'],
 6:['Мобильный пост контроля скорости','МОБ. СКОРОСТЬ'],
 7:['Мобильный пост контроля обгона','МОБ. ОБГОН'],
 8:['Мобильный пост контроля STOP','МОБ. STOP'],
 9:['Мобильный пост контроля перехода','МОБ. ПЕРЕХОД'],
 11:['Камера полосы транспорта','ПОЛОСА ОТ'],
 13:['Комплекс контроля ПДД','КОНТРОЛЬ ПДД'],
 15:['Камера оплаты проезда','ОПЛАТА ПРОЕЗДА'],
 16:['Камера остановки и стоянки','ОСТАНОВКА/СТОЯНКА']
};
function category(camera){
 const c=camera||{},known=TYPES[c.mapcamTypeCode];
 if(typeof c.camera_model==='string'&&c.camera_model.trim()){
  const model=c.camera_model.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
  const full=(c.camera_family==='dummy'?'МУЛЯЖ / ':'')+model;
  return {full:full.slice(0,48),short:full.toUpperCase().replace(/[^А-ЯЁA-Z0-9 /+.:-]/g,'').slice(0,17)};
 }
 if(known)return {full:known[0],short:known[1]};
 const value=typeof c.type==='string'&&c.type.trim()?c.type:typeof c.name==='string'?c.name:'';
 const full=value.replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim()||'Камера';
 return {full:full.length>48?full.slice(0,47)+'…':full,short:full.toUpperCase().replace(/[^А-ЯЁA-Z0-9 /+.:-]/g,'').slice(0,17)||'КАМЕРА'};
}
// Source codes describe the control function; model names never imply it.
const ESTRELKA_CONTROL={15:'СКОРОСТЬ',192:'СКОРОСТЬ',68:'СТОП-ЛИНИЯ',194:'КРАСНЫЙ СВЕТ',
 16:'ПОЛОСА ОТ',155:'МУЛЯЖ',156:'КОНТРОЛЬ ПДД',199:'МОБИЛЬНАЯ',
 208:'ОСТАНОВКА/СТОЯНКА',210:'ПЛАТОН',211:'ВЕСОВОЙ КОНТРОЛЬ',227:'СРЕДНЯЯ СКОРОСТЬ'};
function hudLabels(camera){
 const c=camera||{},police=policeKind(c);
 if(police)return {control:'ПОСТ ДПС',model:police==='stationary'?'СТАЦИОНАРНЫЙ':''};
 let control;
 if(c.typeNamespace==='estrelka')control=ESTRELKA_CONTROL[c.typeCode];
 else {
  const code=c.mapcamTypeCode!=null?c.mapcamTypeCode:c.typeNamespace==='mapcam'?c.typeCode:null;
  control=code===1||code===6?'СКОРОСТЬ':TYPES[code]&&TYPES[code][1];
 }
 const clean=s=>String(s||'').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().toUpperCase().replace(/[^А-ЯЁA-Z0-9 /+.:-]/g,'');
 control=clean(control||c.type||'КАМЕРА').slice(0,48)||'КАМЕРА';
 const model=typeof c.camera_model==='string'?clean(c.camera_model).slice(0,48):'';
 return {control,model};
}
module.exports={category,hudLabels};
