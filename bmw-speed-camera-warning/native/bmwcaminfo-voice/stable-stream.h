#ifndef SPEEDCAM_STABLE_STREAM_H
#define SPEEDCAM_STABLE_STREAM_H
#include "stable-mixer.h"
#define STABLE_MAX_BYTES (SM_RATE*2*20)
#define STABLE_QUEUE 4800
typedef struct {size_t high,low;unsigned again,timeouts,wait_errors,empty;long last_wait,last_error;double max_wait,max_no_progress,prefill;} stable_stats;
static void stable_report(snd_pcm_t *pcm,buffer_stats *stats,const stable_stats *q,size_t used,unsigned long written){
 long delay=0;int dr=pcm_delay(pcm,&delay);long avail=pcm_avail?pcm_avail(pcm):-1;int state=pcm_state?pcm_state(pcm):-1;
 buffer_report(stats,SM_RATE,1,stats->underruns+stats->suspends,written);
 fprintf(stderr,"SPEEDCAM_BUFFER {\"queueCapacityFrames\":4800,\"queueFrames\":%lu,\"queueHighWaterFrames\":%lu,\"queueLowWaterFrames\":%lu,\"queueCapacityMs\":200,\"prefillTargetMs\":200,\"prefillWaitMs\":%.3f,\"queueEmptyEvents\":%u,\"maxNoProgressMs\":%.3f,\"eagainCount\":%u,\"waitTimeouts\":%u,\"waitErrors\":%u,\"lastWaitResult\":%ld,\"lastAlsaError\":%ld,\"maxWaitMs\":%.3f,\"alsaState\":%d,\"availableFrames\":%ld,\"delayFrames\":%ld,\"delayError\":%d}\n",(unsigned long)used,(unsigned long)q->high,(unsigned long)q->low,q->prefill,q->empty,q->max_no_progress,q->again,q->timeouts,q->wait_errors,q->last_wait,q->last_error,q->max_wait,state,avail,delay,dr);
}
static unsigned stable_u32(const unsigned char *p){return p[0]|((unsigned)p[1]<<8)|((unsigned)p[2]<<16)|((unsigned)p[3]<<24);}
static void stable_signal(const stable_mixer *m){
 fprintf(stderr,"SPEEDCAM_STABLE {\"event\":\"stats\",\"profile\":\"converter-stable\",\"nativeMixer\":true,\"queueMs\":200,\"gainDb\":-6,\"edgeMs\":8,\"frames\":%llu,\"pulses\":%llu,\"peak\":%.6f,\"mixPeak\":%.6f,\"voicePeak\":%.6f,\"beeperPeak\":%.6f,\"voiceQueue\":%u,\"beeperTails\":%u,\"duckGain\":%.6f,\"limiterGain\":%.6f,\"limitedSamples\":%llu,\"saturatedSamples\":%llu}\n",(unsigned long long)m->rendered,(unsigned long long)m->pulses,m->peak,m->mix_peak,m->voice_peak,m->beep_peak,m->voice_count,m->tail_count,m->duck,m->limiter,(unsigned long long)m->limited,(unsigned long long)m->saturated);
}
#ifndef SPEEDCAM_STABLE_TEST
static void stable_event(const char *event,unsigned id){fprintf(stderr,"SPEEDCAM_STABLE {\"event\":\"%s\",\"id\":%u}\n",event,id);}
#endif
/* Binary IPC: magic, type, id, a, b, payloadBytes (six LE uint32 values).
 * PCM is accepted ONLY after a complete, bounded packet has arrived.
 * 1 pulse, 2 beeper lease, 3 full voice, 4 clear, 5 graceful end, 6 heartbeat, 7 mixer gains (id=voice, a=beeper, b=duck percent). */
static int stable_stream(snd_pcm_t *pcm,buffer_stats *stats,unsigned long *written,int period_profile){
 unsigned char *input=malloc(STABLE_MAX_BYTES+24),*pulse=NULL,*voices[2]={NULL,NULL};
 unsigned ids[2]={0,0},ack_id[2]={0,0};uint64_t ack_frame[2]={0,0};
 stable_mixer m;sm_init(&m,NULL,0);
 int16_t queue[STABLE_QUEUE];size_t used=0,head=0,bytes=0;
 int ending=0,failed=0,idle=0,prefilled=0;unsigned recoveries=0;
 stable_stats q={0};q.low=STABLE_QUEUE;
 if(period_profile&&(!stats->known||!stats->period||!pcm_avail)){free(input);fprintf(stderr,"Negotiated ALSA period/availability unavailable\n");return -1;}
 double start=now_ms(),last_input=start,progress=start,last_report=start;
 if(!input)return -1;
 while(!cancelled){
  double now=now_ms();struct pollfd fd={STDIN_FILENO,POLLIN,0};
  int ready=poll(&fd,1,0);
  if(ready<0&&errno!=EINTR){failed=1;break;}
  for(unsigned budget=65536;ready>0&&!ending&&budget;ready=poll(&fd,1,0)){
   size_t space=STABLE_MAX_BYTES+24-bytes;if(space>budget)space=budget;
   double read_start=now_ms();ssize_t n=read(STDIN_FILENO,input+bytes,space);
   double read_time=now_ms()-read_start;if(read_time>stats->read_call)stats->read_call=read_time;
   if(n<0&&errno!=EINTR){failed=1;break;}
   if(n==0){ending=1;sm_clear(&m);}else if(n>0){bytes+=(size_t)n;budget-=(unsigned)n;if(now-last_input>stats->input_gap)stats->input_gap=now-last_input;last_input=now;}
   while(bytes>=24){
    unsigned magic=stable_u32(input),type=stable_u32(input+4),id=stable_u32(input+8),a=stable_u32(input+12),b=stable_u32(input+16),len=stable_u32(input+20);
    if(magic!=0x31504353||type<1||type>7||len>STABLE_MAX_BYTES||len%2||((type!=1&&type!=3)&&len)){failed=1;break;}
    if(bytes<24+len)break;
    if(type==1){if(pulse||!len){failed=1;break;}pulse=malloc(len);if(!pulse){failed=1;break;}memcpy(pulse,input+24,len);m.pulse=pulse;m.pulse_frames=len/2;}
    else if(type==2){if(!pulse||sm_set(&m,id,a,b,now)<0){failed=1;break;}idle=0;}
    else if(type==3){
     unsigned slot=ids[0]?1:0;
     if(!pulse||ids[slot]||!len||!id||a>100){failed=1;break;}
     unsigned char *data=malloc(len);if(!data){failed=1;break;}memcpy(data,input+24,len);
     if(sm_voice_add(&m,data,len,id,a)<0){free(data);failed=1;break;}
     voices[slot]=data;ids[slot]=id;idle=0;
    }else if(type==7){if(pulse||id>100||a>100||b>100){failed=1;break;}m.voice_gain=id/100.0;m.beeper_gain=a/100.0;m.duck_target=b/100.0;}
    else if(type==4)sm_clear(&m);
    else if(type==5){ending=1;sm_clear(&m);}
    bytes-=24+len;memmove(input,input+24+len,bytes);
   }
   if(failed)break;
  }
  if(now-last_input>5000){ending=1;sm_clear(&m);}
  if(ending&&bytes){failed=1;break;}
  /* Fill a 200ms native reservoir. ALSA parameters remain unchanged (192ms
   * requested); writes are nonblocking and control messages are always polled. */
  if(pulse){
   size_t add=STABLE_QUEUE-used;if(add>480)add=480;
   for(size_t i=0;i<add;i++){
    if(ending&&!sm_pending(&m,now))break;
    queue[(head+used)%STABLE_QUEUE]=sm_sample(&m,now);used++;
    if(m.started)stable_event("started",m.started);
    if(m.done){for(unsigned j=0;j<2;j++)if(ids[j]==m.done){free(voices[j]);voices[j]=NULL;ids[j]=0;break;}
     unsigned j=ack_id[0]?1:0;if(ack_id[j]){failed=1;break;}ack_id[j]=m.done;ack_frame[j]=m.done_frame;
    }
   }
   if(!sm_pending(&m,now)&&!idle){idle=1;stable_event("idle",0);}
  }
  if(failed)break;
  if(used>q.high)q.high=used;
  if(!prefilled&&(used==STABLE_QUEUE||ending)){prefilled=1;q.prefill=now_ms()-start;}
  if(prefilled&&used){
   size_t count=used;if(count>480)count=480;if(count>STABLE_QUEUE-head)count=STABLE_QUEUE-head;
   if(period_profile){long available=pcm_avail(pcm);if(available<0){q.last_error=available;if(available==-EPIPE)stats->underruns++;stats->write_errors++;if(recoveries++>=3||pcm_recover(pcm,(int)available,1)<0){stats->recovery_failures++;failed=1;break;}stats->recoveries++;continue;}if(count>stats->period)count=stats->period;if(count>(size_t)available)count=(size_t)available;}
   double wt=now_ms();long w=count?pcm_write(pcm,queue+head,count):-EAGAIN;double we=now_ms();
   if(we-wt>stats->write_call)stats->write_call=we-wt;
   if(we-progress>q.max_no_progress)q.max_no_progress=we-progress;
   if(w>0&&(size_t)w<=count){head=(head+w)%STABLE_QUEUE;used-=w;*written+=(unsigned long)w;if(we-progress>stats->write_gap)stats->write_gap=we-progress;progress=we;alarm(5);if(!ending){if(used<q.low)q.low=used;if(!used)q.empty++;}}
   else if(w>0){q.last_error=-EINVAL;failed=1;break;}
   else if(w==0||w==-EAGAIN){q.again++;double t=now_ms();int r=pcm_wait(pcm,period_profile?20:5);q.last_wait=r;if(now_ms()-t>q.max_wait)q.max_wait=now_ms()-t;if(!r)q.timeouts++;if(r<0&&r!=-EINTR){q.wait_errors++;w=r;}else w=0;
    if(now_ms()-t<1){struct timespec nap={0,1000000};nanosleep(&nap,NULL);}
   }
   if(w<0&&w!=-EINTR&&w!=-EAGAIN){
    q.last_error=w;
    if(w==-EPIPE)stats->underruns++;if(w==-ESTRPIPE)stats->suspends++;
    stats->write_errors++;if(recoveries++>=3||pcm_recover(pcm,(int)w,1)<0){stats->recovery_failures++;failed=1;break;}stats->recoveries++;
   }
   for(unsigned j=0;j<2;j++)if(ack_id[j]&&*written>=ack_frame[j]){stable_event("done",ack_id[j]);ack_id[j]=0;}
  }else if(!prefilled&&pulse){/* Build initial reservoir without a timer. */}
  else {struct timespec nap={0,1000000};nanosleep(&nap,NULL);}
  if(ending&&!used&&!sm_pending(&m,now))break;
  if(now-progress>4000){failed=1;break;}
  if(now-last_report>=1000){stable_report(pcm,stats,&q,used,*written);stable_signal(&m);last_report=now;}
 }
 stable_report(pcm,stats,&q,used,*written);
 stable_signal(&m);
 free(input);free(pulse);free(voices[0]);free(voices[1]);
 return failed||cancelled?-1:0;
}
#endif
