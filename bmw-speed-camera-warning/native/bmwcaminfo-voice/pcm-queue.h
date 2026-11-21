#ifndef SPEEDCAM_PCM_QUEUE_H
#define SPEEDCAM_PCM_QUEUE_H
#include <stddef.h>
#include <errno.h>
/* Bounded native reservoir, independent of Node's event loop. The identical
 * pump is exercised with a deterministic fake device in pcm-queue.test.c.
 * input: bytes, 0 timeout, -1 EOF, -2 failure. No sample duplication/discard. */
typedef struct {
 size_t capacity,queued,high_water,low_water;
 unsigned empty_events,wait_timeouts,wait_errors,again,recoveries;
 double prefill_ms,max_empty_ms,max_no_progress_ms;
 long last_wait,last_error;
 int prefilled;
} pcm_queue_stats;
typedef struct {
 void *ctx;
 double (*now)(void *);
 int (*cancelled)(void *);
 long (*input)(void *,unsigned char *,size_t,int);
 long (*write)(void *,const unsigned char *,size_t);
 int (*wait)(void *,int);
 int (*recover)(void *,int);
 void (*report)(void *,const pcm_queue_stats *);
} pcm_queue_ops;
enum { PCMQ_OK,PCMQ_CANCELLED,PCMQ_INPUT,PCMQ_PARTIAL,PCMQ_WRITE,PCMQ_WAIT,PCMQ_STALLED,PCMQ_INPUT_STALLED };
static int pcm_queue_run(pcm_queue_ops *o,unsigned rate,unsigned frame_bytes,
                         size_t period,pcm_queue_stats *s){
 unsigned char data[46080]; /* <=240 ms, 48kHz stereo S16 */
 size_t cap=(size_t)rate*frame_bytes*240/1000,head=0,used=0;
 const size_t prefill=(size_t)rate*frame_bytes*120/1000;
 double start=o->now(o->ctx),progress=start,report=start,empty_since=-1;
 int eof=0,running=0,result=PCMQ_OK;
 if(!cap||cap>sizeof(data)||!frame_bytes)return PCMQ_INPUT;
 if(!period||period>rate/50)period=rate/50;
 s->capacity=cap/frame_bytes;s->low_water=s->capacity;
 for(;;){
  double now=o->now(o->ctx);
  if(o->cancelled(o->ctx)){result=PCMQ_CANCELLED;break;}
  if(!eof&&used<cap){
   size_t tail=(head+used)%cap,space=cap-used;
   if(space>cap-tail)space=cap-tail;
   long n=o->input(o->ctx,data+tail,space,(!running||used<frame_bytes)?5:0);
   if(n==-1)eof=1;
   else if(n<0||(size_t)n>space){result=PCMQ_INPUT;break;}
   else used+=(size_t)n;
  }
  now=o->now(o->ctx);s->queued=used/frame_bytes;
  if(s->queued>s->high_water)s->high_water=s->queued;
  if(!running&&(used>=prefill||eof||(used>=frame_bytes&&now-start>=200))){
   running=1;s->prefilled=1;s->prefill_ms=now-start;progress=now;
  }
  if(running){
   if(!eof&&s->queued<s->low_water)s->low_water=s->queued;
   if(used<frame_bytes&&!eof){
    if(empty_since<0){empty_since=now;s->empty_events++;}
   }else if(empty_since>=0){
    if(now-empty_since>s->max_empty_ms)s->max_empty_ms=now-empty_since;
    empty_since=-1;
   }
  }
  if(eof&&used<frame_bytes){result=used?PCMQ_PARTIAL:PCMQ_OK;break;}
  if(running&&used>=frame_bytes){
   size_t count=used/frame_bytes,contiguous=(cap-head)/frame_bytes;
   if(count>period)count=period;
   if(count>contiguous)count=contiguous;
   long w=o->write(o->ctx,data+head,count);
   if(w>0&&(size_t)w<=count){
    head=(head+(size_t)w*frame_bytes)%cap;used-=(size_t)w*frame_bytes;
    progress=o->now(o->ctx);
   }else if(w==0||w==-EAGAIN){
    s->again++;int r=o->wait(o->ctx,5);s->last_wait=r;
    if(r==0)s->wait_timeouts++;
    else if(r<0&&r!=-EINTR){
     s->wait_errors++;s->last_error=r;
     if(s->recoveries>=3||o->recover(o->ctx,r)<0){result=PCMQ_WAIT;break;}
     s->recoveries++;
    }
   }else if(w==-EINTR){ /* retry without moving the queue */ }
   else {
    s->last_error=w;
    if(w>0||s->recoveries>=3||o->recover(o->ctx,(int)w)<0){result=PCMQ_WRITE;break;}
    s->recoveries++;
   }
  }
  now=o->now(o->ctx);
  double gap=now-progress;
  if(running&&gap>s->max_no_progress_ms)s->max_no_progress_ms=gap;
  if(running&&used>=frame_bytes&&gap>1200){result=PCMQ_STALLED;break;}
  if(used<frame_bytes&&gap>2000){result=PCMQ_INPUT_STALLED;break;}
  if(now-report>=1000){s->queued=used/frame_bytes;o->report(o->ctx,s);report=now;}
 }
 s->queued=used/frame_bytes;
 if(s->low_water>s->high_water)s->low_water=s->high_water;
 if(empty_since>=0&&o->now(o->ctx)-empty_since>s->max_empty_ms)s->max_empty_ms=o->now(o->ctx)-empty_since;
 o->report(o->ctx,s);
 return result;
}
#endif
