#ifndef COUNTING_H
#define COUNTING_H
typedef struct Sim Sim;
/* Returned JSON strings are owned by the caller; release with sim_free_string. */
Sim *sim_create(const char *scenario_json);
int sim_step(Sim *sim);
char *sim_snapshot(const Sim *sim);
char *sim_summary(const Sim *sim);
char *sim_audit_json(const char *input);
const char *sim_last_error(void);
void sim_free_string(char *text);
void sim_destroy(Sim *sim);
int sim_default_horizon(const Sim *sim);
int sim_available_horizon(const Sim *sim);
#endif
