#ifdef SPEEDCAM_WASM
extern void test_failure(int line);
#define assert(c) do {if(!(c))test_failure(__LINE__);} while(0)
#define puts(s) ((void)0)
#else
#include <stdio.h>
#undef NDEBUG
#include <assert.h>
#endif
#include "../native/bmwcaminfo-voice/pcm-queue.h"
#ifdef SPEEDCAM_WASM
void *memset(void *p,int value,size_t n){volatile unsigned char *d=p;for(size_t i=0;i<n;i++)d[i]=(unsigned char)value;return p;}
#endif
/* Execute the production pump against a 512-frame ALSA device (21.33 ms).
 * Virtual time and deterministic PCM verify ordering, stalls and EOF. */
typedef struct {double time,queued;size_t input,output,total;int mode,waits,recovered,reports,empty;size_t chunk,write_limit;pcm_queue_stats last;} fake;
static void advance(fake *f,int ms){if(f->queued>0&&f->queued<ms*24&&f->input<f->total)f->empty++;f->queued-=ms*24;if(f->queued<0)f->queued=0;f->time+=ms;}
static double now(void *p){return ((fake *)p)->time;}
static int cancel(void *p){fake *f=p;return f->mode==5&&f->time>50;}
static long input(void *p,unsigned char *d,size_t n,int timeout){fake *f=p;
 if(f->mode==8){advance(f,timeout?timeout:1);return 0;}
 if(f->input==f->total)return -1;
 if(f->mode==1&&f->time>=1000&&f->time<1100){advance(f,timeout);return 0;}
 if(n>f->chunk)n=f->chunk;if(n>f->total-f->input)n=f->total-f->input;
 for(size_t i=0;i<n;i++)d[i]=(unsigned char)((f->input+i)%251);
 f->input+=n;return (long)n;
}
static long write_pcm(void *p,const unsigned char *d,size_t frames){fake *f=p;
 if(f->mode==2||f->mode==3||f->mode==4||f->mode==6||f->mode==5){if(!f->recovered)return -EAGAIN;}
 size_t free_frames=(size_t)(512-f->queued);if(!free_frames)return -EAGAIN;
 if(frames>free_frames)frames=free_frames;if(frames>f->write_limit)frames=f->write_limit;
 for(size_t i=0;i<frames*2;i++)assert(d[i]==(unsigned char)((f->output+i)%251));
 f->output+=frames*2;f->queued+=frames;return (long)frames;
}
static int wait_pcm(void *p,int ms){fake *f=p;f->waits++;advance(f,ms);if(f->mode==3&&!f->recovered)return -EPIPE;if(f->mode==4)return -ENODEV;if(f->mode==6)return -EINTR;return f->mode==2?0:1;}
static int recover(void *p,int e){fake *f=p;if(e!=-EPIPE)return -1;f->recovered++;return 0;}
static void report(void *p,const pcm_queue_stats *q){fake *f=p;f->reports++;f->last=*q;assert(q->high_water<=q->capacity);}
static fake run(int mode,size_t total,size_t chunk,size_t write_limit,int expected){fake f={0};f.mode=mode;f.total=total;f.chunk=chunk;f.write_limit=write_limit;pcm_queue_stats s={0};pcm_queue_ops o={&f,now,cancel,input,write_pcm,wait_pcm,recover,report};int result=pcm_queue_run(&o,24000,2,128,&s);assert(result==expected);assert(f.reports>0);assert(f.waits<200000);if(expected==PCMQ_OK)assert(f.output==total);return f;}
int main(void){
 fake normal=run(0,24000*2*60,960,128,PCMQ_OK);assert(normal.time>59000);
 fake stalled=run(1,24000*2*3,960,128,PCMQ_OK);assert(!stalled.empty);assert(stalled.last.empty_events==0);
 run(0,80,7,3,PCMQ_OK);run(0,100001,127,13,PCMQ_PARTIAL);
 fake recovered=run(3,96000,960,128,PCMQ_OK);assert(recovered.recovered==1&&recovered.last.wait_errors==1);
 run(4,96000,960,128,PCMQ_WAIT);run(2,96000,960,128,PCMQ_STALLED);
 run(6,96000,960,128,PCMQ_STALLED);run(5,96000,960,128,PCMQ_CANCELLED);run(8,96000,960,128,PCMQ_INPUT_STALLED);
 puts("PASS production PCM queue: 60s, 100ms producer stall with 512-frame device, byte-exact partial IO, short EOF, malformed EOF, wait recovery/failure, bounded stall, input timeout, cancellation.");return 0;
}
