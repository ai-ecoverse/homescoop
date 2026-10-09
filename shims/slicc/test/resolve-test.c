/*
 * getaddrinfo through slicc_socket.c, as curl and git use it:
 *   resolve-test NAME [PORT [MESSAGE]]
 * prints every address, then (with PORT) connects to the first, sends
 * MESSAGE, and prints what comes back until the peer closes.
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
