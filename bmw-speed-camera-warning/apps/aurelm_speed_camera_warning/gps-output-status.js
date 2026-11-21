'use strict';
const {freshFix}=require('./mapcam-warnings');
// Uses the same validity threshold as camera guidance, without inventing fixes.
class GpsOutputStatus{
 constructor(){this.seen=false;}
 update(fix,now,estimated,enabled){
  if(enabled&&fix&&fix.warningAccuracyState==='degraded'&&freshFix(fix,now)){this.seen=true;return 'degraded';}
  if(freshFix(fix,now)){this.seen=true;return '';}
  if(!enabled)return '';
  if(estimated)return 'reserve';
  if(fix&&Number.isFinite(fix.timeMs)&&now-fix.timeMs<=3000&&fix.timeMs<=now+500)return 'unreliable';
  return this.seen?'lost':'searching';
 }
}
module.exports={GpsOutputStatus};
