'use strict';
const assert=require('assert');
const {CityMapPanel}=require('../apps/aurelm_speed_camera_warning/city-map-panel');
const ids=['moscow','tver-oblast','novgorod-oblast','saint-petersburg','mari-el'];
const entries=ids.map((id,i)=>({id,name:'Region '+(5-i),bbox:[0,0,1,1]}));
const store={installed:{},catalog:{cities:entries.slice().reverse()},busy:false};
const panel=new CityMapPanel(store,()=>{},()=>{},()=>{}),order=()=>panel.rows().map(e=>e.id);
assert.deepStrictEqual(order(),ids,'distance order, not alphabetic or catalog order');
for(let i=0;i<5;i++){store.catalog.cities.push(store.catalog.cities.shift());assert.deepStrictEqual(order(),ids);}
store.installed['mari-el']=Object.assign({},entries[4],{name:'Old name'});
assert.deepStrictEqual(order(),ids,'installed entry merged without duplicates');
assert.equal(panel.rows()[4].name,entries[4].name,'catalog metadata wins');
store.catalog.cities=entries.slice(0,4);assert.deepStrictEqual(order(),ids,'installed-only map keeps its geographic position offline');
panel.enterRussia();panel.selected='novgorod-oblast';assert.equal(panel.moveFrom(panel.selected,1),'saint-petersburg');assert.equal(panel.moveFrom(panel.selected,1),'mari-el');assert.equal(panel.offset,2);assert.equal(panel.moveFrom(panel.selected,-1),'saint-petersburg');
store.installed={};store.catalog.cities=[
 {id:'unknown',name:'A'},
 {id:'far',name:'B',center:[50,56]},
 {id:'near-bounds',name:'Z',bbox:[37,56,38,56.2]},
 {id:'moscow',name:'M'},
 {id:'east',name:'Same',center:[38.6173,55.7558]},
 {id:'west',name:'Same',center:[36.6173,55.7558]}
];
assert.deepStrictEqual(order(),['moscow','near-bounds','east','west','far','unknown'],'new regions, bbox fallback, ties and missing coordinates');
const original=JSON.stringify(store.catalog);order();assert.equal(JSON.stringify(store.catalog),original,'sorting does not rewrite catalog');
console.log('PASS maps: fixed Moscow distance, refresh/offline order, selection/scroll, new region centers and safe fallback');
