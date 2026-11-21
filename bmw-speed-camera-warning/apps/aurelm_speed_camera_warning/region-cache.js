'use strict';
const {distanceToCamera}=require('./camera-index');
const RADIUS=10000,RELOAD=5000,SAFE_TRAVEL=5600;
function valid(f){return f&&Number.isFinite(f.lat)&&Number.isFinite(f.lon)&&Math.abs(f.lat)<=90&&Math.abs(f.lon)<=180;}
class RegionCache {
 constructor(load,options){const o=options||{};this.load=load;this.now=o.now||Date.now;this.onActivate=o.onActivate||function(){};this.active=null;this.pending=null;this.latest=null;this.closed=false;this.version=0;this.retryAt=0;this.error=null;this.loads=0;this.fallbacks=0;}
 covers(f){return !!(valid(f)&&Math.abs(f.lat)<=80&&this.active&&distanceToCamera(f,this.active.center)<=SAFE_TRAVEL);}
 ensure(f){
  if(this.closed||!valid(f)||Math.abs(f.lat)>80)return;
  this.latest={lat:f.lat,lon:f.lon};
  if(this.pending){if(distanceToCamera(f,this.pending.center)>RELOAD)this.pending.cancelled=true;return;}
  if(this.active&&distanceToCamera(f,this.active.center)<RELOAD||this.now()<this.retryAt)return;
  const token={center:this.latest,cancelled:false};this.pending=token;
  const live=()=>!this.closed&&!token.cancelled;
  token.promise=Promise.resolve().then(()=>this.load(token.center,live)).then(result=>{
   if(!live()||!this.latest||distanceToCamera(this.latest,token.center)>RELOAD)return;
   this.active={center:token.center,index:result.index,count:result.count};this.version++;this.loads++;this.error=null;
   this.onActivate();
  }).catch(e=>{
   if(live()){this.error=String(e&&e.message||e);this.retryAt=this.now()+30000;}
  }).then(()=>{
   if(this.pending===token)this.pending=null;
   if(!this.closed&&this.latest)this.ensure(this.latest);
  });
 }
 near(f,radius,limit,fallback){this.ensure(f);if(this.covers(f))return this.active.index.near(f,radius,limit);this.fallbacks++;return fallback();}
 snapshot(){return {radiusM:RADIUS,reloadM:RELOAD,version:this.version,ready:!!this.active,loading:!!this.pending,count:this.active?this.active.count:0,loads:this.loads,fallbacks:this.fallbacks,error:this.error};}
 close(){this.closed=true;if(this.pending)this.pending.cancelled=true;this.active=null;this.latest=null;}
}
module.exports={RegionCache,RADIUS,RELOAD,SAFE_TRAVEL};
