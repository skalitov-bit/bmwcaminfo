'use strict';
const mb=n=>(n/1048576).toFixed(2)+' МБ';
class CityMapPanel{
 constructor(store,change,back,show){this.store=store;this.change=change;this.back=back;this.show=show;this.selected=null;this.offset=0;this.scrollRemainder=0;this.confirm=false;this.buttons=[];}
 rows(){const all=Object.assign({},this.store.installed);this.store.catalog.cities.forEach(e=>all[e.id]=e);return Object.keys(all).map(k=>all[k]).sort((a,b)=>a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id));}
 open(){this.confirm=false;this.scrollRemainder=0;this.store.refresh();}
 scrollRows(delta){if(this.store.busy)return false;const next=Math.max(0,Math.min(Math.max(0,this.rows().length-3),this.offset+delta));if(next===this.offset)return false;this.offset=next;this.confirm=false;this.change();return true;}
 scrollPixels(dy){if(!Number.isFinite(dy)||this.store.busy)return false;this.scrollRemainder+=dy;const n=Math.trunc(this.scrollRemainder/42);if(!n)return true;this.scrollRemainder-=n*42;const moved=this.scrollRows(n);if(!moved)this.scrollRemainder=0;return moved;}
 moveFrom(id,delta){if(this.store.busy)return null;const rows=this.rows(),at=rows.findIndex(e=>e.id===id);if(at<0)return null;const next=Math.max(0,Math.min(rows.length-1,at+delta));if(next===at)return null;this.selected=rows[next].id;this.offset=Math.max(0,Math.min(Math.max(0,rows.length-3),next<this.offset?next:next>=this.offset+3?next-2:this.offset));this.confirm=false;return this.selected;}
 bindNavigation(display,visible){if(!display||typeof display._ccu!=='function')return;this.focusItem=id=>display._focus({k:'tgt:map-city-'+id});const panel=this,original=display._ccu;display._ccu=function(v){const prefix='tgt:map-city-',key=this.focusKey,L=this.ccuLast,k=Number(v.frontRotaryEncoderOperation),pb=Number(v.frontRotaryEncoderPushButton),df=Number(v.frontRotaryEncoderDeflection);if(visible()&&!this.sheet&&key&&key.indexOf(prefix)===0&&L&&pb===0){let delta=((k-L.k+32768)&65535)-32768;if(Math.abs(delta)>64)delta=0;if(df!==L.df){if(df===1)delta=-1;else if(df===7)delta=1;}const id=delta&&panel.moveFrom(key.slice(prefix.length),delta);if(id){this.ccuLast={k,pb,df};this._focus({k:prefix+id});panel.change();return;}}return original.call(this,v);};}
 tap(x,y){const b=this.buttons.find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
 draw(cv,style,target){const s=this.store,C=style.colors,txt=style.text;this.buttons=[];
  style.heading(cv,'КАРТЫ ГОРОДОВ','');const button=(label,x,y,w,h,run,key,enabled,on)=>{cv.fillRect(x,y,w,h,C.panel);if(on)style.drawSelection(cv,x,y,w,h);txt(cv,label,x+w/2,y+h/2+8,22,enabled?C.text:C.muted,{align:'center',maxWidth:w-20});if(enabled){this.buttons.push({x,y,w,h,run});target(cv,x,y,w,h,run,key);}};
  button('ОБНОВИТЬ СПИСОК',1220,12,360,44,()=>{this.confirm=false;s.refresh();},'maps-catalog',!s.busy);
  const rows=this.rows();if(!rows.some(e=>e.id===this.selected))this.selected=rows[0]?rows[0].id:null;this.offset=Math.max(0,Math.min(this.offset,Math.max(0,rows.length-3)));cv.scroll=rows.length>3;
  txt(cv,rows.length?'КАРТЫ '+(this.offset+1)+'–'+Math.min(this.offset+3,rows.length)+' ИЗ '+rows.length:'КАРТ НЕТ',290,72,17,C.muted,{maxWidth:1000});
  rows.slice(this.offset,this.offset+3).forEach((e,i)=>{const y=82+i*68,on=e.id===this.selected;button(e.name.toUpperCase()+' · '+mb(e.bytes)+' · '+s.state(e.id),266,y,1214,60,()=>{this.selected=e.id;this.confirm=false;if(this.focusItem)this.focusItem(e.id);this.change();},'map-city-'+e.id,!s.busy,on);});
  if(rows.length>3){button('',1496,82,84,60,()=>this.scrollRows(-1),'maps-scroll-up',!s.busy&&this.offset>0);button('',1496,218,84,60,()=>this.scrollRows(1),'maps-scroll-down',!s.busy&&this.offset+3<rows.length);for(const a of [{y:112,dir:-1,on:!s.busy&&this.offset>0},{y:248,dir:1,on:!s.busy&&this.offset+3<rows.length}]){const color=a.on?C.text:C.muted;cv.line(1520,a.y-a.dir*8,1538,a.y+a.dir*8,3,color);cv.line(1538,a.y+a.dir*8,1556,a.y-a.dir*8,3,color);}cv.fillRect(1528,150,20,60,'#24262a');const h=Math.max(7,60*3/rows.length),y=150+(60-h)*this.offset/(rows.length-3);cv.fillRect(1528,y,20,h,C.red);}
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
  txt(cv,'OpenStreetMap contributors · ODbL 1.0 · Лимит карт 128 МБ',1578,507,17,C.muted,{align:'right',maxWidth:800});
 }
}
module.exports={CityMapPanel};
