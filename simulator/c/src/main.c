#include "counting.h"
#include "json.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static char *read_input(const char *path){FILE *f=!strcmp(path,"-")?stdin:fopen(path,"rb");if(!f){perror(path);return NULL;}Buffer b;binit(&b);char chunk[8192];size_t n;while((n=fread(chunk,1,sizeof(chunk)-1,f))){if(memchr(chunk,0,n)){free(b.data);if(f!=stdin)fclose(f);return NULL;}chunk[n]=0;bput(&b,chunk);}int failed=ferror(f);if(f!=stdin)fclose(f);if(failed){free(b.data);return NULL;}return btake(&b);}
static int output_error(const char *message){Buffer b;binit(&b);bput(&b,"{\"schema_version\":1,\"status\":\"error\",\"error\":");bstring(&b,message);bput(&b,"}");puts(b.data);fprintf(stderr,"%s\n",message);free(b.data);return 1;}
int main(int argc,char **argv){
 if(argc<3){fprintf(stderr,"Usage: counting run|replay SCENARIO.json [--trace|--summary] [--max-rounds N]\n       counting audit VISTA.json\n");return 1;}
 char *input=read_input(argv[2]);if(!input)return output_error("Cannot read input, or input contains an embedded NUL byte");if(!strcmp(argv[1],"audit")){char *audit=sim_audit_json(input);free(input);if(!audit)return output_error(sim_last_error());puts(audit);sim_free_string(audit);return 0;}
 if(strcmp(argv[1],"run")&&strcmp(argv[1],"replay")){free(input);return output_error("unknown command");}int trace=1,max_rounds=-1;
 for(int i=3;i<argc;i++){if(!strcmp(argv[i],"--summary"))trace=0;else if(!strcmp(argv[i],"--trace"))trace=1;else if(!strcmp(argv[i],"--max-rounds")&&i+1<argc){char *end;long v=strtol(argv[++i],&end,10);if(*end||v<0||v>1000000){free(input);return output_error("invalid --max-rounds");}max_rounds=(int)v;}else{free(input);return output_error("unknown option");}}
 Sim *s=sim_create(input);free(input);if(!s)return output_error(sim_last_error());if(max_rounds<0)max_rounds=sim_default_horizon(s);if(max_rounds>sim_available_horizon(s))max_rounds=sim_available_horizon(s);Buffer snapshots;binit(&snapshots);
 if(trace){char *snap=sim_snapshot(s);bput(&snapshots,snap);sim_free_string(snap);}int done=0;
 for(int r=0;r<max_rounds&&!done;r++){int ret=sim_step(s);if(ret<0){free(snapshots.data);sim_destroy(s);return output_error(sim_last_error());}if(trace&&ret){char *snap=sim_snapshot(s);bput(&snapshots,",");bput(&snapshots,snap);sim_free_string(snap);}char *summary=sim_summary(s);done=strstr(summary,"\"status\":\"complete\"")!=NULL||strstr(summary,"\"status\":\"error\"")!=NULL;sim_free_string(summary);if(!ret)done=1;}
 char *summary=sim_summary(s);int exit_status=strstr(summary,"\"status\":\"error\"")?1:strstr(summary,"\"status\":\"incomplete\"")?2:0;if(trace){summary[strlen(summary)-1]=0;printf("%s,\"snapshots\":[%s]}\n",summary,snapshots.data?snapshots.data:"");}else puts(summary);
 sim_free_string(summary);free(snapshots.data);sim_destroy(s);return exit_status;
}
