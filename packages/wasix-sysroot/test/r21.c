// wasix-sysroot 2025.9.30-21 probe: terminals per descriptor through
// slicc-kernel's slicc_tty (homescoop #247 raw mode, #279 TIOCGWINSZ).
// `r21 pipes`: run with stdin/stdout on pipes; a file and a pipe are no tty.
// `r21 tty`: run in a pty; cfmakeraw is really raw (^C arrives as byte 3,
// no SIGINT), and the saved termios restores. One line per result.
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

static volatile sig_atomic_t sigints;
static void on_int(int sig) { (void)sig; sigints++; }

static const char *err(int r) { return r == 0 ? "ok" : errno == ENOTTY ? "ENOTTY" : errno == EBADF ? "EBADF" : strerror(errno); }

static void notty(const char *label, int fd) {
  struct winsize ws;
  struct termios t;
  errno = 0;
  int a = ioctl(fd, TIOCGWINSZ, &ws);
  const char *ea = err(a);
  errno = 0;
  int b = tcgetattr(fd, &t);
  const char *eb = err(b);
  errno = 0;
  int c = isatty(fd);
  printf("%s: winsize=%s tcgetattr=%s isatty=%d errno=%s\n", label, ea, eb, c, c ? "-" : errno == ENOTTY ? "ENOTTY" : strerror(errno));
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && !strcmp(argv[1], "pipes")) {
    notty("stdin pipe", 0);
    notty("stdout pipe", 1);
    int f = open("/tmp/r21-file", O_CREAT | O_RDWR | O_TRUNC, 0644);
    notty("file", f);
    close(f);
    notty("closed", f);
    printf("r21 pipes done\n");
    return 0;
  }
  // tty
  struct winsize ws;
  int w = ioctl(0, TIOCGWINSZ, &ws);
  printf("tty: isatty=%d,%d winsize=%s %dx%d\n", isatty(0), isatty(1), err(w), ws.ws_col, ws.ws_row);
  struct termios saved, raw, back;
  tcgetattr(0, &saved);
  printf("cooked: ICANON=%d ECHO=%d ISIG=%d OPOST=%d\n", !!(saved.c_lflag & ICANON), !!(saved.c_lflag & ECHO),
         !!(saved.c_lflag & ISIG), !!(saved.c_oflag & OPOST));
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = on_int;
  sigaction(SIGINT, &sa, NULL);
  raw = saved;
  cfmakeraw(&raw);
  raw.c_cc[VMIN] = 1;
  raw.c_cc[VTIME] = 0;
  int s = tcsetattr(0, TCSANOW, &raw);
  tcgetattr(0, &back);
  printf("raw: set=%s ICANON=%d ECHO=%d ISIG=%d IEXTEN=%d OPOST=%d ICRNL=%d VMIN=%d\r\n", err(s), !!(back.c_lflag & ICANON),
         !!(back.c_lflag & ECHO), !!(back.c_lflag & ISIG), !!(back.c_lflag & IEXTEN), !!(back.c_oflag & OPOST),
         !!(back.c_iflag & ICRNL), back.c_cc[VMIN]);
  printf("ready\r\n");
  unsigned char c[2] = {0, 0};
  ssize_t n = read(0, c, 1);
  ssize_t m = read(0, c + 1, 1);
  printf("read: n=%zd,%zd bytes=%d,%d sigints=%d\r\n", n, m, c[0], c[1], (int)sigints);
  tcsetattr(0, TCSAFLUSH, &saved);
  tcgetattr(0, &back);
  printf("restored: ICANON=%d ECHO=%d ISIG=%d OPOST=%d\n", !!(back.c_lflag & ICANON), !!(back.c_lflag & ECHO),
         !!(back.c_lflag & ISIG), !!(back.c_oflag & OPOST));
  int fl = tcflush(0, TCIFLUSH), dr = tcdrain(1);
  printf("flush=%d drain=%d\n", fl, dr);
  printf("r21 tty done\n");
  return 0;
}
