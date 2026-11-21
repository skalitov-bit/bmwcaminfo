'use strict';
// Bounded in-memory evidence. Exported only when the user requests a report.
const quality=require('./gps-quality');
const HISTORY_LIMIT=12;
function age(f,now){return f&&Number.isFinite(f.timeMs)?now-f.timeMs:null;}
function decision(f,now){
 let reason='accepted';
 if(!f)reason='no_current_fix';
 else if(!Number.isFinite(f.timeMs))reason='invalid_timestamp';
 else if(now-f.timeMs>3000)reason='fix_stale';
 else if(f.timeMs>now+500)reason='fix_in_future';
 else if(![f.lat,f.lon].every(Number.isFinite)||Math.abs(f.lat)>90||Math.abs(f.lon)>180)reason='invalid_coordinates';
 else if(!Number.isFinite(f.speedKmh)||f.speedKmh<0||f.speedKmh>350)reason='invalid_speed';
 else if(quality.trustedPosition(f))reason='accepted_vehicle_validity_accuracy_not_reported';
 else if(!Number.isFinite(f.accuracyM)||f.accuracyM<=0)reason='accuracy_unavailable';
 else if(f.accuracyM>quality.RETAIN)reason='accuracy_above_35m';
 return {blocked:!quality.usable(f,now),reason,accuracyM:f?f.accuracyM:null,
  qualityState:f&&f.warningAccuracyState||null,ageMs:age(f,now),
  scope:'GPS eligibility for normal camera detection; other notification rules are separate'};
}
class GpsDiagnostics{
 constructor(decode){this.decode=decode;this.history=[];this.latest={RMC:null,GGA:null,GST:null};this.lastFix=null;this.lastAssembly=null;this.receivedAt=null;this.payloadError=null;}
 observe(payload,now,assembler,fix){
  this.receivedAt=now;
  const raw=payload&&payload.nmeaString;
  this.payloadError=typeof raw!=='string'||!raw.length?'missing_nmea':raw.length>4096?'payload_too_large':/[^\x20-\x7e\r\n]/.test(raw)?'invalid_characters':null;
  if(!this.payloadError)raw.split(/[\r\n]+/).forEach(line=>{
   if(!line.trim())return;
   const entry=this.decode(line,now);
   if(!entry)return;
   this.latest[entry.kind]=entry;this.history.push(entry);
   if(this.history.length>HISTORY_LIMIT)this.history.shift();
  });
  this.assemblyStatus=assembler.status;
  const r=assembler.parts.RMC.find(v=>v.valid),g=assembler.parts.GGA.find(v=>v.valid);
  this.pendingReason=this.payloadError||(!r?'missing_valid_fresh_rmc':!g?'missing_valid_fresh_gga':Math.abs(r.time-g.time)>500?'rmc_gga_time_mismatch':'no_new_matching_pair');
  if(r&&g&&Math.abs(r.time-g.time)<=500){
   const rad=Math.PI/180,x=(g.lon-r.lon)*Math.cos((g.lat+r.lat)*rad/2),y=g.lat-r.lat;
   if(Math.sqrt(x*x+y*y)*rad*6371008.8>50)this.pendingReason='rmc_gga_position_mismatch';
  }
  if(fix){this.lastFix=Object.assign({},fix);this.lastAssembly=assembler.lastAssembly;this.pendingReason=null;}
  else if(assembler.status==='duplicate')this.pendingReason='duplicate_measurement';
 }
 snapshot(now,transport,effectiveFix){
  const acceptance=decision(effectiveFix,now);
  if(!effectiveFix&&this.lastFix&&age(this.lastFix,now)>3000){acceptance.reason='fix_stale';acceptance.ageMs=age(this.lastFix,now);}
  return {schema:1,capturedAt:new Date(now).toISOString(),source:'BMW SatellitePositioning',
   transport,receiptAgeMs:this.receivedAt===null?null:now-this.receivedAt,
   decision:acceptance,effectiveFix:effectiveFix?Object.assign({},effectiveFix):null,
   lastAssembledFix:this.lastFix?Object.assign({},this.lastFix,{ageMs:age(this.lastFix,now)}):null,
   assembly:{status:this.assemblyStatus||'not_received',pendingReason:this.pendingReason||null,selected:this.lastAssembly},
   latest:this.latest,history:this.history.slice(),historyLimit:HISTORY_LIMIT,
   thresholds:{normalAccuracyMaxM:35,preciseAccuracyBelowM:15,maxFixAgeMs:3000,maxFutureMs:500,rmcGgaMaxDeltaMs:500,rmcGgaMaxDistanceM:50,ggaGstMaxDeltaMs:100},
   containsLocation:true,note:'Raw NMEA contains location. Receipt time does not refresh measurement time. No GPS or notification settings changed.'};
 }
}
module.exports={GpsDiagnostics,decision};
