#include "json.h"
#include <ctype.h>
#include <limits.h>
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *mem(size_t n) { void *p=calloc(n?n:1,1); if(!p) abort(); return p; }
static void reserve(Buffer *b,size_t extra) {
    if(extra>SIZE_MAX-b->len-1) abort();
    size_t need=b->len+extra+1;
    if(need>b->cap) { size_t cap=b->cap?b->cap:128; while(cap<need) { if(cap>SIZE_MAX/2) abort(); cap*=2; } b->data=realloc(b->data,cap); if(!b->data)abort(); b->cap=cap; }
}
void binit(Buffer *b){ memset(b,0,sizeof(*b)); }
void bput(Buffer *b,const char *s){ size_t n=strlen(s); reserve(b,n); memcpy(b->data+b->len,s,n+1); b->len+=n; }
void bprintf(Buffer *b,const char *fmt,...){ va_list a,c; va_start(a,fmt); va_copy(c,a); int n=vsnprintf(NULL,0,fmt,a); va_end(a); if(n<0)abort(); reserve(b,(size_t)n); vsnprintf(b->data+b->len,(size_t)n+1,fmt,c); va_end(c); b->len+=(size_t)n; }
void bstring(Buffer *b,const char *s){ bput(b,"\""); for(const unsigned char *p=(const unsigned char*)s;*p;p++){ switch(*p){case '"':bput(b,"\\\"");break;case '\\':bput(b,"\\\\");break;case '\n':bput(b,"\\n");break;case '\r':bput(b,"\\r");break;case '\t':bput(b,"\\t");break;default:if(*p<32)bprintf(b,"\\u%04x",*p);else{reserve(b,1);b->data[b->len++]=(char)*p;b->data[b->len]=0;}}}bput(b,"\""); }
char *btake(Buffer *b){ if(!b->data)bput(b,"");char *s=b->data;binit(b);return s; }
typedef struct {const char *p,*start; char *error;size_t es;int depth;} Parser;
static void fail(Parser *p,const char *s){if(!p->error[0])snprintf(p->error,p->es,"JSON at byte %zu: %s",(size_t)(p->p-p->start),s);}
static void ws(Parser *p){while(*p->p==' '||*p->p=='\n'||*p->p=='\t'||*p->p=='\r')p->p++;}
static int hex4(Parser *p,unsigned *out){*out=0;for(int i=0;i<4;i++){unsigned char c=(unsigned char)*p->p;if(!c){fail(p,"short Unicode escape");return 0;}p->p++;int x= c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;if(x<0){fail(p,"invalid Unicode escape");return 0;}*out=(*out<<4)|(unsigned)x;}return 1;}
static char *str(Parser *p){
 if(*p->p++!='"'){fail(p,"expected string");return NULL;} Buffer b;binit(&b);
 while(*p->p&&*p->p!='"') {unsigned c=(unsigned char)*p->p++;int escaped=0;if(c<32){fail(p,"unescaped control character");goto bad;}
 if(c=='\\'){escaped=1;c=(unsigned char)*p->p++;switch(c){case '"':case '\\':case '/':break;case 'b':c=8;break;case 'f':c=12;break;case 'n':c=10;break;case 'r':c=13;break;case 't':c=9;break;case 'u':{if(!hex4(p,&c))goto bad;if(c>=0xd800&&c<=0xdbff){if(p->p[0]!='\\'||p->p[1]!='u'){fail(p,"missing low surrogate");goto bad;}p->p+=2;unsigned lo;if(!hex4(p,&lo))goto bad;if(lo<0xdc00||lo>0xdfff){fail(p,"invalid low surrogate");goto bad;}c=0x10000+((c-0xd800)<<10)+(lo-0xdc00);}else if(c>=0xdc00&&c<=0xdfff){fail(p,"unpaired surrogate");goto bad;}break;}default:fail(p,"invalid escape");goto bad;}}
 if(c==0){fail(p,"NUL strings are unsupported");goto bad;}
 unsigned char u[5];int n;if(c<128){u[0]=(unsigned char)c;n=1;}else if(c<2048){u[0]=(unsigned char)(192|(c>>6));u[1]=(unsigned char)(128|(c&63));n=2;}else if(c<65536){u[0]=(unsigned char)(224|(c>>12));u[1]=(unsigned char)(128|((c>>6)&63));u[2]=(unsigned char)(128|(c&63));n=3;}else{u[0]=(unsigned char)(240|(c>>18));u[1]=(unsigned char)(128|((c>>12)&63));u[2]=(unsigned char)(128|((c>>6)&63));u[3]=(unsigned char)(128|(c&63));n=4;}
 /* Raw UTF-8 bytes are already encoded; preserve them instead of re-encoding. */
 if(!escaped){u[0]=(unsigned char)c;n=1;}
 reserve(&b,(size_t)n);memcpy(b.data+b.len,u,(size_t)n);b.len+=(size_t)n;b.data[b.len]=0;
 }
 if(*p->p!='"'){fail(p,"unterminated string");goto bad;}p->p++;return btake(&b);
 bad:free(b.data);return NULL;
}
static JVal *value(Parser *p);
void jfree(JVal *v){if(!v)return;for(size_t i=0;i<v->len;i++)jfree(v->items[i]);free(v->items);free(v->text);free(v);}
static int push(JVal *v,JVal *x){v->items=realloc(v->items,(v->len+1)*sizeof(*v->items));if(!v->items)abort();v->items[v->len++]=x;return 1;}
static JVal *value(Parser *p){ws(p);if(++p->depth>256){fail(p,"nesting too deep");p->depth--;return NULL;}JVal *v=mem(sizeof(*v));char c=*p->p;
 if(c=='"'){v->type=J_STRING;v->text=str(p);if(!v->text)goto bad;}
 else if(c=='{'||c=='['){v->type=c=='{'?J_OBJECT:J_ARRAY;char close=c=='{'?'}':']';p->p++;ws(p);if(*p->p!=close)for(;;){
 if(v->type==J_OBJECT){if(*p->p!='"'){fail(p,"expected object key");goto bad;}JVal *k=mem(sizeof(*k));k->type=J_STRING;k->text=str(p);if(!k->text){jfree(k);goto bad;}for(size_t i=0;i<v->len;i+=2)if(!strcmp(v->items[i]->text,k->text)){jfree(k);fail(p,"duplicate object key");goto bad;}push(v,k);ws(p);if(*p->p++!=':'){fail(p,"expected colon");goto bad;}}
 JVal *x=value(p);if(!x)goto bad;push(v,x);ws(p);if(*p->p!=',')break;p->p++;ws(p);}
 if(*p->p!=close){fail(p,"expected closing bracket");goto bad;}p->p++;
 }else if(!strncmp(p->p,"null",4)){v->type=J_NULL;p->p+=4;}
 else if(!strncmp(p->p,"true",4)||!strncmp(p->p,"false",5)){v->type=J_BOOL;int t=*p->p=='t';v->text=mem(6);strcpy(v->text,t?"true":"false");p->p+=t?4:5;}
 else if(c=='-'||isdigit((unsigned char)c)){v->type=J_NUMBER;const char *a=p->p;if(*p->p=='-')p->p++;if(*p->p=='0')p->p++;else if(*p->p>='1'&&*p->p<='9')while(isdigit((unsigned char)*p->p))p->p++;else{fail(p,"invalid number");goto bad;}if(*p->p=='.'){p->p++;if(!isdigit((unsigned char)*p->p)){fail(p,"invalid fraction");goto bad;}while(isdigit((unsigned char)*p->p))p->p++;}if(*p->p=='e'||*p->p=='E'){p->p++;if(*p->p=='+'||*p->p=='-')p->p++;if(!isdigit((unsigned char)*p->p)){fail(p,"invalid exponent");goto bad;}while(isdigit((unsigned char)*p->p))p->p++;}size_t n=(size_t)(p->p-a);v->text=mem(n+1);memcpy(v->text,a,n);}
 else{fail(p,"expected value");goto bad;}p->depth--;return v;
 bad:jfree(v);p->depth--;return NULL;
}
JVal *jparse(const char *s,char *e,size_t n){if(!s||!e||!n)return NULL;e[0]=0;Parser p={s,s,e,n,0};JVal *v=value(&p);if(v){ws(&p);if(*p.p){fail(&p,"trailing data");jfree(v);return NULL;}}return v;}
const JVal *jget(const JVal *v,const char *k){if(!v||v->type!=J_OBJECT)return NULL;for(size_t i=0;i+1<v->len;i+=2)if(!strcmp(v->items[i]->text,k))return v->items[i+1];return NULL;}
int jint(const JVal *v,int *out){if(!v||v->type!=J_NUMBER||!v->text[0])return 0;long long a=0;for(const char *p=v->text;*p;p++){if(*p<'0'||*p>'9')return 0;a=a*10+*p-'0';if(a>INT_MAX)return 0;}*out=(int)a;return 1;}
