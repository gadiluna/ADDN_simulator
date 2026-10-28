#ifndef COUNTING_JSON_H
#define COUNTING_JSON_H
#include <stddef.h>
typedef enum { J_NULL, J_BOOL, J_NUMBER, J_STRING, J_ARRAY, J_OBJECT } JType;
typedef struct JVal { JType type; char *text; struct JVal **items; size_t len; } JVal;
JVal *jparse(const char *input, char *error, size_t error_size);
void jfree(JVal *value);
const JVal *jget(const JVal *object, const char *key);
int jint(const JVal *value, int *result);
typedef struct { char *data; size_t len, cap; } Buffer;
void binit(Buffer *buffer);
void bput(Buffer *buffer, const char *text);
void bprintf(Buffer *buffer, const char *format, ...);
void bstring(Buffer *buffer, const char *text);
char *btake(Buffer *buffer);
#endif
