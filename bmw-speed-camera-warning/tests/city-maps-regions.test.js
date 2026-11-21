'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const {CityRoads}=require('../apps/aurelm_speed_camera_warning/city-roads');
const dir=path.resolve(process.argv[2]),catalog=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json')));
const points={
 'moscow':[['Москва',55.757,37.615],['Троицк',55.484,37.306],['Коммунарка',55.569,37.489],['Зеленоград',55.991,37.215],['Дубна',56.735,37.166],['Серпухов',54.915,37.413]],
 'saint-petersburg':[['Петербург',59.9386,30.3141],['Кронштадт',59.995,29.765],['Петергоф',59.884,29.907],['Пушкин',59.722,30.416],['Колпино',59.748,30.589],['Выборг',60.71,28.75],['Тихвин',59.645,33.542]]
};
(async()=>{
 const report=[];
 for(const id of Object.keys(points)){
  const e=catalog.cities.find(x=>x.id===id);assert(e,id);
  const r=await new CityRoads(path.join(dir,e.file)).open();
  try{for(const p of points[id]){
   await r.ensure({lat:p[1],lon:p[2]},2000);
   assert(r.rows.length>10,'Missing roads: '+p[0]);assert(r.cache.size<=320);assert(r.cacheBytes<=12*1024*1024);
   report.push({city:p[0],rows:r.rows.length,cacheBytes:r.cacheBytes});
  }}finally{r.close();}
 }
 console.log(JSON.stringify({ok:true,coverage:report}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
