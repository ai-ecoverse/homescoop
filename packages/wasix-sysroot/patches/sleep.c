/* homescoop: wasix-libc v2025-09-02.1 libc-bottom-half/cloudlibc/src/libc/unistd/sleep.c
 * (sha256 bcfa1951…) returning the seconds left (wasix-sysroot -19). */
// Copyright (c) 2015 Nuxi, https://nuxi.nl/
//
// SPDX-License-Identifier: BSD-2-Clause

#include <time.h>
#include <unistd.h>

unsigned int sleep(unsigned int seconds) {
  struct timespec ts = {.tv_sec = seconds, .tv_nsec = 0};
  // homescoop: an interrupted sleep returns the seconds left, as musl does
  // (tv_sec of nanosleep's rem); upstream returned all of them.
  if (clock_nanosleep(CLOCK_REALTIME, 0, &ts, &ts) != 0)
    return ts.tv_sec;
  return 0;
}
