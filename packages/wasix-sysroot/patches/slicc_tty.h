/* homescoop wasix-sysroot -21: slicc-kernel's per-descriptor terminal calls
 * (module `slicc_tty`, slicc-kernel#289; #247, #279). Each returns 0 or a
 * WASI errno: ENOTTY when that fd is no terminal, EBADF for a closed fd, and
 * ENOSYS from a kernel without them, where libc keeps its old tty_get/tty_set
 * path. struct termios is musl's 60-byte wasm32 layout. */
#ifndef HOMESCOOP_SLICC_TTY_H
#define HOMESCOOP_SLICC_TTY_H
#include <stdint.h>
#include <termios.h>
#include <sys/ioctl.h>

#define SLICC_TTY(name) __attribute__((import_module("slicc_tty"), import_name(#name)))
SLICC_TTY(tcgetattr) int32_t __slicc_tty_tcgetattr(int32_t fd, struct termios *out);
SLICC_TTY(tcsetattr) int32_t __slicc_tty_tcsetattr(int32_t fd, int32_t actions, const struct termios *in);
SLICC_TTY(winsize) int32_t __slicc_tty_winsize(int32_t fd, struct winsize *out);

#define SLICC_TTY_ENOSYS 52

/* Linux's termios ioctls (asm-generic/ioctls.h); wasi-libc's sys/ioctl.h has
 * none. TCSETS + TCSANOW/TCSADRAIN/TCSAFLUSH = TCSETS/TCSETSW/TCSETSF. */
#ifndef TCGETS
#define TCGETS  0x5401
#define TCSETS  0x5402
#define TCSETSW 0x5403
#define TCSETSF 0x5404
#endif
#endif
