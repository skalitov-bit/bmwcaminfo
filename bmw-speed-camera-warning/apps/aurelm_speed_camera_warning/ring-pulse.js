'use strict';
const PULSE={riseMs:80,fadeMs:720,pauseMs:200,frameMs:40};
function pulseOpacity(elapsedMs){
 if(!Number.isFinite(elapsedMs))return 0;
 const t=Math.max(0,elapsedMs)%(PULSE.riseMs+PULSE.fadeMs+PULSE.pauseMs);
 if(t<PULSE.riseMs){const u=t/PULSE.riseMs;return 1-Math.pow(1-u,3);}
 if(t<PULSE.riseMs+PULSE.fadeMs){const u=(t-PULSE.riseMs)/PULSE.fadeMs;return 1-u*u*(3-2*u);}
 return 0;
}
function monotonicMs(){const t=process.hrtime();return t[0]*1000+t[1]/1e6;}
module.exports={PULSE,pulseOpacity,monotonicMs};
