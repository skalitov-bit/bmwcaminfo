#include <stdint.h>
#include <stddef.h>
#include <string.h>
extern void test_failure(int line);
extern void test_values(int mode,int result,int starts,int dones,double time);
#define CHECK(c) do{if(!(c))test_failure(__LINE__);}while(0)
void *memset(void *p,int v,size_t n){volatile unsigned char *d=p;for(size_t i=0;i<n;i++)d[i]=(unsigned char)v;return p;}
void *memcpy(void *p,const void *s,size_t n){unsigned char *d=p;const unsigned char *a=s;for(size_t i=0;i<n;i++)d[i]=a[i];return p;}
void *memmove(void *p,const void *s,size_t n){unsigned char *d=p;const unsigned char *a=s;if(d<a){for(size_t i=0;i<n;i++)d[i]=a[i];}else{while(n){n--;d[n]=a[n];}}return p;}
static unsigned char heap[4000000];static size_t hp;
static void *malloc(size_t n){n=(n+7)&~(size_t)7;CHECK(hp+n<=sizeof(heap));void *p=heap+hp;hp+=n;return p;}
static void free(void *p){(void)p;}
static int test_log(int stream,const char *fmt,...){(void)stream;(void)fmt;return 0;}
#define stderr 0
#define fprintf test_log
#define SPEEDCAM_STABLE_TEST
#define STDIN_FILENO 0
#define POLLIN 1
#define EINTR 4
#define EAGAIN 11
#define EPIPE 32
#define ESTRPIPE 86
#define EINVAL 22
static int errno,cancelled;
typedef long ssize_t;
typedef struct {int unused;} snd_pcm_t;
typedef struct {int known;unsigned long period;unsigned underruns,suspends,write_errors,recoveries,recovery_failures;double read_call,input_gap,write_call,write_gap;} buffer_stats;
struct pollfd {int fd,events,revents;};struct timespec {long sec,nsec;};
typedef struct {double at;size_t bytes,pos;unsigned char data[50000];} message;
static message messages[12];static unsigned count,next,starts,dones;static double clock_ms,device_frames;
static int mode,injected;static size_t outputs;static int16_t output[150000];
static void advance(double ms){clock_ms+=ms;device_frames-=ms*24;if(device_frames<0)device_frames=0;}
static double now_ms(void){return clock_ms;}
static int poll(struct pollfd *f,int n,int t){(void)f;(void)n;advance(t);return next<count&&messages[next].at<=clock_ms;}
static ssize_t read(int fd,void *dst,size_t n){(void)fd;message *m=&messages[next];if(n>m->bytes-m->pos)n=m->bytes-m->pos;if(mode==2&&n>7)n=7;memcpy(dst,m->data+m->pos,n);m->pos+=n;if(m->pos==m->bytes)next++;return n;}
static int nanosleep(const struct timespec *t,void *p){(void)p;advance(t->sec*1000+t->nsec/1000000.0);return 0;}
static void alarm(int s){(void)s;}
static long pcm_write(snd_pcm_t *p,const void *data,unsigned long n){(void)p;if(mode==1&&!injected&&clock_ms>500){injected=1;return -EPIPE;}if(mode>=4)CHECK(n<=128);size_t space=(size_t)(480-device_frames);if(!space)return -EAGAIN;if(n>space)n=space;if((mode==2||mode==5)&&n>13)n=13;CHECK(outputs+n<150000);memcpy(output+outputs,data,n*2);outputs+=n;device_frames+=n;return (long)n;}
static int pcm_wait(snd_pcm_t *p,int ms){(void)p;advance(ms);return mode==3?-5:1;}
static int pcm_recover(snd_pcm_t *p,int e,int silent){(void)p;(void)silent;return e==-EPIPE?0:-1;}
static int pcm_delay(snd_pcm_t *p,long *n){(void)p;*n=(long)device_frames;return 0;}
static long available(snd_pcm_t *p){(void)p;return (long)(480-device_frames);}
static long (*pcm_avail)(snd_pcm_t *)=available;
static int (*pcm_state)(snd_pcm_t *)=NULL;
static void buffer_report(const buffer_stats *s,unsigned r,unsigned ch,unsigned x,unsigned long f){(void)s;(void)r;(void)ch;(void)x;(void)f;}
static void stable_event(const char *e,unsigned id){if(e[0]=='s'){CHECK(id==7);starts++;}if(e[0]=='d'){CHECK(id==7);dones++;}}
#include "../native/bmwcaminfo-voice/stable-stream.h"
static void put32(unsigned char *p,unsigned v){for(int i=0;i<4;i++)p[i]=(unsigned char)(v>>(i*8));}
static void msg(double at,unsigned type,unsigned id,unsigned a,unsigned b,unsigned frames){message *m=&messages[count++];m->at=at;m->bytes=24+frames*2;m->pos=0;put32(m->data,0x31504353);put32(m->data+4,type);put32(m->data+8,id);put32(m->data+12,a);put32(m->data+16,b);put32(m->data+20,frames*2);for(unsigned i=0;i<frames;i++){int16_t v=(i/12)%2?24000:-24000;m->data[24+i*2]=(unsigned char)v;m->data[25+i*2]=(unsigned char)((unsigned short)v>>8);}}
static void stream_test(int testmode){
 memset(messages,0,sizeof(messages));count=next=starts=dones=0;clock_ms=device_frames=0;mode=testmode;injected=0;outputs=0;hp=0;
 msg(0,7,60,40,10,0);msg(0,1,0,0,0,12000);msg(0,2,1,300,40,0);msg(100,3,7,40,0,24000);
 /* No JS audio data for 700ms while the whole phrase plays natively. */
 msg(800,2,1,300,40,0);msg(1200,2,1,300,40,0);msg(1600,2,1,300,40,0);msg(1900,4,0,0,0,0);msg(2900,5,0,0,0,0);
 buffer_stats s={0};s.known=1;s.period=128;unsigned long written=0;int r=stable_stream(NULL,&s,&written,testmode>=4);
 if(testmode==3){CHECK(r<0);return;}
 test_values(testmode,r,starts,dones,clock_ms);
 CHECK(r==0&&starts==1&&dones==1&&written==outputs&&clock_ms>=2900&&clock_ms<3500);
 CHECK(testmode!=1||s.underruns==1);CHECK(!s.recovery_failures);
 for(size_t i=0;i<outputs;i++)CHECK(output[i]<32767&&output[i]>-32768);
}
static unsigned char pulse[24000],voice[48000];
int main(void){
 for(unsigned i=0;i<12000;i++){pulse[i*2]=0;pulse[i*2+1]=64;}
 for(unsigned i=0;i<24000;i++){voice[i*2]=0;voice[i*2+1]=64;}
 for(unsigned volume=20;volume<=100;volume+=20){stable_mixer m;sm_init(&m,pulse,sizeof(pulse));CHECK(sm_voice_add(&m,voice,sizeof(voice),1,volume)==0);int value=0;for(int i=0;i<1000;i++)value=sm_sample(&m,0);double expected=16383.5*SM_GAIN*volume/100;CHECK(sm_abs(value-expected)<2);}
 stable_mixer m;sm_init(&m,pulse,sizeof(pulse));CHECK(sm_set(&m,1,300,100,0)==0);
 for(int i=0;i<1000;i++)sm_sample(&m,0);CHECK(m.tail_count==1);sm_clear(&m);
 for(int i=1000;i<12000;i++){int16_t v=sm_sample(&m,0);if(i<11800)CHECK(v!=0);if(i==11999)CHECK(v==0);}CHECK(!m.tail_count&&m.pulses==1);
 sm_init(&m,pulse,sizeof(pulse));sm_set(&m,1,300,100,0);sm_voice_add(&m,voice,sizeof(voice),7,100);
 for(int i=0;i<2000;i++)sm_sample(&m,0);CHECK(m.duck<.251&&m.duck>.249);CHECK(m.pulses==1);
 for(int i=2000;i<24000;i++)sm_sample(&m,0);CHECK(m.pulses>=3);CHECK(m.saturated==0);
 for(int i=0;i<5000;i++)sm_sample(&m,0);CHECK(m.duck>.99);
 sm_init(&m,pulse,sizeof(pulse));sm_set(&m,1,300,100,0);for(int i=0;i<48000;i++)sm_sample(&m,i/24.0);CHECK(m.pulses==4&&m.tail_count==0);
 sm_init(&m,pulse,sizeof(pulse));m.voice_gain=.6;m.beeper_gain=.4;m.duck_target=.1;
 sm_set(&m,1,3000,100,0);sm_voice_add(&m,voice,sizeof(voice),7,100);
 int scaled=0;for(int i=0;i<2400;i++)scaled=sm_sample(&m,0);
 CHECK(sm_abs(scaled-16383.5*SM_GAIN*(.6+.4*.1))<2);CHECK(m.duck<.101);
 for(int i=0;i<6;i++)stream_test(i);
 return 0;
}
