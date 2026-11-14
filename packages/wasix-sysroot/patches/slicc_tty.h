/* homescoop wasix-sysroot -21: slicc-kernel's per-descriptor terminal calls
 * (module `slicc_tty`, slicc-kernel#289; #247, #279). Each returns 0 or a
 * WASI errno: ENOTTY when that fd is no terminal, EBADF for a closed fd, and
 * ENOSYS from a kernel without them, where libc keeps its old tty_get/tty_set
 * path. struct termios is musl's 60-byte wasm32 layout. */
#ifndef HOMESCOOP_SLICC_TTY_H
#define HOMESCOOP_SLICC_TTY_H
#include <errno.h>
#include <stdint.h>
#include <termios.h>
#include <sys/ioctl.h>

#define SLICC_TTY(name) __attribute__((import_module("slicc_tty"), import_name(#name)))
SLICC_TTY(tcgetattr) int32_t __slicc_tty_tcgetattr(int32_t fd, struct termios *out);
SLICC_TTY(tcsetattr) int32_t __slicc_tty_tcsetattr(int32_t fd, int32_t actions, const struct termios *in);
SLICC_TTY(winsize) int32_t __slicc_tty_winsize(int32_t fd, struct winsize *out);
SLICC_TTY(ioctl) int32_t __slicc_tty_ioctl(int32_t fd, int32_t request, int32_t arg);

#define SLICC_TTY_ENOSYS 52

/* Linux's termios ioctls (asm-generic/ioctls.h); wasi-libc's sys/ioctl.h has
 * none. TCSETS + TCSANOW/TCSADRAIN/TCSAFLUSH = TCSETS/TCSETSW/TCSETSF. */
#ifndef TCGETS
#define TCGETS  0x5401
#define TCSETS  0x5402
#define TCSETSW 0x5403
#define TCSETSF 0x5404
#endif

#define SLICC_LINUX_TIOCGWINSZ 0x5413
#define SLICC_LINUX_TIOCSWINSZ 0x5414

#define SLICC_LINUX_TCSBRK   0x5409u
#define SLICC_LINUX_TCFLSH   0x540Bu
#define SLICC_LINUX_TIOCEXCL 0x540Cu
#define SLICC_LINUX_TIOCNXCL 0x540Du
#define SLICC_LINUX_TIOCOUTQ 0x5411u
#define SLICC_LINUX_TIOCMGET 0x5415u
#define SLICC_LINUX_TIOCMBIS 0x5416u
#define SLICC_LINUX_TIOCMBIC 0x5417u
#define SLICC_LINUX_TIOCMSET 0x5418u
#define SLICC_LINUX_FIONREAD 0x541Bu
#define SLICC_LINUX_TCSBRKP  0x5425u
#define SLICC_LINUX_TIOCSBRK 0x5427u
#define SLICC_LINUX_TIOCCBRK 0x5428u
#define SLICC_LINUX_TCGETS2  0x802C542Au
#define SLICC_LINUX_TCSETS2  0x402C542Bu
#define SLICC_LINUX_TCSETSW2 0x402C542Cu
#define SLICC_LINUX_TCSETSF2 0x402C542Du

static inline int __slicc_tty_fallback(int32_t k) {
	return k == SLICC_TTY_ENOSYS || k == ENOTTY;
}
#endif
