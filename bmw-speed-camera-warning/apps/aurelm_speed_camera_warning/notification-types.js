'use strict';
// Control functions, never hardware models. Unknown future types keep their old behaviour.
const TYPES=[
 ['speed','Камера скорости'],['integrated','Встроенная камера'],
 ['red_light','Красный свет'],['stop_line','Стоп-линия'],['average','Средняя скорость'],
 ['mobile','Мобильная камера'],['mobile_speed','Мобильный контроль скорости'],
 ['overtaking','Мобильный контроль обгона'],['stop','Мобильный контроль STOP'],
 ['crosswalk','Контроль перехода'],['bus_lane','Полоса общественного транспорта'],
 ['traffic','Комплекс контроля ПДД'],['toll','Оплата проезда'],['parking','Остановка и стоянка'],
 ['weight','Весовой контроль'],['platon','Платон'],['dummy','Муляж'],
 ['police','Пост ДПС'],['police_stationary','Стационарный пост ДПС'],
 ['school','Школа / опасный переход'],['bump','Лежачий полицейский'],['other','Другие камеры']
].map(x=>({id:x[0],label:x[1],defaultOn:x[0]!=='school'&&x[0]!=='bump'}));
const M={1:'speed',2:'integrated',3:'red_light',4:'average',5:'mobile',6:'mobile_speed',7:'overtaking',8:'stop',9:'crosswalk',11:'bus_lane',13:'traffic',15:'toll',16:'parking',20:'police_stationary',22:'school',102:'bump'};
const E={15:'speed',192:'speed',68:'stop_line',194:'red_light',16:'bus_lane',155:'dummy',156:'traffic',199:'mobile',208:'parking',210:'platon',211:'weight',227:'average',206:'police',200:'bump'};
function typeOf(camera){
 const c=camera||{};
 if(c.camera_family==='dummy')return 'dummy';
 if(c.typeNamespace==='estrelka')return E[Number(c.typeCode)]||'other';
 const code=c.mapcamTypeCode!=null?Number(c.mapcamTypeCode):c.typeNamespace==='mapcam'?Number(c.typeCode):null;
 if(code!==null)return M[code]||'other';
 if(c.source==='local-user')return c.type==='Светофор'?'red_light':c.type==='Камера скорости'||c.type==='Скорость + светофор'?'speed':'other';
 return 'other';
}
function hazardKind(c){const id=typeOf(c);return id==='school'||id==='bump'?id:null;}
function key(channel,id){return 'notification_'+channel+'_type_'+id;}
function enabled(get,channel,c){const id=typeof c==='string'?c:typeOf(c),value=get(key(channel,id));return value==='off'?false:value==='on'?true:id!=='school'&&id!=='bump';}
function allowed(options,channel,c){const fn=options&&options[channel+'Enabled'];return typeof fn==='function'?fn(c):!hazardKind(c);}
function settingDefinitions(){return ['banner','voice'].reduce((all,channel)=>all.concat(TYPES.map(t=>({key:key(channel,t.id),label:(channel==='banner'?'Баннер: ':'Голос: ')+t.label,type:'choice',default:t.defaultOn?'on':'off',options:[['on','Включено'],['off','Выключено']]}))),[]);}
module.exports={TYPES,typeOf,hazardKind,key,enabled,allowed,settingDefinitions};
