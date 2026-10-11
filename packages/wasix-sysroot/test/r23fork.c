#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static _Thread_local int main_tl = 10;

static void report(pid_t p) {
  int st = 0;
  pid_t w = waitpid(p, &st, 0);
  if (w != p) printf("wait: %d\n", (int)w);
  else if (WIFEXITED(st)) printf("parent: child exit=%d\n", WEXITSTATUS(st));
  else printf("parent: child signal=%d\n", WTERMSIG(st));
}

static int plain(void) {
  main_tl++;
  pid_t parent = getpid();
  pid_t p = fork();
  if (p < 0) { printf("fork: -1 %s\n", strerror(errno)); return 1; }
  if (p == 0) {
    printf("child: tl=%d own_pid=%d\n", main_tl, getpid() != parent);
    _exit(7);
  }
  report(p);
  printf("parent: tl=%d\n", main_tl);
  pid_t q = _Fork(1);
  if (q == 0) _exit(9);
  report(q);
  return 0;
}

#ifdef __PIC__
#include <dlfcn.h>

static int dl(const char *path) {
  void *h = dlopen(path, RTLD_NOW);
  if (!h) { printf("dlopen: %s\n", dlerror()); return 1; }
  int (*add)(int, int) = (int (*)(int, int))dlsym(h, "side_add");
  int (*bump)(void) = (int (*)(void))dlsym(h, "side_bump");
  int b = bump();
  printf("parent: add=%d bump=%d\n", add(2, 3), b);
  pid_t p = fork();
  if (p < 0) { printf("fork: -1 %s\n", strerror(errno)); return 1; }
  if (p == 0) {
    int c = bump();
    printf("child: add=%d bump=%d\n", add(2, 3), c);
    _exit(7);
  }
  report(p);
  printf("parent: add=%d\n", add(2, 3));
  return 0;
}
#endif

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
#ifdef __PIC__
  if (argc > 2 && !strcmp(argv[1], "dl")) return dl(argv[2]);
#endif
  return plain();
}
