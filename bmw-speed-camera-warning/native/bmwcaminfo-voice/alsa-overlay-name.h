/* SmartX names, not guessed device IDs. Pure helpers shared with native tests. */
#ifndef SPEEDCAM_ALSA_OVERLAY_NAME_H
#define SPEEDCAM_ALSA_OVERLAY_NAME_H
#include <ctype.h>
#include <stdio.h>
#include <string.h>
static int overlay_port(const char *s){
 const char *base="oapgenericoverlay";size_t n=strlen(base),i;
 if(strlen(s)<n||strlen(s)>240)return 0;
 for(i=0;i<n;i++)if(tolower((unsigned char)s[i])!=base[i])return 0;
 if(s[n]&&s[n]!='_')return 0;
 for(i=n;s[i];i++)if(!isalnum((unsigned char)s[i])&&s[i]!='_'&&s[i]!='-')return 0;
 return 1;
}
static int overlay_from_hint(const char *name,char *out,size_t size){
 if(!strncmp(name,"plug:",5))name+=5;
 if(strncmp(name,"smartx:",7)||!overlay_port(name+7))return 0;
 int n=snprintf(out,size,"plug:%s",name);return n>0&&(size_t)n<size;
}
static int overlay_from_shm(const char *name,char *out,size_t size){
 const char *suffix="_p_connection";size_t n=strlen(name),tail=strlen(suffix);
 if(strncmp(name,"smartx_",7)||n<=7+tail||strcmp(name+n-tail,suffix))return 0;
 char port[256];size_t len=n-7-tail;if(len>=sizeof(port))return 0;
 memcpy(port,name+7,len);port[len]=0;
 if(!overlay_port(port))return 0;
 int result=snprintf(out,size,"plug:smartx:%s",port);return result>0&&(size_t)result<size;
}
static void overlay_candidate(const char *name,char *out,size_t size,int *count){
 if(!*count){snprintf(out,size,"%s",name);*count=1;}
 else if(strcmp(out,name))*count=2;
}
#endif
