'use strict';
class LanguagePanel{
 constructor(select,back){this.select=select;this.back=back;}
 buttons(first){const out=[{x:390,y:220,w:380,h:104,label:'РУССКИЙ',id:'language-ru',run:()=>this.select('ru')},{x:830,y:220,w:380,h:104,label:'ENGLISH',id:'language-en',run:()=>this.select('en')}];if(!first)out.push({x:610,y:382,w:380,h:54,label:'НАЗАД / BACK',id:'language-back',run:this.back});return out;}
 draw(cv,style,target,first){const C=style.colors;
  cv.fillRect(250,74,1100,390,C.panel);cv.strokeRoundRect(250,74,1100,390,0,2,C.edge);
  style.text(cv,'SET LANGUAGE',800,130,36,C.text,{align:'center',maxWidth:1020});
  style.text(cv,'ВЫБЕРИТЕ ЯЗЫК / CHOOSE YOUR LANGUAGE',800,180,24,C.muted,{align:'center',maxWidth:1020});
  this.buttons(first).forEach(b=>{style.drawSelection(cv,b.x,b.y,b.w,b.h);style.text(cv,b.label,b.x+b.w/2,b.y+b.h/2+12,30,C.text,{align:'center',maxWidth:b.w-30});target(cv,b.x,b.y,b.w,b.h,b.run,b.id);});
  if(first)style.text(cv,'МЕНЮ И ГОЛОС / MENUS AND VOICE',800,388,22,C.muted,{align:'center',maxWidth:1020});
 }
 tap(x,y,first){const b=this.buttons(first).find(b=>x>=b.x&&x<b.x+b.w&&y>=b.y&&y<b.y+b.h);if(b)b.run();}
}
module.exports={LanguagePanel};
