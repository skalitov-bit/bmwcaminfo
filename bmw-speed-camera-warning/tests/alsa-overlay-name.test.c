#undef NDEBUG
#include <assert.h>
#include "../native/bmwcaminfo-voice/alsa-overlay-name.h"
int main(void){
 char out[512],candidate[512];int count=0;
 assert(overlay_from_hint("smartx:OapGenericOverlay_CF_48_STEREO",out,sizeof(out)));
 assert(!strcmp(out,"plug:smartx:OapGenericOverlay_CF_48_STEREO"));
 overlay_candidate(out,candidate,sizeof(candidate),&count);
 assert(overlay_from_hint("plug:smartx:OapGenericOverlay_CF_48_STEREO",out,sizeof(out)));
 overlay_candidate(out,candidate,sizeof(candidate),&count);assert(count==1);
 assert(overlay_from_shm("smartx_OapGenericOverlay_CF_48_STEREO_p_connection",out,sizeof(out)));
 overlay_candidate(out,candidate,sizeof(candidate),&count);assert(count==1);
 assert(overlay_from_shm("smartx_OAPGenericOverlay_p_connection",out,sizeof(out)));
 assert(!strcmp(out,"plug:smartx:OAPGenericOverlay"));
 overlay_candidate(out,candidate,sizeof(candidate),&count);assert(count==2);
 const char *bad[]={"smartx_CarLifeMedia_CF_48_STEREO_p_connection","smartx_CarPlayMedia_p_connection",
 "smartx_OapGenericOverlay_CF_48_STEREO_c_connection","smartx_OapGenericOverlay_CF_48_STEREO_p_ringbuffer",
 "smartx_OapGenericOverlayOther_p_connection","smartx_OapGenericOverlay/evil_p_connection",
 "smartx_OapGenericOverlay_p_connection.bak","OapGenericOverlay_p_connection"};
 for(unsigned i=0;i<sizeof(bad)/sizeof(bad[0]);i++)assert(!overlay_from_shm(bad[i],out,sizeof(out)));
 assert(!overlay_from_hint("plug:smartx:OapGenericOverlayOther",out,sizeof(out)));
 assert(!overlay_from_hint("default",out,sizeof(out)));
 assert(!overlay_from_hint("smartx:OapGenericOverlay,FILE=/tmp/x",out,sizeof(out)));
 assert(!overlay_from_hint("smartx:OapGenericOverlay",out,8));
 puts("PASS native Overlay names: exact source, playback-only SHM, aliases deduplicated, ambiguity rejected, no guessed media ports");return 0;
}
