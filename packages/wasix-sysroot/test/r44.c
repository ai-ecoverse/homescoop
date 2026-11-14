#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>
#include <unistd.h>

#define L_TCSBRK 0x5409
#define L_TCFLSH 0x540B
#define L_TIOCEXCL 0x540C
#define L_TIOCNXCL 0x540D
#define L_TIOCOUTQ 0x5411
#define L_TIOCMGET 0x5415
#define L_TIOCMBIS 0x5416
#define L_TIOCMBIC 0x5417
#define L_TIOCMSET 0x5418
#define L_FIONREAD 0x541B
#define L_TCSBRKP 0x5425
#define L_TIOCSBRK 0x5427
#define L_TIOCCBRK 0x5428
#define L_TCGETS2 0x802C542Au
#define L_TCSETS2 0x402C542Bu
#define L_TCSETSW2 0x402C542Cu
#define L_TCSETSF2 0x402C542Du
#define L_TIOCM_DTR 0x002
#define L_TIOCM_RTS 0x004
#define L_TIOCM_CTS 0x020
#define L_TIOCM_CD 0x040
#define L_TIOCM_RI 0x080
#define L_TIOCM_DSR 0x100
#define L_CBAUD 0010017
#define L_BOTHER 0010000

struct termios2 {
  uint32_t c_iflag, c_oflag, c_cflag, c_lflag;
  uint8_t c_line;
  uint8_t c_cc[19];
  uint32_t c_ispeed, c_ospeed;
};

static const char *err(int r) {
  static char buf[32];
  if (r == 0) return "0";
  switch (errno) {
    case EINVAL: return "EINVAL";
    case ENOTTY: return "ENOTTY";
    case EBADF: return "EBADF";
    case EIO: return "EIO";
    case ENOSYS: return "ENOSYS";
    case EACCES: return "EACCES";
    default: snprintf(buf, sizeof buf, "errno %d", errno); return buf;
  }
}

static void lines(int m, char *out) {
  out[0] = 0;
  if (m & L_TIOCM_DTR) strcat(out, " dtr");
  if (m & L_TIOCM_RTS) strcat(out, " rts");
  if (m & L_TIOCM_CTS) strcat(out, " cts");
  if (m & L_TIOCM_DSR) strcat(out, " dsr");
  if (m & L_TIOCM_CD) strcat(out, " cd");
  if (m & L_TIOCM_RI) strcat(out, " ri");
  if (!out[0]) strcat(out, " none");
}

static void modem(int fd, const char *what) {
  int m = -1;
  int r = ioctl(fd, L_TIOCMGET, &m);
  char b[64];
  lines(m, b);
  if (r == 0) printf("%s: 0%s\n", what, b);
  else printf("%s: %s\n", what, err(r));
}

static int wait_bytes(int fd, int want) {
  for (int i = 0; i < 400; i++) {
    int n = -1;
    if (ioctl(fd, L_FIONREAD, &n) != 0) return -1;
    if (n >= want) return n;
    struct pollfd p = {.fd = fd, .events = POLLIN};
    poll(&p, 1, 10);
  }
  return -2;
}

static void pipes(void) {
  int p[2];
  if (pipe(p) != 0) { printf("pipe failed\n"); return; }
  int m = 0;
  printf("pipe TIOCMGET: %s\n", err(ioctl(p[0], L_TIOCMGET, &m)));
  int bits = L_TIOCM_DTR;
  printf("pipe TIOCMBIS: %s\n", err(ioctl(p[1], L_TIOCMBIS, &bits)));
  printf("pipe TIOCSBRK: %s\n", err(ioctl(p[1], L_TIOCSBRK)));
  printf("pipe TIOCEXCL: %s\n", err(ioctl(p[1], L_TIOCEXCL)));
  printf("pipe TIOCOUTQ: %s\n", err(ioctl(p[1], L_TIOCOUTQ, &m)));
  printf("pipe TCSBRK 1: %s\n", err(ioctl(p[1], L_TCSBRK, 1)));
  struct termios2 t2;
  printf("pipe TCGETS2: %s\n", err(ioctl(p[0], L_TCGETS2, &t2)));
  printf("pipe tcdrain: %s\n", err(tcdrain(p[1])));
  printf("pipe tcflush TCIFLUSH: %s\n", err(tcflush(p[0], TCIFLUSH)));
  printf("pipe tcflush 7: %s\n", err(tcflush(p[0], 7)));
  printf("pipe tcsendbreak: %s\n", err(tcsendbreak(p[1], 0)));
  printf("pipe unknown 0x5432: %s\n", err(ioctl(p[0], 0x5432, &m)));
  write(p[1], "abc", 3);
  int n = -1;
  int r = ioctl(p[0], L_FIONREAD, &n);
  printf("pipe FIONREAD linux: %s %d\n", err(r), n);
  n = -1;
  r = ioctl(p[0], FIONREAD, &n);
  printf("pipe FIONREAD wasi: %s %d\n", err(r), n);
  close(p[0]);
  close(p[1]);
  printf("closed TIOCMGET: %s\n", err(ioctl(p[0], L_TIOCMGET, &m)));
  printf("closed tcdrain: %s\n", err(tcdrain(p[0])));
}

static void serial(const char *path) {
  int fd = open(path, O_RDWR | O_NOCTTY);
  if (fd < 0) { printf("open %s: %s\n", path, err(-1)); return; }
  printf("open: 0 isatty=%d\n", isatty(fd));
  printf("TIOCEXCL: %s\n", err(ioctl(fd, L_TIOCEXCL)));
  modem(fd, "TIOCMGET");
  int bits = L_TIOCM_DTR;
  printf("TIOCMBIC dtr: %s\n", err(ioctl(fd, L_TIOCMBIC, &bits)));
  modem(fd, "after TIOCMBIC");
  bits = L_TIOCM_DTR | L_TIOCM_RTS;
  printf("TIOCMBIS dtr rts: %s\n", err(ioctl(fd, L_TIOCMBIS, &bits)));
  bits = L_TIOCM_RTS;
  printf("TIOCMSET rts: %s\n", err(ioctl(fd, L_TIOCMSET, &bits)));
  modem(fd, "after TIOCMSET");
  printf("TIOCSBRK: %s\n", err(ioctl(fd, L_TIOCSBRK)));
  printf("TIOCCBRK: %s\n", err(ioctl(fd, L_TIOCCBRK)));
  printf("TCSBRKP 1: %s\n", err(ioctl(fd, L_TCSBRKP, 1)));
  printf("tcsendbreak: %s\n", err(tcsendbreak(fd, 0)));

  printf("write: %zd\n", write(fd, "hello", 5));
  printf("tcdrain: %s\n", err(tcdrain(fd)));
  int q = -1;
  int r = ioctl(fd, L_TIOCOUTQ, &q);
  printf("TIOCOUTQ: %s %d\n", err(r), q);
  printf("FIONREAD linux: %d\n", wait_bytes(fd, 5));
  int n = -1;
  r = ioctl(fd, FIONREAD, &n);
  printf("FIONREAD wasi: %s %d\n", err(r), n);
  char buf[16] = {0};
  printf("read: %zd %s\n", read(fd, buf, 5), buf);

  write(fd, "xyz", 3);
  printf("pending: %d\n", wait_bytes(fd, 3));
  printf("tcflush TCIFLUSH: %s\n", err(tcflush(fd, TCIFLUSH)));
  n = -1;
  ioctl(fd, L_FIONREAD, &n);
  printf("after tcflush: %d\n", n);
  printf("TCFLSH TCIOFLUSH: %s\n", err(ioctl(fd, L_TCFLSH, TCIOFLUSH)));
  printf("tcflush TCOFLUSH: %s\n", err(tcflush(fd, TCOFLUSH)));
  printf("tcflush 7: %s\n", err(tcflush(fd, 7)));

  struct termios2 t2;
  memset(&t2, 0, sizeof t2);
  r = ioctl(fd, L_TCGETS2, &t2);
  printf("TCGETS2: %s cbaud=%o ispeed=%u ospeed=%u\n", err(r), t2.c_cflag & L_CBAUD, t2.c_ispeed, t2.c_ospeed);
  t2.c_cflag = (t2.c_cflag & ~L_CBAUD) | L_BOTHER;
  t2.c_ispeed = t2.c_ospeed = 250000;
  printf("TCSETS2 250000: %s\n", err(ioctl(fd, L_TCSETS2, &t2)));
  memset(&t2, 0, sizeof t2);
  r = ioctl(fd, L_TCGETS2, &t2);
  printf("TCGETS2: %s cbaud=%o ispeed=%u ospeed=%u\n", err(r), t2.c_cflag & L_CBAUD, t2.c_ispeed, t2.c_ospeed);
  t2.c_ispeed = t2.c_ospeed = 460800;
  printf("TCSETSW2 460800: %s\n", err(ioctl(fd, L_TCSETSW2, &t2)));
  t2.c_ispeed = t2.c_ospeed = 921600;
  printf("TCSETSF2 921600: %s\n", err(ioctl(fd, L_TCSETSF2, &t2)));

  struct termios t;
  r = tcgetattr(fd, &t);
  cfsetispeed(&t, B115200);
  cfsetospeed(&t, B115200);
  printf("tcsetattr B115200: %s %s\n", err(r), err(tcsetattr(fd, TCSANOW, &t)));
  memset(&t2, 0, sizeof t2);
  r = ioctl(fd, L_TCGETS2, &t2);
  printf("TCGETS2: %s ispeed=%u ospeed=%u\n", err(r), t2.c_ispeed, t2.c_ospeed);
  printf("unknown 0x5432: %s\n", err(ioctl(fd, 0x5432, &n)));
  printf("TIOCNXCL: %s\n", err(ioctl(fd, L_TIOCNXCL)));
  printf("close: %d\n", close(fd));
}

static void tty(void) {
  int m = 0, n = -1;
  printf("tty isatty: %d\n", isatty(0));
  printf("tty TIOCMGET: %s\n", err(ioctl(0, L_TIOCMGET, &m)));
  printf("tty tcdrain: %s\n", err(tcdrain(1)));
  printf("tty tcflush TCIFLUSH: %s\n", err(tcflush(0, TCIFLUSH)));
  printf("tty tcsendbreak: %s\n", err(tcsendbreak(1, 0)));
  int r = ioctl(0, L_FIONREAD, &n);
  printf("tty FIONREAD: %s %d\n", err(r), n);
  printf("r44 tty done\n");
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IONBF, 0);
  if (argc > 1 && strcmp(argv[1], "tty") == 0) {
    tty();
    return 0;
  }
  pipes();
  if (argc > 1) serial(argv[1]);
  printf("r44 done\n");
  return 0;
}
