#include <stdint.h>
#include <stddef.h>
#include <string.h>
void *memset(void *p,int v,size_t n){volatile unsigned char *d=p;for(size_t i=0;i<n;i++)d[i]=(unsigned char)v;return p;}
#include "../native/bmwcaminfo-voice/stable-mixer.h"
static unsigned char pulse[960000],voice[960000];static int16_t out[480];static stable_mixer m;
unsigned char *pulse_ptr(void){return pulse;}unsigned char *voice_ptr(void){return voice;}int16_t *output_ptr(void){return out;}
int init(unsigned pb,unsigned vb,int beep){if(pb>sizeof(pulse)||vb>sizeof(voice))return -1;sm_init(&m,pulse,pb);if(beep&&sm_set(&m,1,700,40,0)<0)return -1;return sm_voice_add(&m,voice,vb,1,40);}
void render(unsigned frame,int beep){double now=frame/24.0;if(beep&&frame<96000)sm_set(&m,1,700,40,now);else sm_clear(&m);for(int i=0;i<480;i++)out[i]=sm_pending(&m,now)?sm_sample(&m,now):0;}
double peak(void){return m.peak;}double limited(void){return (double)m.limited;}double saturated(void){return (double)m.saturated;}double pulses(void){return (double)m.pulses;}
