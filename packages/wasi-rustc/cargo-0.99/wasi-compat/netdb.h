#ifndef SLICC_WASI_NETDB_H
#define SLICC_WASI_NETDB_H
/* WASI preview1 has no resolver; libgit2's git:// stream is never reached. */
#include <sys/socket.h>
#include <netinet/in.h>
struct addrinfo { int ai_flags, ai_family, ai_socktype, ai_protocol; socklen_t ai_addrlen; struct sockaddr *ai_addr; char *ai_canonname; struct addrinfo *ai_next; };
#define EAI_FAIL (-4)
#define AI_PASSIVE 1
#define AI_NUMERICHOST 4
static inline int getaddrinfo(const char *n, const char *s, const struct addrinfo *h, struct addrinfo **r) { (void)n;(void)s;(void)h; *r = 0; return EAI_FAIL; }
static inline void freeaddrinfo(struct addrinfo *a) { (void)a; }
static inline const char *gai_strerror(int e) { (void)e; return "name resolution is not supported on WASI"; }
#endif
