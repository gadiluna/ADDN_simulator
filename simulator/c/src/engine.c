#include "counting.h"
#include "json.h"
#include <gmp.h>
#include <stdint.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define BUCKETS 65536
#define MAX_AGENTS 4096
static char last_error[512];
static void *alloc(size_t n,size_t z){if(z&&n>SIZE_MAX/z)abort();void *p=calloc(n?n:1,z?z:1);if(!p)abort();return p;}
static int error(const char *s){snprintf(last_error,sizeof(last_error),"%s",s);return 0;}
const char *sim_last_error(void){return last_error;}
void sim_free_string(char *s){free(s);}
typedef struct {int source;mpz_t count;} Message;
typedef struct {int id,level,parent,leader,next;uint64_t hash;mpz_t degree;Message *incoming;int incoming_count;} Node;
typedef struct {int *agents,count;} Fiber;
typedef struct {int source,target;mpz_t count;} Edge;
typedef struct {Edge *edges;int count;} Graph;
typedef struct {int candidate,k,anchor,status,rows,cols,solved;const char *reason;int *columns,*descendants;mpq_t *equations,*solution;} Audit;
typedef struct {unsigned char *prefix;int candidate,k;Audit audit;} AuditCache;
typedef struct {int leader,bottom,halted,output;Audit audit;} Agent;
struct Sim {int n,ell,sharp,round,repeat_last,graph_count,node_count,node_cap,complete;Graph *graphs;Node *nodes;Fiber *fibers;Agent *agents;AuditCache *cache;int cache_count;int buckets[BUCKETS];};
static int get_int(const JVal *obj,const char *key,int *v){return jint(jget(obj,key),v);}
static int decimal(mpz_t out,const JVal *v,int positive){
 if(!v||v->type!=J_STRING||!v->text[0])return error("multiplicities and outdegrees must be decimal strings");
 for(const char *p=v->text;*p;p++)if(*p<'0'||*p>'9')return error("invalid decimal integer");
 if(mpz_set_str(out,v->text,10)||(positive?mpz_sgn(out)<=0:mpz_sgn(out)<0))return error("invalid nonnegative integer");return 1;
}
static void audit_reset(Audit *a){
 if(a->equations)for(int i=0;i<a->rows*(a->cols+1);i++)mpq_clear(a->equations[i]);
 if(a->solution)for(int i=0;i<a->cols;i++)mpq_clear(a->solution[i]);
 free(a->equations);free(a->solution);free(a->columns);free(a->descendants);memset(a,0,sizeof(*a));a->reason="waiting";
}
static void audit_copy(Audit *dst,const Audit *src){
 audit_reset(dst);*dst=*src;dst->columns=NULL;dst->descendants=NULL;dst->equations=NULL;dst->solution=NULL;
 if(src->columns){dst->columns=alloc((size_t)src->cols,sizeof(int));memcpy(dst->columns,src->columns,(size_t)src->cols*sizeof(int));}
 if(src->descendants){dst->descendants=alloc((size_t)src->cols,sizeof(int));memcpy(dst->descendants,src->descendants,(size_t)src->cols*sizeof(int));}
 int cells=src->rows*(src->cols+1);
 if(src->equations){dst->equations=alloc((size_t)cells,sizeof(mpq_t));for(int i=0;i<cells;i++){mpq_init(dst->equations[i]);mpq_set(dst->equations[i],src->equations[i]);}}
 if(src->solution){dst->solution=alloc((size_t)src->cols,sizeof(mpq_t));for(int i=0;i<src->cols;i++){mpq_init(dst->solution[i]);mpq_set(dst->solution[i],src->solution[i]);}}
}
static void cache_clear(Sim *s){for(int i=0;i<s->cache_count;i++){free(s->cache[i].prefix);audit_reset(&s->cache[i].audit);}free(s->cache);s->cache=NULL;s->cache_count=0;}
static void node_clear(Node *n){mpz_clear(n->degree);for(int i=0;i<n->incoming_count;i++)mpz_clear(n->incoming[i].count);free(n->incoming);}
void sim_destroy(Sim *s){
 if(!s)return;if(s->graphs)for(int g=0;g<s->graph_count;g++){for(int j=0;j<s->graphs[g].count;j++)mpz_clear(s->graphs[g].edges[j].count);free(s->graphs[g].edges);}
 for(int i=0;i<s->node_count;i++)node_clear(&s->nodes[i]);if(s->agents)for(int i=0;i<s->n;i++)audit_reset(&s->agents[i].audit);
 cache_clear(s);if(s->fibers)for(int i=0;i<s->node_count;i++)free(s->fibers[i].agents);free(s->fibers);free(s->graphs);free(s->nodes);free(s->agents);free(s);
}
static uint64_t mix(uint64_t h,uint64_t x){return (h^x)*UINT64_C(1099511628211);}
static uint64_t hash_z(uint64_t h,mpz_srcptr x){for(size_t i=0;i<mpz_size(x);i++)h=mix(h,(uint64_t)mpz_getlimbn(x,(mp_size_t)i));return mix(h,(uint64_t)mpz_size(x));}
static int message_compare(const void *a,const void *b){int x=((const Message*)a)->source,y=((const Message*)b)->source;return (x>y)-(x<y);}
static int intern(Sim *s,int level,int parent,int leader,mpz_srcptr degree,Message *msg,int count){
 uint64_t h=mix(mix(UINT64_C(1469598103934665603),(uint64_t)(parent+1)),(uint64_t)leader);h=hash_z(h,degree);
 for(int i=0;i<count;i++){h=mix(h,(uint64_t)msg[i].source);h=hash_z(h,msg[i].count);}unsigned bucket=(unsigned)(h%BUCKETS);
 for(int k=s->buckets[bucket];k>=0;k=s->nodes[k].next){Node *v=&s->nodes[k];if(v->hash!=h||v->parent!=parent||v->leader!=leader||v->level!=level||v->incoming_count!=count||mpz_cmp(v->degree,degree))continue;int equal=1;for(int j=0;j<count;j++)if(v->incoming[j].source!=msg[j].source||mpz_cmp(v->incoming[j].count,msg[j].count)){equal=0;break;}if(equal)return k;}
 if(s->node_count==s->node_cap){int old=s->node_cap;s->node_cap=s->node_cap?s->node_cap*2:128;s->nodes=realloc(s->nodes,(size_t)s->node_cap*sizeof(Node));s->fibers=realloc(s->fibers,(size_t)s->node_cap*sizeof(Fiber));if(!s->nodes||!s->fibers)abort();memset(s->fibers+old,0,(size_t)(s->node_cap-old)*sizeof(Fiber));}
 int id=s->node_count++;Node *v=&s->nodes[id];memset(v,0,sizeof(*v));v->id=id;v->level=level;v->parent=parent;v->leader=leader;v->hash=h;v->next=s->buckets[bucket];s->buckets[bucket]=id;
 mpz_init_set(v->degree,degree);v->incoming_count=count;v->incoming=alloc((size_t)count,sizeof(Message));for(int i=0;i<count;i++){v->incoming[i].source=msg[i].source;mpz_init_set(v->incoming[i].count,msg[i].count);}return id;
}
static void fiber_add(Sim *s,int node,int agent){Fiber *f=&s->fibers[node];f->agents=realloc(f->agents,(size_t)(f->count+1)*sizeof(int));if(!f->agents)abort();f->agents[f->count++]=agent;}
/* A local audit can inspect only the ancestry closure of received histories.
 * Interning shares storage, never access to another agent's unseen history. */
static unsigned char *visible(const Node *nodes,int node_count,int bottom){
 unsigned char *seen=alloc((size_t)node_count,1);seen[bottom]=1;for(int i=bottom;i>=0;i--)if(seen[i]){const Node *v=&nodes[i];if(v->parent>=0)seen[v->parent]=1;for(int j=0;j<v->incoming_count;j++)seen[v->incoming[j].source]=1;}return seen;
}
static int connected(const Graph *g,int n){
 unsigned char *seen=alloc((size_t)n,1);int *stack=alloc((size_t)n,sizeof(int));for(int reverse=0;reverse<2;reverse++){memset(seen,0,(size_t)n);int top=0;stack[top++]=0;seen[0]=1;while(top){int u=stack[--top];for(int i=0;i<g->count;i++){int from=reverse?g->edges[i].target:g->edges[i].source,to=reverse?g->edges[i].source:g->edges[i].target;if(from==u&&!seen[to]){seen[to]=1;stack[top++]=to;}}}for(int i=0;i<n;i++)if(!seen[i]){free(seen);free(stack);return 0;}}free(seen);free(stack);return 1;
}
Sim *sim_create(const char *input){
 last_error[0]=0;JVal *json=jparse(input,last_error,sizeof(last_error));if(!json)return NULL;Sim *s=alloc(1,sizeof(*s));for(int i=0;i<BUCKETS;i++)s->buckets[i]=-1;int version=0;
 if(!get_int(json,"schema_version",&version)||version!=1){error("schema_version must be 1");goto bad;}
 if(!get_int(json,"n",&s->n)||s->n<1||s->n>MAX_AGENTS){error("n must be between 1 and 4096");goto bad;}
 const JVal *variant=jget(json,"variant");if(!variant||variant->type!=J_STRING||(strcmp(variant->text,"core")&&strcmp(variant->text,"sharp"))){error("variant must be core or sharp");goto bad;}s->sharp=!strcmp(variant->text,"sharp");
 const JVal *repeat=jget(json,"repeat_last");if(!repeat||repeat->type!=J_BOOL){error("repeat_last must be an explicit boolean");goto bad;}s->repeat_last=!strcmp(repeat->text,"true");s->agents=alloc((size_t)s->n,sizeof(Agent));
 const JVal *leaders=jget(json,"leaders");if(!leaders||leaders->type!=J_ARRAY||!leaders->len||leaders->len>(size_t)s->n){error("leaders must be a nonempty list");goto bad;}
 for(size_t i=0;i<leaders->len;i++){int k;if(!jint(leaders->items[i],&k)||k>=s->n||s->agents[k].leader){error("leader IDs must be unique and in range");goto bad;}s->agents[k].leader=1;s->ell++;}
 const JVal *rounds=jget(json,"rounds");if(!rounds||rounds->type!=J_ARRAY||!rounds->len||rounds->len>100000){error("rounds must be a nonempty array (at most 100000)");goto bad;}s->graph_count=(int)rounds->len;s->graphs=alloc(rounds->len,sizeof(Graph));
 for(int r=0;r<s->graph_count;r++){const JVal *edges=jget(rounds->items[r],"edges");if(!edges||edges->type!=J_ARRAY||edges->len>2000000){error("each round needs an edges array (at most 2000000)");goto bad;}Graph *g=&s->graphs[r];g->count=(int)edges->len;g->edges=alloc(edges->len,sizeof(Edge));for(int i=0;i<g->count;i++)mpz_init(g->edges[i].count);
  for(int i=0;i<g->count;i++){Edge *e=&g->edges[i];const JVal *v=edges->items[i];if(!get_int(v,"source",&e->source)||!get_int(v,"target",&e->target)||e->source>=s->n||e->target>=s->n){error("edge endpoints must be agent IDs in range");goto bad;}if(!decimal(e->count,jget(v,"multiplicity"),1))goto bad;}
  if(!connected(g,s->n)){snprintf(last_error,sizeof(last_error),"round %d is not strongly connected",r+1);goto bad;}}
 mpz_t zero;mpz_init(zero);int root=intern(s,-1,-1,0,zero,NULL,0);for(int a=0;a<s->n;a++){int k=intern(s,0,root,s->agents[a].leader,zero,NULL,0);s->agents[a].bottom=k;s->agents[a].audit.reason="waiting";fiber_add(s,k,a);fiber_add(s,root,a);}mpz_clear(zero);jfree(json);return s;
bad:jfree(json);sim_destroy(s);return NULL;
}
static mpq_t *rationals(int n){mpq_t *v=alloc((size_t)n,sizeof(mpq_t));for(int i=0;i<n;i++)mpq_init(v[i]);return v;}
static void rational_free(mpq_t *v,int n){if(v)for(int i=0;i<n;i++)mpq_clear(v[i]);free(v);}
/* RREF over Q. The candidate total is a postcondition, not another equation. */
static int solve(const mpq_t *original,int rows,int cols,mpq_t *out){
 int stride=cols+1;mpq_t *a=rationals(rows*stride);for(int i=0;i<rows*stride;i++)mpq_set(a[i],original[i]);mpq_t pivot,factor,temp;mpq_inits(pivot,factor,temp,NULL);int rank=0,result=1;
 for(int c=0;c<cols;c++){int r=rank;while(r<rows&&!mpq_sgn(a[r*stride+c]))r++;if(r==rows)continue;for(int j=0;j<stride;j++)mpq_swap(a[r*stride+j],a[rank*stride+j]);mpq_set(pivot,a[rank*stride+c]);for(int j=c;j<stride;j++)mpq_div(a[rank*stride+j],a[rank*stride+j],pivot);
  for(int i=0;i<rows;i++)if(i!=rank&&mpq_sgn(a[i*stride+c])){mpq_set(factor,a[i*stride+c]);for(int j=c;j<stride;j++){mpq_mul(temp,factor,a[rank*stride+j]);mpq_sub(a[i*stride+j],a[i*stride+j],temp);}}rank++;}
 for(int i=0;i<rows;i++){int nonzero=0;for(int j=0;j<cols;j++)if(mpq_sgn(a[i*stride+j]))nonzero=1;if(!nonzero&&mpq_sgn(a[i*stride+cols]))result=-1;}if(result==1&&rank<cols)result=0;
 if(result==1)for(int c=0;c<cols;c++)mpq_set(out[c],a[c*stride+cols]);mpq_clears(pivot,factor,temp,NULL);rational_free(a,rows*stride);return result;
}
static mpz_srcptr incoming(const Node *v,int source){for(int i=0;i<v->incoming_count;i++)if(v->incoming[i].source==source)return v->incoming[i].count;return NULL;}
/* The algorithm is restricted to seen[] and receives no n, fibers or IDs. */
static void run_audit(const Node *nodes,int node_count,const unsigned char *seen,int ell,int m,int k,Audit *a){
 audit_reset(a);a->candidate=m;a->k=k;a->status=1;a->reason="leader_missing";int leader=0;for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level==0&&nodes[i].leader)leader=1;if(!leader)return;
 int *sizes=alloc((size_t)k+1,sizeof(int)),*children=alloc((size_t)node_count,sizeof(int));mpz_t *b=NULL;mpz_t total,left,right,tmp;mpz_inits(total,left,right,tmp,NULL);
 for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level>=0&&nodes[i].level<=k){sizes[nodes[i].level]++;if(nodes[i].level>0&&nodes[i].parent>=0)children[nodes[i].parent]++;}
 for(int r=0;r<=k;r++)if(sizes[r]>m){a->reason="node_limit";goto done;}
 for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level>=0&&nodes[i].level<k&&!children[i]){a->reason="missing_child";goto done;}
 for(int r=1;r<=k;r++){int flat=1;for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level==r-1&&children[i]!=1){flat=0;break;}if(flat&&sizes[r-1])a->anchor=r;}
 if(!a->anchor){a->reason="no_flat";goto done;}
 a->cols=sizes[a->anchor];a->rows=sizes[a->anchor-1]+1;a->columns=alloc((size_t)a->cols,sizeof(int));int col=0;for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level==a->anchor)a->columns[col++]=i;
 a->equations=rationals(a->rows*(a->cols+1));a->solution=rationals(a->cols);int row=0,stride=a->cols+1;
 for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level==a->anchor-1){for(int c=0;c<a->cols;c++){const Node *v=&nodes[a->columns[c]];mpz_srcptr mu=incoming(v,i);if(mu)mpz_set(tmp,mu);else mpz_set_ui(tmp,0);if(v->parent==i)mpz_sub(tmp,tmp,v->degree);mpq_set_z(a->equations[row*stride+c],tmp);}row++;}
 for(int c=0;c<a->cols;c++)if(nodes[a->columns[c]].leader)mpq_set_ui(a->equations[row*stride+c],1,1);mpq_set_ui(a->equations[row*stride+a->cols],(unsigned long)ell,1);
 int unique=solve((const mpq_t*)a->equations,a->rows,a->cols,a->solution);if(unique<0){a->reason="inconsistent";goto done;}if(!unique){a->reason="non_unique";goto done;}a->solved=1;
#ifndef COUNTING_MUTATE_INTEGRALITY
 for(int c=0;c<a->cols;c++)if(mpz_cmp_ui(mpq_denref(a->solution[c]),1)){a->reason="non_integer";goto done;}
#endif
 for(int c=0;c<a->cols;c++)if(mpq_sgn(a->solution[c])<=0){a->reason="non_positive";goto done;}
 for(int c=0;c<a->cols;c++)mpz_add(total,total,mpq_numref(a->solution[c]));if(mpz_cmp_ui(total,(unsigned long)m)){a->reason="wrong_total";goto done;}
 b=alloc((size_t)node_count,sizeof(mpz_t));for(int i=0;i<node_count;i++)mpz_init(b[i]);for(int c=0;c<a->cols;c++)mpz_set(b[a->columns[c]],mpq_numref(a->solution[c]));
 /* Accumulate each child's value once. Nodes are stored after their parents,
  * so reverse ID order is a topological order even after structural sharing. */
 for(int j=node_count-1;j>=0;j--)if(seen[j]&&nodes[j].level>=0&&nodes[j].level<=a->anchor&&nodes[j].parent>=0)mpz_add(b[nodes[j].parent],b[nodes[j].parent],b[j]);
 mpz_t *balance=alloc((size_t)node_count,sizeof(mpz_t));for(int i=0;i<node_count;i++)mpz_init(balance[i]);
 for(int j=0;j<node_count;j++)if(seen[j]&&nodes[j].level>=1&&nodes[j].level<a->anchor){
  for(int z=0;z<nodes[j].incoming_count;z++){const Message *msg=&nodes[j].incoming[z];mpz_addmul(balance[msg->source],msg->count,b[j]);}
  mpz_submul(balance[nodes[j].parent],nodes[j].degree,b[j]);
 }
 int flow_ok=1;for(int i=0;i<node_count;i++){if(seen[i]&&nodes[i].level>=0&&nodes[i].level<a->anchor-1&&mpz_sgn(balance[i]))flow_ok=0;mpz_clear(balance[i]);}free(balance);
 if(!flow_ok){a->reason="backward_flow";goto done;}
 a->descendants=alloc((size_t)a->cols,sizeof(int));for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level==k){int ancestor=i;while(nodes[ancestor].level>a->anchor)ancestor=nodes[ancestor].parent;for(int c=0;c<a->cols;c++)if(a->columns[c]==ancestor){a->descendants[c]++;break;}}
#ifndef COUNTING_MUTATE_SUFFIX
 for(int c=0;c<a->cols;c++)if(mpz_cmp_ui(b[a->columns[c]],(unsigned long)a->descendants[c])<0){a->reason="suffix";goto done;}
#endif
 a->reason="accepted";a->status=2;
done:if(b){for(int i=0;i<node_count;i++)mpz_clear(b[i]);free(b);}mpz_clears(total,left,right,tmp,NULL);free(sizes);free(children);
}
static void decision(const Node *nodes,int node_count,int ell,int sharp,int round,AuditCache **cache,int *cache_count,Agent *a){
 audit_reset(&a->audit);unsigned char *seen=visible(nodes,node_count,a->bottom);int t=round;
 if(sharp&&t==ell){int nonleader=0;for(int i=0;i<node_count;i++)if(seen[i]&&nodes[i].level==0&&!nodes[i].leader)nonleader=1;a->audit.candidate=ell;a->audit.k=0;a->audit.status=nonleader?1:2;a->audit.reason=nonleader?"nonleader_visible":"all_leaders";}
 else{int m=0,k=0;if(!sharp){if(t%2){m=(t+1)/2;k=m;if(m<ell)m=0;}}else if(ell==1){if(t%2){m=(t+1)/2;k=m;if(m<=ell)m=0;}}else if(t%2==0){m=t/2+1;k=m-1;if(m<=ell)m=0;}
  if(m){
   /* Memoize only identical locally observed prefixes, compared exactly. No
    * population, true anonymity or global exhaustiveness enters the key. */
   unsigned char *prefix=alloc((size_t)node_count,1);for(int i=0;i<node_count;i++)prefix[i]=(unsigned char)(seen[i]&&nodes[i].level<=k);
   int hit=-1;for(int i=0;i<(*cache_count);i++)if((*cache)[i].candidate==m&&(*cache)[i].k==k&&!memcmp(prefix,(*cache)[i].prefix,(size_t)node_count)){hit=i;break;}
   if(hit>=0){audit_copy(&a->audit,&(*cache)[hit].audit);free(prefix);}
   else{run_audit(nodes,node_count,seen,ell,m,k,&a->audit);(*cache)=realloc((*cache),(size_t)((*cache_count)+1)*sizeof(AuditCache));if(!(*cache))abort();AuditCache *entry=&(*cache)[(*cache_count)++];memset(entry,0,sizeof(*entry));entry->prefix=prefix;entry->candidate=m;entry->k=k;audit_copy(&entry->audit,&a->audit);}
  }
 }
 free(seen);if(a->audit.status==2){a->halted=1;a->output=a->audit.candidate;}
}
int sim_step(Sim *s){
 if(!s){error("null simulation");return -1;}if(s->complete)return 0;int graph=s->round;if(graph>=s->graph_count){if(!s->repeat_last){error("scenario has no graph for the next round");return -1;}graph=s->graph_count-1;}Graph *g=&s->graphs[graph];int *next=alloc((size_t)s->n,sizeof(int));
 /* All messages use old states; outdegree is learned only after send. */
 for(int a=0;a<s->n;a++){next[a]=s->agents[a].bottom;if(s->agents[a].halted)continue;Message *msg=alloc((size_t)g->count,sizeof(Message));int count=0;mpz_t degree;mpz_init(degree);
  for(int e=0;e<g->count;e++){Edge *edge=&g->edges[e];if(edge->source==a)mpz_add(degree,degree,edge->count);if(edge->target==a&&!s->agents[edge->source].halted){msg[count].source=s->agents[edge->source].bottom;mpz_init_set(msg[count].count,edge->count);
#ifdef COUNTING_MUTATE_MULTIPLICITY
   mpz_set_ui(msg[count].count,1);
#endif
   count++;}}
  qsort(msg,(size_t)count,sizeof(Message),message_compare);int compact=0;for(int i=0;i<count;i++){if(compact&&msg[compact-1].source==msg[i].source)mpz_add(msg[compact-1].count,msg[compact-1].count,msg[i].count);else{if(compact!=i){msg[compact].source=msg[i].source;mpz_swap(msg[compact].count,msg[i].count);}compact++;}}
  next[a]=intern(s,s->round+1,s->agents[a].bottom,s->agents[a].leader,degree,msg,compact);for(int i=0;i<count;i++)mpz_clear(msg[i].count);free(msg);mpz_clear(degree);}
 s->round++;for(int a=0;a<s->n;a++)if(!s->agents[a].halted){s->agents[a].bottom=next[a];fiber_add(s,next[a],a);}
 /* Decisions have no access to other agents' current halt flags. */
 int halted=0;for(int a=0;a<s->n;a++){if(!s->agents[a].halted)decision(s->nodes,s->node_count,s->ell,s->sharp,s->round,&s->cache,&s->cache_count,&s->agents[a]);halted+=s->agents[a].halted;}s->complete=halted==s->n;cache_clear(s);free(next);return 1;
}
static void zjson(Buffer *b,mpz_srcptr z){char *p=mpz_get_str(NULL,10,z);bstring(b,p);free(p);}
static void qjson(Buffer *b,mpq_srcptr q){char *p=mpq_get_str(NULL,10,q);bstring(b,p);free(p);}
static void nullable(Buffer *b,int n,int valid){if(valid)bprintf(b,"%d",n);else bput(b,"null");}
static void audit_json(Buffer *b,const Audit *a){
 bput(b,"{\"candidate\":");nullable(b,a->candidate,a->candidate>0);bput(b,",\"final_level\":");nullable(b,a->k,a->candidate>0);bput(b,",\"anchor\":");nullable(b,a->anchor,a->anchor>0);
 bput(b,",\"status\":");bstring(b,a->status==2?"accepted":a->status==1?"rejected":"idle");bput(b,",\"reason\":");bstring(b,a->reason?a->reason:"waiting");bput(b,",\"solution\":[");
 if(a->solved)for(int i=0;i<a->cols;i++){if(i)bput(b,",");bprintf(b,"{\"node\":%d,\"value\":",a->columns[i]);qjson(b,a->solution[i]);bput(b,"}");}bput(b,"],\"equations\":[");
 for(int r=0;r<a->rows;r++){if(r)bput(b,",");bput(b,"{\"terms\":[");int terms=0;for(int c=0;c<a->cols;c++)if(mpq_sgn(a->equations[r*(a->cols+1)+c])){if(terms++)bput(b,",");bprintf(b,"{\"node\":%d,\"coefficient\":",a->columns[c]);qjson(b,a->equations[r*(a->cols+1)+c]);bput(b,"}");}bput(b,"],\"rhs\":");qjson(b,a->equations[r*(a->cols+1)+a->cols]);bput(b,"}");}
 bput(b,"],\"descendants\":[");if(a->descendants)for(int c=0;c<a->cols;c++){if(c)bput(b,",");bprintf(b,"{\"node\":%d,\"count\":%d}",a->columns[c],a->descendants[c]);}bput(b,"]}");
}
char *sim_snapshot(const Sim *s){
 if(!s){error("null simulation");return NULL;}Buffer b;binit(&b);bprintf(&b,"{\"schema_version\":1,\"round\":%d,\"complete\":%s,\"variant\":\"%s\",\"n\":%d,\"ell\":%d,\"agents\":[",s->round,s->complete?"true":"false",s->sharp?"sharp":"core",s->n,s->ell);
 for(int a=0;a<s->n;a++){const Agent *v=&s->agents[a];if(a)bput(&b,",");bprintf(&b,"{\"id\":%d,\"leader\":%s,\"bottom\":%d,\"halted\":%s,\"output\":",a,v->leader?"true":"false",v->bottom,v->halted?"true":"false");nullable(&b,v->output,v->halted);bput(&b,",\"visible_nodes\":[");unsigned char *seen=visible(s->nodes,s->node_count,v->bottom);int n=0;for(int i=0;i<s->node_count;i++)if(seen[i]){if(n++)bput(&b,",");bprintf(&b,"%d",i);}free(seen);bput(&b,"],\"audit\":");audit_json(&b,&v->audit);bput(&b,"}");}
 bput(&b,"],\"nodes\":[");for(int i=0;i<s->node_count;i++){const Node *v=&s->nodes[i];if(i)bput(&b,",");bprintf(&b,"{\"id\":%d,\"level\":%d,\"leader\":%s,\"parent\":",i,v->level,v->leader?"true":"false");nullable(&b,v->parent,v->parent>=0);bput(&b,",\"outdegree\":");zjson(&b,v->degree);bput(&b,",\"incoming\":[");for(int j=0;j<v->incoming_count;j++){if(j)bput(&b,",");bprintf(&b,"{\"source\":%d,\"multiplicity\":",v->incoming[j].source);zjson(&b,v->incoming[j].count);bput(&b,"}");}bput(&b,"],\"fiber\":[");for(int j=0;j<s->fibers[i].count;j++){if(j)bput(&b,",");bprintf(&b,"%d",s->fibers[i].agents[j]);}bput(&b,"]}");}
 bput(&b,"],\"graph\":");if(!s->round)bput(&b,"null");else{int idx=s->round-1;if(idx>=s->graph_count)idx=s->graph_count-1;const Graph *g=&s->graphs[idx];bput(&b,"{\"edges\":[");for(int i=0;i<g->count;i++){if(i)bput(&b,",");bprintf(&b,"{\"source\":%d,\"target\":%d,\"multiplicity\":",g->edges[i].source,g->edges[i].target);zjson(&b,g->edges[i].count);bput(&b,"}");}bput(&b,"]}");}bput(&b,"}");return btake(&b);
}
int sim_default_horizon(const Sim *s){return s?(s->repeat_last?2*s->n-1:s->graph_count):0;}
int sim_available_horizon(const Sim *s){return s?(s->repeat_last?INT_MAX:s->graph_count):0;}
char *sim_summary(const Sim *s){
 if(!s)return NULL;int expected=s->sharp?(s->n==s->ell?s->n:s->ell==1?2*s->n-1:2*s->n-2):2*s->n-1;const char *kind=NULL;int halted=0;
 for(int i=0;i<s->n;i++){const Agent *a=&s->agents[i];halted+=a->halted;if(a->halted&&a->output!=s->n)kind="wrong_output";}
 if(!kind&&halted&&halted!=s->n)kind="asynchronous_halt";if(!kind&&halted&&s->round<expected)kind="early_halt";if(!kind&&s->round>=expected&&!s->complete)kind="late_halt";
 Buffer b;binit(&b);bprintf(&b,"{\"schema_version\":1,\"engine_version\":\"1.0.0\",\"status\":\"%s\",\"termination_round\":",kind?"error":s->complete?"complete":"incomplete");nullable(&b,s->round,s->complete);bprintf(&b,",\"rounds_executed\":%d,\"n\":%d,\"ell\":%d,\"variant\":\"%s\",\"outputs\":[",s->round,s->n,s->ell,s->sharp?"sharp":"core");for(int i=0;i<s->n;i++){if(i)bput(&b,",");nullable(&b,s->agents[i].output,s->agents[i].halted);}bput(&b,"],\"failure\":");if(kind){bput(&b,"{\"kind\":");bstring(&b,kind);bput(&b,",\"message\":\"Execution contradicts the paper's output or termination specification.\"}");}else bput(&b,"null");bput(&b,"}");return btake(&b);
}
char *sim_audit_json(const char *input){
 last_error[0]=0;JVal *json=jparse(input,last_error,sizeof(last_error));if(!json)return NULL;Sim *s=alloc(1,sizeof(*s));Audit a={0};int m=0,k=0,ell=0,version=0;char *result=NULL;
 if(!get_int(json,"schema_version",&version)||version!=1||!get_int(json,"candidate",&m)||m<1||!get_int(json,"final_level",&k)||k<1||k>4096||!get_int(json,"ell",&ell)||ell<1){error("invalid audit parameters");goto done;}
 const JVal *list=jget(json,"nodes"),*mask=jget(json,"visible_nodes");if(!list||list->type!=J_ARRAY||!list->len||list->len>100000||!mask||mask->type!=J_ARRAY){error("audit needs nodes and visible_nodes arrays");goto done;}
 s->node_count=(int)list->len;s->nodes=alloc(list->len,sizeof(Node));for(int i=0;i<s->node_count;i++)mpz_init(s->nodes[i].degree);
 for(int i=0;i<s->node_count;i++){const JVal *v=list->items[i];Node *node=&s->nodes[i];int id,level;if(!get_int(v,"id",&id)||id!=i){error("audit node IDs must be contiguous and ordered");goto done;}
  const JVal *lv=jget(v,"level");if(i==0&&lv&&lv->type==J_NUMBER&&!strcmp(lv->text,"-1"))level=-1;else if(!jint(lv,&level)||level>4096){error("invalid audit level");goto done;}node->id=i;node->level=level;const JVal *parent=jget(v,"parent");
  if(i==0&&parent&&parent->type==J_NULL&&level==-1)node->parent=-1;else if(!jint(parent,&node->parent)||node->parent>=i||s->nodes[node->parent].level!=level-1){error("audit parent must precede child at previous level");goto done;}
  const JVal *leader=jget(v,"leader");if(!leader||leader->type!=J_BOOL){error("invalid audit leader status");goto done;}node->leader=!strcmp(leader->text,"true");if(!decimal(node->degree,jget(v,"outdegree"),0))goto done;
  const JVal *in=jget(v,"incoming");if(!in||in->type!=J_ARRAY||in->len>100000){error("audit incoming must be an array");goto done;}node->incoming_count=(int)in->len;node->incoming=alloc(in->len,sizeof(Message));for(int j=0;j<node->incoming_count;j++)mpz_init(node->incoming[j].count);
  for(int j=0;j<node->incoming_count;j++){Message *msg=&node->incoming[j];if(!get_int(in->items[j],"source",&msg->source)||msg->source>=i||s->nodes[msg->source].level!=level-1||!decimal(msg->count,jget(in->items[j],"multiplicity"),1)){error("invalid audit incoming edge");goto done;}for(int z=0;z<j;z++)if(node->incoming[z].source==msg->source){error("duplicate audit incoming source");goto done;}}}
 unsigned char *seen=alloc((size_t)s->node_count,1);for(size_t i=0;i<mask->len;i++){int id;if(!jint(mask->items[i],&id)||id>=s->node_count){free(seen);error("invalid visible node ID");goto done;}seen[id]=1;}
 for(int i=0;i<s->node_count;i++)if(seen[i]){if(s->nodes[i].parent>=0&&!seen[s->nodes[i].parent]){free(seen);error("vista not closed under parents");goto done;}for(int j=0;j<s->nodes[i].incoming_count;j++)if(!seen[s->nodes[i].incoming[j].source]){free(seen);error("vista not closed under received histories");goto done;}}
 run_audit(s->nodes,s->node_count,seen,ell,m,k,&a);free(seen);Buffer b;binit(&b);audit_json(&b,&a);result=btake(&b);
done:audit_reset(&a);jfree(json);sim_destroy(s);return result;
}
