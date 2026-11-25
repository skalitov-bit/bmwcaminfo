'use strict';
const mb=n=>(n/1048576).toFixed(2)+' МБ';
// Fixed reference points [longitude, latitude]; never sort against the live GPS fix.
const MOSCOW=[37.6173,55.7558],REGION_CENTERS={moscow:MOSCOW,'tver-oblast':[35.9119,56.8587],'novgorod-oblast':[31.2755,58.5215],'saint-petersburg':[30.3159,59.9391],'mari-el':[47.8972,56.6344]};
const RUSSIA_ID='@russia';
const GROUPS={russia:{id:RUSSIA_ID,name:'Россия',center:MOSCOW},germany:{id:'@germany',name:'Германия',center:[13.405,52.52]}};
function mapGroup(e){
 if(isRussianMap(e))return 'russia';
 if(e.menuGroup==='germany'||['DE','DEU','GERMANY','ГЕРМАНИЯ'].indexOf(String(e.countryCode||e.country||'').toUpperCase())>=0)return 'germany';
 return null;
}
function isRussianMap(e){
 if(e.menuGroup)return e.menuGroup==='russia';
 // Explicit metadata supports future regions; known IDs cover older catalogs.
 const country=String(e.countryCode||e.country||'').toUpperCase();
 if(country)return ['RU','RUS','RUSSIA','РОССИЯ','РОССИЙСКАЯ ФЕДЕРАЦИЯ'].indexOf(country)>=0;
 return Object.prototype.hasOwnProperty.call(REGION_CENTERS,e.id)||['yoshkar-ola','republic-mari-el'].indexOf(e.id)>=0;
}
function distanceFromMoscow(e){
 const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
 // New catalogs may specify a city/administrative center. Older packages use known
 // centers; unknown regions fall back to the middle of their coverage bounds.
 let p=REGION_CENTERS[e.id]||(valid(e.center)?e.center:null);
 if(!p&&Array.isArray(e.bbox)&&e.bbox.length===4&&e.bbox.every(Number.isFinite))p=[(e.bbox[0]+e.bbox[2])/2,(e.bbox[1]+e.bbox[3])/2];
 if(!valid(p))return Infinity;
 const rad=Math.PI/180,a=MOSCOW[1]*rad,b=p[1]*rad,dl=(p[0]-MOSCOW[0])*rad;
 const h=Math.pow(Math.sin((b-a)/2),2)+Math.cos(a)*Math.cos(b)*Math.pow(Math.sin(dl/2),2);
 return 6371*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
class CityMapPanel{
 constructor(store,change,back,show){this.store=store;this.change=change;this.back=back;this.show=show;this.scope='countries';this.selected=null;this.offset=0;this.scrollRemainder=0;this.confirm=false;this.buttons=[];}
 rows(){const all=Object.assign({},this.store.installed);this.store.catalog.cities.forEach(e=>all[e.id]=e);return Object.keys(all).map(k=>({entry:all[k],distance:distanceFromMoscow(all[k])})).sort((a,b)=>a.distance-b.distance||a.entry.name.localeCompare(b.entry.name,'ru')||a.entry.id.localeCompare(b.entry.id)).map(row=>row.entry);}
 visibleRows(){const all=this.rows();if(GROUPS[this.scope])return all.filter(e=>mapGroup(e)===this.scope);
  const rows=all.filter(e=>!mapGroup(e));Object.keys(GROUPS).forEach(key=>{const count=all.filter(e=>mapGroup(e)===key).length;if(count)rows.push(Object.assign({},GROUPS[key],{group:true,scope:key,count}));});
  return rows.sort((a,b)=>a.id===RUSSIA_ID?-1:b.id===RUSSIA_ID?1:distanceFromMoscow(a)-distanceFromMoscow(b)||a.name.localeCompare(b.name,'ru'));
 }
 open(){this.showStorage=false;this.scope='countries';this.selected=null;this.offset=0;this.confirm=false;this.scrollRemainder=0;this.store.refresh();}
 enterGroup(scope){if(this.store.busy||!GROUPS[scope])return;this.countryPosition={selected:GROUPS[scope].id,offset:this.offset};this.scope=scope;this.selected=null;this.offset=0;this.confirm=false;this.scrollRemainder=0;this.change();if(this.focusItem&&this.selected)this.focusItem(this.selected);}
 enterRussia(){this.enterGroup('russia');}
 goBack(){if(this.showStorage){this.showStorage=false;this.change();return;}if(!GROUPS[this.scope]){this.back();return;}const id=GROUPS[this.scope].id;this.scope='countries';this.selected=id;this.offset=this.countryPosition?this.countryPosition.offset:0;this.confirm=false;this.scrollRemainder=0;this.change();if(this.focusItem)this.focusItem(id);}
 scrollRows(delta){if(this.store.busy)return false;const next=Math.max(0,Math.min(Math.max(0,this.visibleRows().length-3),this.offset+delta));if(next===this.offset)return false;this.offset=next;this.confirm=false;this.change();return true;}
 scrollPixels(dy){if(!Number.isFinite(dy)||this.store.busy)return false;this.scrollRemainder+=dy;const n=Math.trunc(this.scrollRemainder/42);if(!n)return true;this.scrollRemainder-=n*42;const moved=this.scrollRows(n);if(!moved)this.scrollRemainder=0;return moved;}
 moveFrom(id,delta){if(this.store.busy)return null;const rows=this.visibleRows(),at=rows.findIndex(e=>e.id===id);if(at<0)return null;const next=Math.max(0,Math.min(rows.length-1,at+delta));if(next===at)return null;this.selected=rows[next].id;this.offset=Math.max(0,Math.min(Math.max(0,rows.length-3),next<this.offset?next:next>=this.offset+3?next-2:this.offset));this.confirm=false;return this.selected;}
 bindNavigation(display,visible){if(!display||typeof display._ccu!=='function')return;this.focusItem=id=>display._focus({k:'tgt:map-city-'+id});const panel=this,original=display._ccu;display._ccu=function(v){const prefix='tgt:map-city-',key=this.focusKey,L=this.ccuLast,k=Number(v.frontRotaryEncoderOperation),pb=Number(v.frontRotaryEncoderPushButton),df=Number(v.frontRotaryEncoderDeflection);if(visible()&&!this.sheet&&key&&key.indexOf(prefix)===0&&L&&pb===0){let delta=((k-L.k+32768)&65535)-32768;if(Math.abs(delta)>64)delta=0;if(df!==L.df){if(df===1)delta=-1;else if(df===7)delta=1;}const id=delta&&panel.moveFrom(key.slice(prefix.length),delta);if(id){this.ccuLast={k,pb,df};this._focus({k:prefix+id});panel.change();return;}}return original.call(this,v);};}
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
 draw(cv,style,target){const s=this.store,C=style.colors,txt=style.text;this.buttons=[];
  if(this.showStorage){this.drawStorage(cv,style,target);return;}
  style.heading(cv,GROUPS[this.scope]?'КАРТЫ · '+GROUPS[this.scope].name.toUpperCase():'КАРТЫ · СТРАНЫ','');const button=(label,x,y,w,h,run,key,enabled,on)=>{cv.fillRect(x,y,w,h,C.panel);if(on)style.drawSelection(cv,x,y,w,h);txt(cv,label,x+w/2,y+h/2+8,22,enabled?C.text:C.muted,{align:'center',maxWidth:w-20});if(enabled){this.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,key);}};
  button('ОБНОВИТЬ СПИСОК',1220,12,360,44,()=>{this.confirm=false;s.refresh();},'maps-catalog',!s.busy);
  const rows=this.visibleRows();if(!rows.some(e=>e.id===this.selected))this.selected=rows[0]?rows[0].id:null;this.offset=Math.max(0,Math.min(this.offset,Math.max(0,rows.length-3)));cv.scroll=rows.length>3;
  txt(cv,rows.length?(GROUPS[this.scope]?'РЕГИОНЫ ':'СТРАНЫ ')+(this.offset+1)+'–'+Math.min(this.offset+3,rows.length)+' ИЗ '+rows.length+(GROUPS[this.scope]?' · ПО УДАЛЁННОСТИ ОТ МОСКВЫ':''):'КАРТ НЕТ',290,72,17,C.muted,{maxWidth:1000});
  rows.slice(this.offset,this.offset+3).forEach((e,i)=>{const y=82+i*68,on=e.id===this.selected;button(e.group?e.name.toUpperCase()+' > · РЕГИОНОВ: '+e.count:e.name.toUpperCase()+' · '+mb(e.bytes)+' · '+s.state(e.id),266,y,1214,60,()=>{if(e.group){this.enterGroup(e.scope);return;}this.selected=e.id;this.confirm=false;if(this.focusItem)this.focusItem(e.id);this.change();},'map-city-'+e.id,!s.busy,on);});
  if(rows.length>3){button('',1496,82,84,60,()=>this.scrollRows(-1),'maps-scroll-up',!s.busy&&this.offset>0);button('',1496,218,84,60,()=>this.scrollRows(1),'maps-scroll-down',!s.busy&&this.offset+3<rows.length);for(const a of [{y:112,dir:-1,on:!s.busy&&this.offset>0},{y:248,dir:1,on:!s.busy&&this.offset+3<rows.length}]){const color=a.on?C.text:C.muted;cv.line(1520,a.y-a.dir*8,1538,a.y+a.dir*8,3,color);cv.line(1538,a.y+a.dir*8,1556,a.y-a.dir*8,3,color);}cv.fillRect(1528,150,20,60,'#24262a');const h=Math.max(7,60*3/rows.length),y=150+(60-h)*this.offset/(rows.length-3);cv.fillRect(1528,y,20,h,C.red);}
  if(!rows.length)txt(cv,'СПИСОК ГОРОДОВ ПОЯВИТСЯ ПОСЛЕ ПОДКЛЮЧЕНИЯ К ИНТЕРНЕТУ',290,135,22,C.muted,{maxWidth:1250});
  const group=rows.find(e=>e.id===this.selected&&e.group),e=!group&&this.selected&&s.entry(this.selected),installed=e&&s.installed[e.id];if(!e)this.confirm=false;
  txt(cv,group?'НАЖМИТЕ «'+group.name.toUpperCase()+'», ЧТОБЫ ВЫБРАТЬ РЕГИОН':e?e.coverage:'КАРТЫ ДОРОГ СКАЧИВАЮТСЯ ОТДЕЛЬНО ОТ БАЗЫ КАМЕР',290,304,19,C.muted,{maxWidth:1240});
  txt(cv,e?'ДАТА ПАКЕТА: '+e.createdAt.slice(0,10)+(installed?' · НА MGU: '+installed.createdAt.slice(0,10):''):'',290,332,18,C.muted,{maxWidth:1240});
  const msg=this.confirm?'УДАЛИТЬ КАРТУ '+e.name.toUpperCase()+'? КАМЕРЫ И УВЕДОМЛЕНИЯ ОСТАНУТСЯ.':s.status;
  txt(cv,msg,290,366,20,this.confirm||s.lastError?C.yellow:C.text,{maxWidth:1240});
  if(s.busy){cv.fillRect(290,377,1260,5,'#252c32');cv.fillRect(290,377,1260*s.progress/100,5,C.red);txt(cv,s.progress+'%',1548,402,17,C.muted,{align:'right'});}
  if(this.confirm){button('ОТМЕНА',266,410,650,58,()=>{this.confirm=false;this.change();},'maps-cancel',true);button('УДАЛИТЬ КАРТУ',930,410,650,58,()=>{this.confirm=false;s.remove(e.id);},'maps-confirm',!s.busy);}
  else{button(installed?'ОБНОВИТЬ':'СКАЧАТЬ',266,410,426,58,()=>installed?s.update(e.id):s.install(e.id),'maps-install',!!e&&!s.busy);button('ПОКАЗАТЬ КАРТУ',710,410,426,58,()=>this.show(installed),'maps-show',!!installed&&!s.busy);button('УДАЛИТЬ',1154,410,426,58,()=>{this.confirm=true;this.change();},'maps-delete',!!installed&&!s.busy);}
  button('НАЗАД',266,480,300,38,()=>this.goBack(),'maps-back',true);
  button('ДИАГНОСТИКА HDD',584,480,330,38,()=>{this.showStorage=true;this.change();},'maps-hdd',true);
  txt(cv,'OpenStreetMap contributors · ODbL 1.0 · '+(s.limitLabel?s.limitLabel():'Лимит карт 128 МБ'),1578,507,15,C.muted,{align:'right',maxWidth:642});
 }
 drawStorage(cv,style,target){const s=this.store,C=style.colors,txt=style.text,d=s.storage.diagnostic(),tr=require('./i18n').t,why=require('./hdd-status').reason;
  style.heading(cv,'ДИАГНОСТИКА HDD','');cv.fillRect(266,74,1314,350,C.panel);
  const lines=[s.storageLabel(),d.root,d.active?'HDD ГОТОВ К ЗАПИСИ':why(d.reason||'MAP_HDD_UNAVAILABLE')];
  d.attempts.forEach(r=>{lines.push(r.path+(r.realPath&&r.realPath!==r.path?' -> '+r.realPath:''));lines.push('  '+tr(why(r.reason||(r.access?'ГОТОВО':'ДИСК ОБНАРУЖЕН')))+(r.helper||r.access==='helper'?' / '+tr('СИСТЕМНЫЙ ПОМОЩНИК'):''));if(r.directError&&!r.aliasOf)lines.push('  '+tr(r.helper==='ready'||r.access==='helper'?'ДОСТУП ПРЕДОСТАВЛЕН ПОМОЩНИКОМ':'НЕТ ПРЯМОЙ ЗАПИСИ: '+r.directError));});
  if(d.operationError)lines.push(why(d.operationError));
  if(d.freeBytes!==null)lines.push(tr('СВОБОДНО НА HDD')+': '+mb(d.freeBytes));
  lines.slice(0,11).forEach((line,i)=>txt(cv,line,290,102+i*28,19,C.text,{maxWidth:1250}));
  const buttons=[{label:'ПРОВЕРИТЬ HDD',x:266,key:'maps-hdd-check',run:()=>{if(!s.busy)s.prepareStorage();}},{label:'НАЗАД',x:936,key:'maps-hdd-back',run:()=>this.goBack()}];
  buttons.forEach(b=>{b.y=442;b.w=644;b.h=60;cv.fillRect(b.x,b.y,b.w,b.h,C.panel);txt(cv,b.label,b.x+b.w/2,b.y+39,22,C.text,{align:'center'});if(!s.busy||b.key==='maps-hdd-back'){this.buttons.push(b);target(cv,b.x,b.y,b.w,b.h,b.run,b.key);}});
 }
}
module.exports={CityMapPanel};
