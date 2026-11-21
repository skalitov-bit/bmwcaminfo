#include <stddef.h>
extern void test_failure(int);
#define CHECK(c) do{if(!(c))test_failure(__LINE__);}while(0)
typedef struct {int unused;} snd_pcm_t;
static int variant,allocated,closed;
#define RTLD_NOW 0
#define RTLD_LOCAL 0
static int test_log(int s,const char *fmt,...){(void)s;(void)fmt;return 0;}
#define stderr 0
#define fprintf test_log
static int eq(const char *a,const char *b){while(*a&&*a==*b){a++;b++;}return *a==*b;}
static void *dlopen(const char *n,int f){(void)n;(void)f;return (void *)1;}
static int dlclose(void *p){(void)p;closed++;return 0;}
static int allocp(void **p){allocated++;*p=(void *)2;return 0;}
static void freep(void *p){(void)p;allocated--;}
static int current(snd_pcm_t *s,void *p){(void)s;(void)p;return variant==5?-1:0;}
static int any(snd_pcm_t *s,void *p){(void)s;(void)p;return 0;}
static int format(const void *p,int *n){(void)p;*n=variant==1?14:2;return 0;}
static int accessp(const void *p,int *n){(void)p;*n=variant==4?0:3;return 0;}
static int ratep(const void *p,unsigned *n,int *d){(void)p;*n=variant==2?48000:24000;*d=0;return 0;}
static int chan(const void *p,unsigned *n){(void)p;*n=variant==3?2:1;return 0;}
static int testfmt(snd_pcm_t *s,void *p,int n){(void)s;(void)p;return n==2?0:-1;}
static void *dlsym(void *p,const char *n){(void)p;if(variant==6)return NULL;
#define MAP(name,fn) if(eq(n,name))return (void *)fn
 MAP("snd_pcm_hw_params_malloc",allocp);MAP("snd_pcm_hw_params_free",freep);MAP("snd_pcm_hw_params_current",current);MAP("snd_pcm_hw_params_any",any);MAP("snd_pcm_hw_params_get_format",format);MAP("snd_pcm_hw_params_get_access",accessp);MAP("snd_pcm_hw_params_get_rate",ratep);MAP("snd_pcm_hw_params_get_channels",chan);MAP("snd_pcm_hw_params_test_format",testfmt);
 return NULL;
}
#include "../native/bmwcaminfo-voice/direct-pcm.h"
int main(void){for(variant=0;variant<=6;variant++){closed=0;CHECK((inspect_pcm(NULL,1)==0)==(variant==0));CHECK(allocated==0&&closed==1);}variant=6;CHECK(inspect_pcm(NULL,0)==0);return 0;}
