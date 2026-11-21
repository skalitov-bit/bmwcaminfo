'use strict';
// The platform starts the process; this preference controls when monitoring starts.
class NotificationPolicy {
 constructor(get, visible) { this.get=get;this.visible=!!visible;this.opened=!!visible;this.view='MAP'; }
 setVisible(on) { this.visible=!!on;if(on)this.opened=true; }
 monitoring() { return this.get('auto_monitor')!=='off'||this.opened; }
 destination() {
  if(!this.monitoring())return 'none';
  // The central banner belongs to the visible Map page only.
  // Monitoring, speech and HUD/KOMBI remain independent of this destination.
  return this.visible&&this.view==='MAP'?'canvas':'none';
 }
}
module.exports={NotificationPolicy};
