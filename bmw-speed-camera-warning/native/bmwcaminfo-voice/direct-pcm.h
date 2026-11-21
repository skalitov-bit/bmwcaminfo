/* Read the negotiated parameters from the opened PCM, never infer them from
 * a SmartX port's name. Direct test refuses format/rate/channel substitution. */
static int inspect_pcm(snd_pcm_t *pcm,int required){
 void *lib=dlopen("libasound.so.2",RTLD_NOW|RTLD_LOCAL),*p=NULL;
 int (*allocp)(void **),(*current)(snd_pcm_t *,void *),(*any)(snd_pcm_t *,void *);
 void (*freep)(void *);
 int (*fmt)(const void *,int *),(*accessp)(const void *,int *);
 int (*ratep)(const void *,unsigned *,int *),(*chan)(const void *,unsigned *);
 int (*testfmt)(snd_pcm_t *,void *,int);
 if(!lib)return -1;
#define SYM(v,n) do{*(void **)(&(v))=dlsym(lib,n);if(!(v))goto missing;}while(0)
 SYM(allocp,"snd_pcm_hw_params_malloc");SYM(freep,"snd_pcm_hw_params_free");
 SYM(current,"snd_pcm_hw_params_current");SYM(any,"snd_pcm_hw_params_any");
 SYM(fmt,"snd_pcm_hw_params_get_format");SYM(accessp,"snd_pcm_hw_params_get_access");
 SYM(ratep,"snd_pcm_hw_params_get_rate");SYM(chan,"snd_pcm_hw_params_get_channels");
 SYM(testfmt,"snd_pcm_hw_params_test_format");
#undef SYM
 if(allocp(&p)<0)goto missing;
 int f=-1,a=-1,dir=0;unsigned r=0,c=0;
 int ok=current(pcm,p)>=0&&fmt(p,&f)>=0&&accessp(p,&a)>=0&&ratep(p,&r,&dir)>=0&&chan(p,&c)>=0;
 int s16=-1,s32=-1,flt=-1;
 if(any(pcm,p)>=0){s16=testfmt(pcm,p,2)>=0;s32=testfmt(pcm,p,10)>=0;flt=testfmt(pcm,p,14)>=0;}
 fprintf(stderr,"SPEEDCAM_FORMAT {\"parametersKnown\":%s,\"direct\":%s,\"formatId\":%d,\"accessId\":%d,\"rate\":%u,\"channels\":%u,\"supportsS16LE\":%d,\"supportsS32LE\":%d,\"supportsFloatLE\":%d,\"capabilityScope\":\"opened PCM, may be constrained by installed configuration\"}\n",ok?"true":"false",required?"true":"false",f,a,r,c,s16,s32,flt);
 freep(p);dlclose(lib);
 if(required&&(!ok||f!=2||a!=3||r!=24000||c!=1)){
  fprintf(stderr,"Direct SmartX requires verified S16_LE/RW_INTERLEAVED/24000Hz/mono; no plug fallback\n");return -1;
 }
 return 0;
missing:
 fprintf(stderr,"SPEEDCAM_FORMAT {\"parametersKnown\":false,\"reason\":\"ALSA parameter API unavailable\"}\n");
 if(lib)dlclose(lib);return required?-1:0;
}
