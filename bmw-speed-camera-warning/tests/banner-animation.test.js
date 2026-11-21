'use strict';
const assert=require('assert'),path=require('path');
const app=path.resolve(process.argv[2]);
const {Canvas}=require(path.join(app,'kit/canvas'));
const {Recorder,play}=require(path.join(app,'kit/record'));
const {drawCentralAlert,BANNER_ANIMATION_MS}=require(path.join(app,'central-alert'));
const {drawSelection}=require(path.join(app,'screen-style'));
const event={camera:{id:'test',limit:60,camera_model:'СТРЕЛКА',mapcamTypeCode:1},type:'speeding',speeding:true,distanceM:500,speedKmh:81};
function frame(ms){const cv=new Recorder(1456,174);drawCentralAlert(cv,event,81,{x:0,y:0,w:1456},ms);return play(cv.words(),new Canvas(1456,174));}
assert.deepStrictEqual(frame(0).d,frame(BANNER_ANIMATION_MS).d,'Loop boundary must be continuous');
assert.notDeepStrictEqual(frame(0).d,frame(BANNER_ANIMATION_MS/4).d,'Gradient must move');
const background=new Canvas(1456,174);drawSelection(background,0,0,1456,174);
function highlightX(ms){const cv=frame(ms);let best=-1,bestX=0;for(let x=5;x<1455;x++){const i=(165*1456+x)*4,delta=cv.d[i]-background.d[i];if(delta>best){best=delta;bestX=x;}}return bestX;}
const positions=[300,600,1200,1800].map(highlightX);
assert(positions.every((x,i)=>!i||x>positions[i-1]),'Highlight must advance right');
console.log('Banner animation passed: continuous 2400 ms loop, rightward motion, native recorder rendering.');
