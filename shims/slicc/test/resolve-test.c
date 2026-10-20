/*
 * getaddrinfo through slicc_socket.c, as curl and git use it:
 *   resolve-test NAME [PORT [MESSAGE]]
 * (NAME --self: this machine's gethostname()) prints every address, then (with PORT) connects to the first, sends
 * MESSAGE, and prints what comes back until the peer closes.
 *   resolve-test --confirm ADDR
 * is a daemon's forward check (rsync's client_name): ADDR's name (NI_NAMEREQD), kept only when looking that name up
 * gives ADDR back; prints "ADDR NAME", or "ADDR UNKNOWN" and why.
 * Exit 2 when the name does not resolve (gai_strerror on stderr).
 */
#include <arpa/inet.h>
#include <netdb.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: resolve-test NAME [PORT [MESSAGE]]\n");
    return 64;
  }
  if (strcmp(argv[1], "--confirm") == 0 && argc == 3) {
    struct sockaddr_in sin = {.sin_family = AF_INET};
    char host[256];
    if (inet_pton(AF_INET, argv[2], &sin.sin_addr) != 1) return 64;
    if (getnameinfo((struct sockaddr *)&sin, sizeof sin, host, sizeof host, NULL, 0, NI_NAMEREQD) != 0) {
      printf("%s UNKNOWN (no name)\n", argv[2]);
      return 0;
    }
    struct addrinfo hints = {.ai_family = AF_INET, .ai_socktype = SOCK_STREAM}, *res, *ai;
    if (getaddrinfo(host, NULL, &hints, &res) != 0) {
      printf("%s UNKNOWN (%s does not resolve)\n", argv[2], host);
      return 0;
    }
    int match = 0;
    for (ai = res; ai; ai = ai->ai_next)
      match |= ((struct sockaddr_in *)ai->ai_addr)->sin_addr.s_addr == sin.sin_addr.s_addr;
    freeaddrinfo(res);
    if (match) printf("%s %s\n", argv[2], host);
    else printf("%s UNKNOWN (%s is elsewhere)\n", argv[2], host);
    return 0;
  }
  char self[256];
  if (strcmp(argv[1], "--self") == 0) {
    if (gethostname(self, sizeof self) != 0) {
      perror("resolve-test: gethostname");
      return 3;
    }
    self[sizeof self - 1] = '\0';
    argv[1] = self;
  }
  struct addrinfo hints = {.ai_family = AF_UNSPEC, .ai_socktype = SOCK_STREAM}, *res, *ai;
  int r = getaddrinfo(argv[1], argc > 2 ? argv[2] : NULL, &hints, &res);
  if (r != 0) {
    fprintf(stderr, "resolve-test: %s: %s (%d)\n", argv[1], gai_strerror(r), r);
    return 2;
  }
  for (ai = res; ai; ai = ai->ai_next) {
    char buf[INET_ADDRSTRLEN];
    struct sockaddr_in *sin = (struct sockaddr_in *)ai->ai_addr;
    printf("%s\n", inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof buf));
  }
  if (argc > 2) {
    int fd = socket(res->ai_family, SOCK_STREAM, 0);
    if (fd < 0 || connect(fd, res->ai_addr, res->ai_addrlen) != 0) {
      perror("resolve-test: connect");
      return 3;
    }
    const char *msg = argc > 3 ? argv[3] : "ping";
    if (write(fd, msg, strlen(msg)) < 0 || shutdown(fd, SHUT_WR) != 0) {
      perror("resolve-test: write");
      return 3;
    }
    char buf[256];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf)) > 0) fwrite(buf, 1, (size_t)n, stdout);
    close(fd);
  }
  freeaddrinfo(res);
  return 0;
}
