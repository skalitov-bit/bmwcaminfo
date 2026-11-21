#ifndef SPEEDCAM_STABLE_MIXER_H
#define SPEEDCAM_STABLE_MIXER_H
#include <stdint.h>
#include <stddef.h>
#include <string.h>
/* Test profile only: 24k mono S16_LE, -6dB BEFORE summing, 8ms edges.
 * No allocations, file I/O, JS callbacks or wall-clock pacing in render(). */
#define SM_RATE 24000
#define SM_EDGE 192
#define SM_GAIN 0.5011872336272722
#define SM_TAILS 128
typedef struct {const unsigned char *data;size_t frames,pos;unsigned id,volume;} sm_voice;
typedef struct {size_t pos;unsigned volume;} sm_tail;
typedef struct {
 const unsigned char *pulse;size_t pulse_frames;
 sm_voice voices[2];unsigned voice_count;
 sm_tail tails[SM_TAILS];unsigned tail_count;
 unsigned camera,interval,volume;int beat,new_camera;
 double voice_gain,beeper_gain,duck_target;double expires,duck,limiter;uint64_t clock,last_beat;
 unsigned started,done;uint64_t done_frame;
 uint64_t rendered,limited,saturated,pulses;double peak,mix_peak,voice_peak,beep_peak;
} stable_mixer;
static double sm_abs(double x){return x<0?-x:x;}
static int sm_raw(const unsigned char *p,size_t pos){unsigned u=p[pos*2]|((unsigned)p[pos*2+1]<<8);return u>=32768?(int)u-65536:(int)u;}
static double sm_edge(size_t pos,size_t frames){
 double a=pos<SM_EDGE?(double)pos/SM_EDGE:1;
 double b=frames-1-pos<SM_EDGE?(double)(frames-1-pos)/SM_EDGE:1;
 return a<b?a:b;
}
static void sm_init(stable_mixer *m,const unsigned char *pulse,size_t bytes){memset(m,0,sizeof(*m));m->pulse=pulse;m->pulse_frames=bytes/2;m->duck=1;m->limiter=1;m->voice_gain=1;m->beeper_gain=1;m->duck_target=.25;}
static int sm_voice_add(stable_mixer *m,const unsigned char *data,size_t bytes,unsigned id,unsigned volume){
 if(m->voice_count==2||!bytes||bytes%2||bytes>SM_RATE*2*20||volume>100||!id)return -1;
 sm_voice v={data,bytes/2,0,id,volume};m->voices[m->voice_count++]=v;return 0;
}
static int sm_set(stable_mixer *m,unsigned camera,unsigned interval,unsigned volume,double now){
 if(!camera||interval<300||interval>30000||interval%100||volume<10||volume>100||volume%10)return -1;
 if(!m->beat||m->camera!=camera)m->new_camera=1;
 m->camera=camera;m->interval=interval;m->volume=volume;m->beat=1;m->expires=now+1200;return 0;
}
static void sm_clear(stable_mixer *m){m->beat=0;}
static int sm_pending(stable_mixer *m,double now){return (m->beat&&now<m->expires)||m->voice_count||m->tail_count;}
static int16_t sm_sample(stable_mixer *m,double now){
 m->started=0;m->done=0;
 int active=m->beat&&now<m->expires;
 if(active&&(m->new_camera||m->clock-m->last_beat>=(uint64_t)m->interval*24)){
  if(m->tail_count<SM_TAILS){sm_tail t={0,m->volume};m->tails[m->tail_count++]=t;m->pulses++;}
  m->new_camera=0;m->last_beat=m->clock;
 }
 double target=m->voice_count?m->duck_target:1,step=1.0/(SM_RATE*(target<m->duck?.025:.180));
 double diff=target-m->duck;m->duck+=diff>step?step:diff<-step?-step:diff;
 double voice=0,beep=0;
 if(m->voice_count){sm_voice *v=&m->voices[0];if(!v->pos)m->started=v->id;
  voice=sm_raw(v->data,v->pos)/32768.0*(v->volume/100.0)*m->voice_gain*SM_GAIN*sm_edge(v->pos,v->frames);
  if(++v->pos==v->frames){m->done=v->id;m->done_frame=m->clock+1;m->voice_count--;m->voices[0]=m->voices[1];}
 }
 unsigned kept=0;
 for(unsigned i=0;i<m->tail_count;i++){sm_tail t=m->tails[i];
  if(t.pos<m->pulse_frames){beep+=sm_raw(m->pulse,t.pos)/32768.0*(t.volume/100.0)*m->beeper_gain*SM_GAIN*sm_edge(t.pos,m->pulse_frames);t.pos++;}
  if(t.pos<m->pulse_frames)m->tails[kept++]=t;
 }m->tail_count=kept;
 double sum=voice+beep*m->duck,abs=sm_abs(sum),need=abs>.96?.96/abs:1;
 if(abs>m->mix_peak)m->mix_peak=abs;
 if(sm_abs(voice)>m->voice_peak)m->voice_peak=sm_abs(voice);
 if(sm_abs(beep)>m->beep_peak)m->beep_peak=sm_abs(beep);
 double release=m->limiter+1.0/(SM_RATE*.1);m->limiter=need<release?need:release;
 double out=sum*m->limiter;int sample=(int)(out*32767+(out>=0?.5:-.5));
 if(m->limiter<.999999)m->limited++;
 if(sample>32767){sample=32767;m->saturated++;}if(sample< -32768){sample=-32768;m->saturated++;}
 if(sm_abs(out)>m->peak)m->peak=sm_abs(out);
 m->rendered++;m->clock++;return (int16_t)sample;
}
#endif
