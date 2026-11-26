'use strict';
const qrcode=require('./report-qrcode');
const URL='https://pay.cloudtips.ru/p/93ccdd74';
const INTERNATIONAL_URL='https://buymeacoffee.com/skalitov';
// Code-native artwork: the donut does not depend on emoji/font support on MGU.
function donut(cv,x,y,r,bg){
 const k=r/20,q=r/54;
 cv.circle(x,y+q,r,'#b87535');cv.circle(x,y-2*q,r-3*q,'#edb56b');
 cv.circle(x,y-4*q,r-9*q,'#d32c36');
 [[-10,-7,4,2,'#ffffff'],[7,-10,2,4,'#ffe267'],[-12,5,4,-2,'#4fb7cb'],[8,8,4,1,'#ffffff'],[0,12,2,-4,'#ad8cf2'],[13,-1,-2,4,'#e77b44'],[-2,-14,4,1,'#4fb7cb']].forEach(s=>{
  cv.line(x+s[0]*k,y+s[1]*k,x+(s[0]+s[2])*k,y+(s[1]+s[3])*k,2.5*k,s[4]);
 });
 cv.circle(x,y,6*k,'#b87535');cv.circle(x,y,4*k,bg);
}
class SupportPanel{
 constructor(close){this.close=close;this.codes=Object.create(null);}
 matrix(url){url=url||URL;if(!this.codes[url]){const qr=qrcode(0,'M');qr.addData(url,'Byte');qr.make();this.codes[url]=qr;}return this.codes[url];}
 drawQr(cv,url,x,y){
  const qr=this.matrix(url),n=qr.getModuleCount(),cell=8,size=(n+8)*cell;
  cv.fillRect(x,y,size,size,'#ffffff');
  for(let row=0;row<n;row++)for(let col=0;col<n;col++)if(qr.isDark(row,col))cv.fillRect(x+(col+4)*cell,y+(row+4)*cell,cell,cell,'#000000');
  return size;
 }
 draw(cv,style,target){
  const C=style.colors,txt=style.text;
  cv.fillRect(210,28,1180,462,C.panel);cv.strokeRoundRect(210,28,1180,462,0,2,C.edge);
  donut(cv,252,66,22,C.panel);txt(cv,'ПОДДЕРЖАТЬ ПРОЕКТ',292,77,30,C.text,{maxWidth:1000});
  const leftSize=this.drawQr(cv,URL,246,112),rightSize=this.drawQr(cv,INTERNATIONAL_URL,1062,112);
  txt(cv,'CLOUDTIPS',246+leftSize/2,443,25,C.text,{align:'center',maxWidth:296});
  txt(cv,'ОПЛАТА ИЗ РФ',246+leftSize/2,472,18,C.muted,{align:'center',maxWidth:296});
  txt(cv,'BUY ME A COFFEE',1062+rightSize/2,443,25,C.text,{align:'center',maxWidth:296});
  txt(cv,'ОПЛАТА ИЗ ДРУГИХ СТРАН',1062+rightSize/2,472,18,C.muted,{align:'center',maxWidth:296});
  const center=802;
  [['СПАСИБО, ЧТО ПОЛЬЗУЕТЕСЬ SPEEDCAM!',147,23,C.text],
   ['Отсканируйте любой QR-код',194,24,C.text],
   ['камерой телефона.',226,24,C.text],
   ['База данных и проект',273,21,C.muted],
   ['распространяются бесплатно.',302,21,C.muted],
   ['Запрос карт регионов',340,22,C.text],
   ['и другие пожелания:',368,22,C.text]].forEach(t=>txt(cv,t[0],center,t[1],t[2],t[3],{align:'center',maxWidth:462,preserveCommas:true}));
  const contact='TELEGRAM: skalitov',contactLeft=center-(require('./cluster-text').width(contact,24)+48)/2,iconX=contactLeft+17;
  cv.circle(iconX,402,17,'#229ed9');
  // Optical centering: align the filled paper plane's centre with the circle.
  cv.quad([[iconX-15,401],[iconX+9,392],[iconX+5,413],[iconX-5,406]],'#ffffff');
  cv.quad([[iconX-5,406],[iconX+4,397],[iconX-2,408],[iconX-3,412]],'#b6e0f4');
  txt(cv,contact,contactLeft+48,410,24,C.text,{maxWidth:415});
  style.drawSelection(cv,571,432,462,42);
  txt(cv,'ЗАКРЫТЬ',center,461,23,C.text,{align:'center',maxWidth:422});
  target(cv,571,432,462,42,this.close,'support-close');
 }
 tap(x,y){if(x>=571&&x<1033&&y>=432&&y<474)this.close();}
}
module.exports={SupportPanel,donut,URL,INTERNATIONAL_URL};
