'use strict';
const mb=n=>(n/1048576).toFixed(2)+' МБ';
class CityMapPanel{
 constructor(store,change,back,show){this.store=store;this.change=change;this.back=back;this.show=show;this.selected=null;this.page=0;this.confirm=false;this.buttons=[];}
 rows(){const all=Object.assign({},this.store.installed);this.store.catalog.cities.forEach(e=>all[e.id]=e);return Object.keys(all).sort().map(k=>all[k]);}
 open(){this.confirm=false;this.store.refresh();}
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
 draw(cv,style,target){const s=this.store,C=style.colors,txt=style.text;this.buttons=[];
  style.heading(cv,'КАРТЫ ГОРОДОВ','');const button=(label,x,y,w,h,run,key,enabled,on)=>{cv.fillRect(x,y,w,h,C.panel);if(on)style.drawSelection(cv,x,y,w,h);txt(cv,label,x+w/2,y+h/2+8,22,enabled?C.text:C.muted,{align:'center',maxWidth:w-20});if(enabled){this.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,key);}};
  button('ОБНОВИТЬ СПИСОК',1220,12,360,44,()=>{this.confirm=false;s.refresh();},'maps-catalog',!s.busy);
  const rows=this.rows();if(!rows.some(e=>e.id===this.selected))this.selected=rows[0]?rows[0].id:null;this.page=Math.min(this.page,Math.max(0,Math.ceil(rows.length/3)-1));
  rows.slice(this.page*3,this.page*3+3).forEach((e,i)=>{const y=82+i*68,on=e.id===this.selected;button(e.name.toUpperCase()+' · '+mb(e.bytes)+' · '+s.state(e.id),266,y,1314,60,()=>{this.selected=e.id;this.confirm=false;this.change();},'map-city-'+e.id,!s.busy,on);});
  if(!rows.length)txt(cv,'СПИСОК ГОРОДОВ ПОЯВИТСЯ ПОСЛЕ ПОДКЛЮЧЕНИЯ К ИНТЕРНЕТУ',290,135,22,C.muted,{maxWidth:1250});
  const e=this.selected&&s.entry(this.selected),installed=e&&s.installed[e.id];
  txt(cv,e?e.coverage:'КАРТЫ ДОРОГ СКАЧИВАЮТСЯ ОТДЕЛЬНО ОТ БАЗЫ КАМЕР',290,304,19,C.muted,{maxWidth:1240});
  txt(cv,e?'ДАТА ПАКЕТА: '+e.createdAt.slice(0,10)+(installed?' · НА MGU: '+installed.createdAt.slice(0,10):''):'',290,332,18,C.muted,{maxWidth:1240});
  const msg=this.confirm?'УДАЛИТЬ КАРТУ '+e.name.toUpperCase()+'? КАМЕРЫ И УВЕДОМЛЕНИЯ ОСТАНУТСЯ.':s.status;
  txt(cv,msg,290,366,20,this.confirm||s.lastError?C.yellow:C.text,{maxWidth:1240});
  if(s.busy){cv.fillRect(290,377,1260,5,'#252c32');cv.fillRect(290,377,1260*s.progress/100,5,C.red);txt(cv,s.progress+'%',1548,402,17,C.muted,{align:'right'});}
  if(this.confirm){button('ОТМЕНА',266,410,650,58,()=>{this.confirm=false;this.change();},'maps-cancel',true);button('УДАЛИТЬ КАРТУ',930,410,650,58,()=>{this.confirm=false;s.remove(e.id);},'maps-confirm',!s.busy);}
  else{button(installed?'ОБНОВИТЬ':'СКАЧАТЬ',266,410,426,58,()=>installed?s.update(e.id):s.install(e.id),'maps-install',!!e&&!s.busy);button('ПОКАЗАТЬ КАРТУ',710,410,426,58,()=>this.show(installed),'maps-show',!!installed&&!s.busy);button('УДАЛИТЬ',1154,410,426,58,()=>{this.confirm=true;this.change();},'maps-delete',!!installed&&!s.busy);}
  button('НАЗАД',266,480,300,38,this.back,'maps-back',true);
  if(rows.length>3){button('‹',584,480,80,38,()=>{this.page=Math.max(0,this.page-1);this.change();},'maps-page-prev',this.page>0);button('›',676,480,80,38,()=>{this.page++;this.change();},'maps-page-next',(this.page+1)*3<rows.length);}
  txt(cv,'OpenStreetMap contributors · ODbL 1.0 · Лимит карт 128 МБ',1578,507,17,C.muted,{align:'right',maxWidth:800});
 }
}
module.exports={CityMapPanel};
