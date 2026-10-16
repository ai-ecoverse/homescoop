/*
 * getnameinfo / gethostbyaddr through slicc_socket.c (homescoop#176):
 *   nameinfo-test ADDR [PORT [FLAG...]]   FLAG: numerichost namereqd numericserv dgram nodelen=N servlen=N
 *   nameinfo-test --hostbyaddr ADDR
 * prints "NODE SERV" (or h_name); exit 2 with gai_strerror (h_errno) on stderr.
 */
#include <arpa/inet.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: nameinfo-test ADDR [PORT [FLAG...]] | --hostbyaddr ADDR\n");
    return 64;
  }
  if (strcmp(argv[1], "--hostbyaddr") == 0 && argc > 2) {
    struct in_addr in;
    if (inet_pton(AF_INET, argv[2], &in) != 1) return 64;
    struct hostent *h = gethostbyaddr(&in, sizeof in, AF_INET);
    if (!h) {
      fprintf(stderr, "nameinfo-test: gethostbyaddr %s: h_errno %d\n", argv[2], h_errno);
      return 2;
    }
    printf("%s\n", h->h_name);
    return 0;
  }
  struct sockaddr_storage ss;
  socklen_t sl;
  int port = argc > 2 ? atoi(argv[2]) : 0;
  memset(&ss, 0, sizeof ss);
  if (strchr(argv[1], ':')) {
    struct sockaddr_in6 *s6 = (struct sockaddr_in6 *)&ss;
    s6->sin6_family = AF_INET6;
    s6->sin6_port = htons((unsigned short)port);
    if (inet_pton(AF_INET6, argv[1], &s6->sin6_addr) != 1) return 64;
    sl = sizeof *s6;
  } else {
    struct sockaddr_in *s4 = (struct sockaddr_in *)&ss;
    s4->sin_family = AF_INET;
    s4->sin_port = htons((unsigned short)port);
    if (inet_pton(AF_INET, argv[1], &s4->sin_addr) != 1) return 64;
    sl = sizeof *s4;
  }
  int flags = 0;
  socklen_t nodelen = NI_MAXHOST, servlen = NI_MAXSERV;
  for (int i = 3; i < argc; i++) {
    if (strcmp(argv[i], "numerichost") == 0) flags |= NI_NUMERICHOST;
    else if (strcmp(argv[i], "namereqd") == 0) flags |= NI_NAMEREQD;
    else if (strcmp(argv[i], "numericserv") == 0) flags |= NI_NUMERICSERV;
    else if (strcmp(argv[i], "dgram") == 0) flags |= NI_DGRAM;
    else if (strncmp(argv[i], "nodelen=", 8) == 0) nodelen = (socklen_t)atoi(argv[i] + 8);
    else if (strncmp(argv[i], "servlen=", 8) == 0) servlen = (socklen_t)atoi(argv[i] + 8);
    else return 64;
  }
  char node[NI_MAXHOST], serv[NI_MAXSERV];
  int r = getnameinfo((struct sockaddr *)&ss, sl, node, nodelen, serv, servlen, flags);
  if (r != 0) {
    fprintf(stderr, "nameinfo-test: %s: %s (%d)\n", argv[1], gai_strerror(r), r);
    return 2;
  }
  printf("%s %s\n", node, serv);
  return 0;
}
