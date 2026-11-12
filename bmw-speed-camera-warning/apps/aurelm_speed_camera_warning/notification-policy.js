'use strict';
// The platform starts the process; this preference controls when monitoring starts.
class NotificationPolicy {
 constructor(get, visible) { this.get=get;this.visible=!!visible;this.opened=!!visible;this.view='MAP'; }
 setVisible(on) { this.visible=!!on;if(on)this.opened=true; }
 monitoring() { return this.get('auto_monitor')!=='off'||this.opened; }
 destination() {
  if(!this.monitoring()||this.get('central_notifications')==='off')return 'none';
  if(this.visible&&this.view==='RADAR'&&this.get('radar_no_duplicate')!=='off')return 'none';
  if(this.visible)return 'canvas';
  return this.get('central_notifications')==='foreground'?'none':'system';
 }
}
module.exports={NotificationPolicy};
