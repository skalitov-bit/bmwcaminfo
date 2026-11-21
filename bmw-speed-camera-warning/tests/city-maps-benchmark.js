'use strict';
const fs=require('fs'),path=require('path');
const {CityRoads}=require('../apps/aurelm_speed_camera_warning/city-roads');
const {CityMapRenderer,viewportBounds}=require('../apps/aurelm_speed_camera_warning/city-map-renderer');
const dir=path.resolve(process.argv[2]),pkg=path.resolve(process.argv[3]);
const {Canvas}=require(pkg+'/kit/canvas'),{Recorder,play}=require(pkg+'/kit/record');
const style=require(pkg+'/screen-style'),{project}=require(pkg+'/map-projection');
const area={x:266,y:74,w:850,h:398};
function clip(a,b){let lo=0,hi=1;const dx=b[0]-a[0],dy=b[1]-a[1];for(const [p,q] of [[-dx,a[0]-area.x-12],[dx,area.x+area.w-12-a[0]],[-dy,a[1]-area.y-42],[dy,area.y+area.h-12-a[1]]]){if(p===0){if(q<0)return null;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;}return [[a[0]+lo*dx,a[1]+lo*dy],[a[0]+hi*dx,a[1]+hi*dy]];}
async function run(){if(global.gc)global.gc();const before=process.memoryUsage();const entry=JSON.parse(fs.readFileSync(dir+'/catalog.json')).cities[0],r=await new CityRoads(path.join(dir,entry.file)).open();const center={lat:55.757,lon:37.615};const cpu=process.cpuUsage();await r.ensure(center,6500,viewportBounds(center,.10875,0,area,true));const loadCpu=process.cpuUsage(cpu);if(global.gc)global.gc();const after=process.memoryUsage(),renderer=new CityMapRenderer();
 const runCase=(roads,moving,png)=>{const count=png?15:60,start=process.hrtime(),cpu=process.cpuUsage();let size=0;
  for(let i=0;i<count;i++){const c={lat:center.lat+(moving?i*.00002:0),lon:center.lon};const cv=new Recorder(1600,520);cv.clear('#000000');for(let x=306;x<1116;x+=80)cv.line(x,82,x,464,1,'#1b232d');for(let y=104;y<472;y+=60)cv.line(274,y,1108,y,1,'#1b232d');
   if(roads)renderer.draw(cv,r,c,.10875,0,area,(lat,lon)=>project(lat,lon,c,.10875,area,0,true),clip,style.text);
   const words=cv.words();if(png){const image=play(words,new Canvas(1600,520));size=image.png().length;}else size=JSON.stringify(words).length;
  }
  const time=process.hrtime(start),used=process.cpuUsage(cpu);return {frames:count,msPerFrame:(time[0]*1000+time[1]/1e6)/count,cpuMsPerFrame:(used.user+used.system)/1000/count,bytes:size};};
 // Warm text/recorder caches before comparing.
 runCase(true,true,false);
 const results={node:process.version,platform:process.platform,packageBytes:entry.bytes,load:r.stats,loadCpuMs:(loadCpu.user+loadCpu.system)/1000,heapDelta:after.heapUsed-before.heapUsed,rssDelta:after.rss-before.rss,baselineGpu:runCase(false,false,false),roadsGpuStatic:runCase(true,false,false),roadsGpuMoving:runCase(true,true,false),baselinePng:runCase(false,false,true),roadsPngMoving:runCase(true,true,true),render:renderer.stats};
 console.log(JSON.stringify(results,null,2));r.close();
}
run().catch(e=>{console.error(e.stack);process.exitCode=1;});

