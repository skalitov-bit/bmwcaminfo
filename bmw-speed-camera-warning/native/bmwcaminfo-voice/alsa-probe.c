/* SpeedCAM manual probe. ALSA ABI loaded at runtime; no changes to ALSA config.
 * Input: 48 kHz stereo S16_LE. Only the explicitly supported SmartX port.
 * Build: zig cc -target x86_64-linux-gnu.2.17 -O2 -Wall -Wextra -Werror
 *        alsa-probe.c -ldl -o alsa-probe
 */
#define _POSIX_C_SOURCE 200809L
#include <dlfcn.h>
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <ctype.h>
#include <dirent.h>
#include <sys/stat.h>
#include "alsa-overlay-name.h"
#include "pcm-queue.h"
typedef struct _snd_pcm snd_pcm_t;
static int (*pcm_open)(snd_pcm_t **,const char *,int,int);
static int (*pcm_params)(snd_pcm_t *,int,int,unsigned,unsigned,int,unsigned);
static int (*pcm_get_params)(snd_pcm_t *,unsigned long *,unsigned long *);
static int (*pcm_state)(snd_pcm_t *);
static long (*pcm_avail)(snd_pcm_t *);
static long (*pcm_write)(snd_pcm_t *,const void *,unsigned long);
static int (*pcm_wait)(snd_pcm_t *,int);
static int (*pcm_delay)(snd_pcm_t *,long *);
static int (*pcm_recover)(snd_pcm_t *,int,int);
static int (*pcm_drop)(snd_pcm_t *);
static int (*pcm_close)(snd_pcm_t *);
static const char *(*pcm_error)(int);
static volatile sig_atomic_t cancelled;
static void stop(int sig){(void)sig;cancelled=1;}
static double now_ms(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000.0+t.tv_nsec/1000000.0;}
static int load(void){
 void *lib=dlopen("libasound.so.2",RTLD_NOW|RTLD_LOCAL);
 if(!lib){fprintf(stderr,"ALSA library unavailable: %s\n",dlerror());return -1;}
#define GET(var,name) do{*(void **)(&(var))=dlsym(lib,name);if(!(var)){fprintf(stderr,"Missing ALSA symbol: %s\n",name);return -1;}}while(0)
 GET(pcm_open,"snd_pcm_open");GET(pcm_params,"snd_pcm_set_params");GET(pcm_write,"snd_pcm_writei");
 GET(pcm_wait,"snd_pcm_wait");GET(pcm_delay,"snd_pcm_delay");GET(pcm_recover,"snd_pcm_recover");
 GET(pcm_drop,"snd_pcm_drop");GET(pcm_close,"snd_pcm_close");GET(pcm_error,"snd_strerror");
 /* Optional diagnostic symbol: its absence must not break working playback. */
 *(void **)(&pcm_get_params)=dlsym(lib,"snd_pcm_get_params");
 *(void **)(&pcm_state)=dlsym(lib,"snd_pcm_state");
 *(void **)(&pcm_avail)=dlsym(lib,"snd_pcm_avail_update");
 return 0;
}
typedef struct {unsigned long buffer,period;int known;unsigned underruns,suspends,recoveries,recovery_failures,write_errors,poll_timeouts;double input_gap,write_gap,write_call,read_call;} buffer_stats;
static void buffer_report(const buffer_stats *s,unsigned rate,unsigned channels,unsigned xruns,unsigned long frames){
 fprintf(stderr,"SPEEDCAM_BUFFER {\"bufferParamsKnown\":%s,\"bufferFrames\":%lu,\"periodFrames\":%lu,\"bufferMs\":%.3f,\"periodMs\":%.3f,\"underruns\":%u,\"suspends\":%u,\"recoveries\":%u,\"recoveryFailures\":%u,\"writeErrors\":%u,\"inputPollTimeouts\":%u,\"maxInputGapMs\":%.3f,\"maxWriteGapMs\":%.3f,\"maxWriteCallMs\":%.3f,\"maxReadCallMs\":%.3f,\"xruns\":%u,\"framesWritten\":%lu,\"rate\":%u,\"channels\":%u}\n",s->known?"true":"false",s->buffer,s->period,s->buffer*1000.0/rate,s->period*1000.0/rate,s->underruns,s->suspends,s->recoveries,s->recovery_failures,s->write_errors,s->poll_timeouts,s->input_gap,s->write_gap,s->write_call,s->read_call,xruns,frames,rate,channels);
}
typedef struct {
 snd_pcm_t *pcm;buffer_stats *stats;unsigned rate,channels,xruns;
 unsigned long frames;double last_input,last_write,max_wait;
} converter_io;
static double queue_now(void *p){(void)p;return now_ms();}
static int queue_cancelled(void *p){(void)p;return cancelled;}
static long queue_input(void *p,unsigned char *dst,size_t bytes,int timeout){
 converter_io *c=p;struct pollfd fd={STDIN_FILENO,POLLIN,0};
 int rc=poll(&fd,1,timeout);
 if(rc<0)return errno==EINTR?0:-2;
 if(!rc){if(timeout)c->stats->poll_timeouts++;return 0;}
 double start=now_ms();ssize_t n=read(STDIN_FILENO,dst,bytes);double end=now_ms();
 if(end-start>c->stats->read_call)c->stats->read_call=end-start;
 if(n<0)return errno==EINTR?0:-2;
 if(!n)return -1;
 if(end-c->last_input>c->stats->input_gap)c->stats->input_gap=end-c->last_input;
 c->last_input=end;return n;
}
static long queue_write(void *p,const unsigned char *data,size_t frames){
 converter_io *c=p;double start=now_ms();long w=pcm_write(c->pcm,data,frames);double end=now_ms();
 if(end-start>c->stats->write_call)c->stats->write_call=end-start;
 if(w<0&&w!=-EAGAIN&&w!=-EINTR)c->stats->write_errors++;
 if(w>0){c->frames+=(unsigned long)w;if(end-c->last_write>c->stats->write_gap)c->stats->write_gap=end-c->last_write;c->last_write=end;alarm(5);}
 return w;
}
static int queue_wait(void *p,int ms){
 converter_io *c=p;double start=now_ms();int r=pcm_wait(c->pcm,ms);double elapsed=now_ms()-start;
 if(elapsed>c->max_wait)c->max_wait=elapsed;
 /* Some plugins signal ready while write still returns EAGAIN. Bound retries. */
 if(elapsed<1){struct timespec t={0,1000000};nanosleep(&t,NULL);}
 return r;
}
static int queue_recover(void *p,int error){
 converter_io *c=p;
 if(error==-EPIPE)c->stats->underruns++;
 if(error==-ESTRPIPE)c->stats->suspends++;
 if(error==-EPIPE||error==-ESTRPIPE)c->xruns++;
 int r=pcm_recover(c->pcm,error,1);
 if(r<0)c->stats->recovery_failures++;else c->stats->recoveries++;
 return r;
}
static void queue_report(void *p,const pcm_queue_stats *q){
 converter_io *c=p;long delay=0;int dr=pcm_delay(c->pcm,&delay);
 long avail=pcm_avail?pcm_avail(c->pcm):-1;int state=pcm_state?pcm_state(c->pcm):-1;
 buffer_report(c->stats,c->rate,c->channels,c->xruns,c->frames);
 fprintf(stderr,"SPEEDCAM_BUFFER {\"queueCapacityFrames\":%lu,\"queueFrames\":%lu,\"queueHighWaterFrames\":%lu,\"queueLowWaterFrames\":%lu,\"queueCapacityMs\":240,\"prefillTargetMs\":120,\"prefillWaitMs\":%.3f,\"queueEmptyEvents\":%u,\"maxQueueEmptyMs\":%.3f,\"maxNoProgressMs\":%.3f,\"eagainCount\":%u,\"waitTimeouts\":%u,\"waitErrors\":%u,\"lastWaitResult\":%ld,\"lastAlsaError\":%ld,\"maxWaitMs\":%.3f,\"alsaState\":%d,\"availableFrames\":%ld,\"delayFrames\":%ld,\"delayError\":%d}\n",
 (unsigned long)q->capacity,(unsigned long)q->queued,(unsigned long)q->high_water,(unsigned long)q->low_water,q->prefill_ms,q->empty_events,q->max_empty_ms,q->max_no_progress_ms,q->again,q->wait_timeouts,q->wait_errors,q->last_wait,q->last_error,c->max_wait,state,avail,delay,dr);
}
/* Never guess a SmartX port or reuse CarLife for an Overlay test. Only an
 * explicitly advertised, unique OapGenericOverlay output is acceptable. */
static const char *discovery_reason="enumeration-failed";
static char advertised[24][80];
static unsigned advertised_count,advertised_total;
static int inventory_truncated,shm_error,shm_truncated;
static char shm_outputs[24][256];
static unsigned shm_count,shm_total;
static const char *discovery_method="none";
static void json_string(const char *s){
 putchar('"');
 for(;*s;s++){unsigned char c=(unsigned char)*s;
  if(c=='"'||c=='\\'){putchar('\\');putchar(c);}
  else if(c<32||c>=127)printf("\\u%04x",c);else putchar(c);
 }
 putchar('"');
}
static void discovery_report(const char *device,int success){
 printf("{\"library\":true,\"discoveryProtocol\":1,\"overlay\":%s,\"reason\":",success?"true":"false");
 json_string(discovery_reason);printf(",\"device\":");json_string(success?device:"");
 printf(",\"outputs\":[");
 for(unsigned i=0;i<advertised_count;i++){if(i)putchar(',');json_string(advertised[i]);}
 printf("],\"outputsTotal\":%u,\"inventoryTruncated\":%s,\"method\":",advertised_total,inventory_truncated?"true":"false");
 json_string(discovery_method);printf(",\"sharedMemoryOutputs\":[");
 for(unsigned i=0;i<shm_count;i++){if(i)putchar(',');json_string(shm_outputs[i]);}
 printf("],\"sharedMemoryTotal\":%u,\"sharedMemoryError\":%d,\"hardwareVerified\":false}\n",shm_total,shm_error);
}
/* SmartX upstream maps smartx:NAME playback to smartx_NAME_p_connection.
 * Enumerate existing regular shared-memory objects, never construct trial names,
 * read their contents, change ALSA config or reuse another BMW audio source. */
static void overlay_shm(char *out,size_t size,int *count){
 DIR *dir=opendir("/dev/shm");if(!dir){shm_error=errno;return;}
 struct dirent *entry;unsigned entries=0;int found=0;
 while((entry=readdir(dir))){
  if(++entries>8192){inventory_truncated=1;shm_truncated=1;break;}
  char device[512],file[512];struct stat st;
  if(!overlay_from_shm(entry->d_name,device,sizeof(device)))continue;
  int n=snprintf(file,sizeof(file),"/dev/shm/%s",entry->d_name);
  if(n<0||(size_t)n>=sizeof(file)||lstat(file,&st)||!S_ISREG(st.st_mode)||st.st_size<=0)continue;
  shm_total++;found=1;
  if(shm_count<24)snprintf(shm_outputs[shm_count++],sizeof(shm_outputs[0]),"%s",entry->d_name);
  overlay_candidate(device,out,size,count);
 }
 closedir(dir);
 if(found)discovery_method=strcmp(discovery_method,"hints")?"smartx-shm":"hints+smartx-shm";
}
static int overlay_device(char *out,size_t size){
 void *lib=dlopen("libasound.so.2",RTLD_NOW|RTLD_LOCAL);
 int (*hint)(int,const char *,void ***)=NULL;
 char *(*value)(const void *,const char *)=NULL;
 int (*release)(void **)=NULL;
 if(!lib)return -1;
 *(void **)(&hint)=dlsym(lib,"snd_device_name_hint");
 *(void **)(&value)=dlsym(lib,"snd_device_name_get_hint");
 *(void **)(&release)=dlsym(lib,"snd_device_name_free_hint");
 void **hints=NULL;int count=0,hints_ok=0;
 if(!hint||!value||!release)discovery_reason="hint-api-unavailable";
 else if(hint(-1,"pcm",&hints)>=0){
  hints_ok=1;
  for(void **p=hints;p&&*p;p++){
   char *name=value(*p,"NAME"),*io=value(*p,"IOID"),device[512];
   if(name&&(!io||!strcmp(io,"Output"))){
    advertised_total++;
    if(strlen(name)>=sizeof(advertised[0])||advertised_count>=24)inventory_truncated=1;
    if(advertised_count<24)snprintf(advertised[advertised_count++],sizeof(advertised[0]),"%s",name);
    if(overlay_from_hint(name,device,sizeof(device))){overlay_candidate(device,out,size,&count);discovery_method="hints";}
   }
   free(name);free(io);
  }
  release(hints);
 }
 dlclose(lib);
 overlay_shm(out,size,&count);
 discovery_reason=count==1?"unique-output":count?"ambiguous-output":hints_ok?"no-advertised-output":discovery_reason;
 /* A bounded shm walk cannot establish uniqueness when cut short. */
 if(shm_total>24||shm_error||shm_truncated){if(count==1)discovery_reason="incomplete-inventory";return -1;}
 return count==1?0:-1;
}
/* Explicit Converter profile, confirmed audible with Overlay by the user.
 * Keep separate from automatic Overlay discovery. Require BOTH shm objects. */
#include "stable-stream.h"
static const char *converter_port="Media_Overlay_Converter_Source_CF_24_MONO";
static int converter_present(void){
 const char *suffixes[]={"_p_connection","_p_ringbuffer"};
 for(unsigned i=0;i<2;i++){
  char file[256];struct stat st;
  snprintf(file,sizeof(file),"/dev/shm/smartx_%s%s",converter_port,suffixes[i]);
  if(lstat(file,&st)||!S_ISREG(st.st_mode)||st.st_size<=0){
   fprintf(stderr,"ALSA converter: required nonempty regular object absent: %s\n",file);return 0;
  }
 }
 return 1;
}
#include "direct-pcm.h"
int main(int argc,char **argv){
 if(argc!=2||(strcmp(argv[1],"--check")&&strcmp(argv[1],"--play")&&strcmp(argv[1],"--stream")&&strcmp(argv[1],"--check-overlay")&&strcmp(argv[1],"--play-overlay")&&strcmp(argv[1],"--stream-overlay")&&strcmp(argv[1],"--check-converter")&&strcmp(argv[1],"--play-converter")&&strcmp(argv[1],"--stream-converter")&&strcmp(argv[1],"--stream-converter-stable")&&strcmp(argv[1],"--stream-converter-direct")&&strcmp(argv[1],"--stream-converter-profile")&&strcmp(argv[1],"--stream-converter-period")))return 2;
 int direct=!strcmp(argv[1],"--stream-converter-direct");
 int period_profile=!strcmp(argv[1],"--stream-converter-period");
 int stable=period_profile||!strcmp(argv[1],"--stream-converter-profile")||direct||!strcmp(argv[1],"--stream-converter-stable");
 int converter=stable||!strcmp(argv[1],"--check-converter")||!strcmp(argv[1],"--play-converter")||!strcmp(argv[1],"--stream-converter");
 unsigned channels=converter?1:2,rate=converter?24000:48000,frame_bytes=channels*2;
 int continuous=stable||!strcmp(argv[1],"--stream")||!strcmp(argv[1],"--stream-overlay")||!strcmp(argv[1],"--stream-converter");
 alarm(14); /* Also bounds unexpected blocking in an ALSA plugin. */
 signal(SIGTERM,stop);signal(SIGINT,stop);
 if(load())return 3;
 char overlay[512]={0};const char *device="plug:smartx:CarLifeMedia_CF_48_STEREO";
 if(converter){
  if(!converter_present())return 7;
  snprintf(overlay,sizeof(overlay),"%ssmartx:%s",direct?"":"plug:",converter_port);device=overlay;
  if(!strcmp(argv[1],"--check-converter")){
   printf("{\"converterProtocol\":1,\"library\":true,\"present\":true,\"device\":");json_string(device);
   puts(",\"rate\":24000,\"channels\":1,\"format\":\"S16_LE\",\"streamSupported\":true,\"converterProfilesProtocol\":1,\"mixerSettingsProtocol\":1,\"stableMixerProtocol\":1,\"directSmartxProtocol\":1,\"hardwareVerified\":false}");return 0;
  }
 }
 if(!strcmp(argv[1],"--check-overlay")||!strcmp(argv[1],"--play-overlay")||!strcmp(argv[1],"--stream-overlay")){
  if(overlay_device(overlay,sizeof(overlay))){
   if(!strcmp(argv[1],"--check-overlay"))discovery_report("",0);
   fprintf(stderr,"ALSA_OVERLAY_%s: no unique advertised SmartX OapGenericOverlay ALSA output\n",discovery_reason);return 7;
  }
  device=overlay;
  if(!strcmp(argv[1],"--check-overlay")){discovery_report(device,1);return 0;}
 }
 if(!strcmp(argv[1],"--check")){puts("{\"library\":true,\"device\":\"plug:smartx:CarLifeMedia_CF_48_STEREO\",\"hardwareVerified\":false}");return 0;}
 snd_pcm_t *pcm=NULL;
 int rc=pcm_open(&pcm,device,0,1); /* playback, nonblocking */
 if(rc<0){fprintf(stderr,"ALSA open: %s\n",pcm_error(rc));return 4;}
 /* Requested queue budget, negotiated buffer/period are reported below.
    192 ms tolerates short producer stalls; keep the 20 ms mixer chunks and
    the existing route, format and bounded final drain unchanged. */
 rc=pcm_params(pcm,2,3,channels,rate,direct?0:1,192000); /* S16_LE, RW_INTERLEAVED */
 if(rc<0){if(stable)inspect_pcm(pcm,direct);fprintf(stderr,"ALSA format (%s): %s; no format fallback\n",device,pcm_error(rc));pcm_close(pcm);return 5;}
 if(stable&&inspect_pcm(pcm,direct)<0){pcm_close(pcm);return 5;}
 unsigned char buf[3840];size_t used=0;unsigned long frames=0;unsigned xruns=0;long delay=0;
 double start=now_ms(),last_progress=start;int eof=0,failed=0;
 buffer_stats stats={0};if(pcm_get_params&&pcm_get_params(pcm,&stats.buffer,&stats.period)==0)stats.known=1;
 double last_input=start,last_write=start,last_report=start;
 buffer_report(&stats,rate,channels,xruns,frames);
 if(stable){failed=stable_stream(pcm,&stats,&frames,period_profile)!=0;eof=!failed;xruns=stats.underruns+stats.suspends;}
 else if(converter){
  converter_io io={pcm,&stats,rate,channels,0,0,start,start,0};
  pcm_queue_stats queue={0};
  pcm_queue_ops ops={&io,queue_now,queue_cancelled,queue_input,queue_write,queue_wait,queue_recover,queue_report};
  int result=pcm_queue_run(&ops,rate,frame_bytes,stats.period,&queue);
  frames=io.frames;xruns=io.xruns;used=queue.queued*frame_bytes;eof=result==PCMQ_OK;failed=result!=PCMQ_OK;
  if(failed){
   static const char *reason[]={"ok","cancelled","input error","partial PCM frame","write error","wait error","ALSA stream stalled","ALSA input stalled"};
   fprintf(stderr,"Converter queue: %s; ALSA error=%ld; queuedFrames=%lu\n",reason[result],queue.last_error,(unsigned long)queue.queued);
  }
 }
 while(!converter&&!cancelled&&!eof&&(continuous||now_ms()-start<12000)){
  struct pollfd p={STDIN_FILENO,POLLIN,0};rc=poll(&p,1,50);
  if(rc<0){if(errno==EINTR)continue;failed=1;break;}
  if(!rc){stats.poll_timeouts++;if(now_ms()-last_report>=1000){buffer_report(&stats,rate,channels,xruns,frames);last_report=now_ms();}if(continuous&&now_ms()-last_progress>2000){fprintf(stderr,"ALSA input stalled\n");failed=1;break;}continue;}
  double read_start=now_ms();
  ssize_t n=read(STDIN_FILENO,buf+used,sizeof(buf)-used);
  double read_end=now_ms();if(read_end-read_start>stats.read_call)stats.read_call=read_end-read_start;
  if(n>0){if(read_end-last_input>stats.input_gap)stats.input_gap=read_end-last_input;last_input=read_end;}
  if(n<0){if(errno==EINTR)continue;failed=1;break;}if(!n)eof=1;else used+=(size_t)n;
  size_t count=used/frame_bytes,pos=0;
  while(pos<count&&!cancelled&&(continuous||now_ms()-start<12000)){
   double write_start=now_ms();long w=pcm_write(pcm,buf+pos*frame_bytes,count-pos);double write_end=now_ms();
   if(write_end-write_start>stats.write_call)stats.write_call=write_end-write_start;
   if(w>0){pos+=(size_t)w;frames+=(unsigned long)w;last_progress=write_end;if(write_end-last_write>stats.write_gap)stats.write_gap=write_end-last_write;last_write=write_end;if(continuous)alarm(5);}
   else if(w==-EAGAIN||w==0){pcm_wait(pcm,20);}
   else {stats.write_errors++;if(w==-EPIPE)stats.underruns++;if(w==-ESTRPIPE)stats.suspends++;
    if(++xruns>3){buffer_report(&stats,rate,channels,xruns,frames);fprintf(stderr,"ALSA write: %s\n",pcm_error((int)w));failed=1;break;}
    if(pcm_recover(pcm,(int)w,1)<0){stats.recovery_failures++;buffer_report(&stats,rate,channels,xruns,frames);fprintf(stderr,"ALSA write: %s\n",pcm_error((int)w));failed=1;break;}
    stats.recoveries++;buffer_report(&stats,rate,channels,xruns,frames);last_report=now_ms();}
   if(now_ms()-last_report>=1000){buffer_report(&stats,rate,channels,xruns,frames);last_report=now_ms();}
   if(now_ms()-last_progress>1200){fprintf(stderr,"ALSA stream stalled\n");failed=1;break;}
  }
  if(failed)break;
  used-=pos*frame_bytes;memmove(buf,buf+pos*frame_bytes,used);
 }
 if(!eof||used||cancelled)failed=1;
 /* Let already queued samples finish, bounded; delay is evidence of consumption, not audibility. */
 double end=now_ms()+500;
 while(!failed&&now_ms()<end){if(pcm_delay(pcm,&delay)<0){failed=1;break;}if(delay<=0)break;struct timespec t={0,10000000};nanosleep(&t,NULL);}
 if(delay>0||frames==0)failed=1;
 buffer_report(&stats,rate,channels,xruns,frames);
 int drop_result=pcm_drop(pcm),close_result=pcm_close(pcm);
 if((period_profile||!strcmp(argv[1],"--stream-converter-profile"))&&(drop_result<0||close_result<0)){fprintf(stderr,"PCM close not confirmed: drop=%d close=%d\n",drop_result,close_result);failed=1;}
 printf("{\"framesWritten\":%lu,\"pendingFrames\":%ld,\"xruns\":%u,\"streamCompleted\":%s,\"audibleConfirmed\":false,\"rate\":%u,\"channels\":%u,\"device\":",frames,delay,xruns,failed?"false":"true",rate,channels);
 json_string(device);puts("}");
 return failed?6:0;
}
