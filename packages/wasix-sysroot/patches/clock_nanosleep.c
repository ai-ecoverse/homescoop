/* homescoop: wasix-libc v2025-09-02.1 libc-bottom-half/cloudlibc/src/libc/time/clock_nanosleep.c
 * (sha256 945a8309…) returning EINTR with the time left (wasix-sysroot -19). */
// Copyright (c) 2015-2016 Nuxi, https://nuxi.nl/
//
// SPDX-License-Identifier: BSD-2-Clause

#include <common/clock.h>
#include <common/time.h>

#include <assert.h>
#include <wasi/api.h>
#include <errno.h>
#include <time.h>

static_assert(TIMER_ABSTIME == __WASI_SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME,
              "Value mismatch");

int clock_nanosleep(clockid_t clock_id, int flags, const struct timespec *rqtp,
                    struct timespec *rmtp) {
  if ((flags & ~TIMER_ABSTIME) != 0)
    return EINVAL;

  // Prepare polling subscription.
  __wasi_subscription_t sub = {
      .u.tag = __WASI_EVENTTYPE_CLOCK,
      .u.u.clock.id = clock_id,
      .u.u.clock.flags = flags,
  };
  if (!timespec_to_timestamp_exact(rqtp, &sub.u.u.clock.timeout))
    return EINVAL;

  // a zero timeout is an infinite wait, while 1 is used to
  // wait 0 seconds
  if (sub.u.u.clock.timeout == 0)
    sub.u.u.clock.timeout = 1;

  // homescoop: relative sleeps report the time left when a signal
  // interrupts them (nanosleep's rem, PEP 475).
  struct timespec start;
  int need_rem = rmtp != NULL && (flags & TIMER_ABSTIME) == 0;
  if ((flags & TIMER_ABSTIME) == 0 && clock_gettime(clock_id, &start) != 0)
    return EINVAL;

  // Block until polling event is triggered.
  __wasi_size_t nevents;
  __wasi_event_t ev;
  __wasi_errno_t error = __wasi_poll_oneoff(&sub, &ev, 1, &nevents);
  // homescoop: upstream mapped every failure, EINTR included, to ENOTSUP;
  // slicc-kernel answers EINTR when a signal interrupts the wait.
  if (error == __WASI_ERRNO_INTR || (error == 0 && ev.error == __WASI_ERRNO_INTR)) {
    if (need_rem) {
      struct timespec end;
      rmtp->tv_sec = 0;
      rmtp->tv_nsec = 0;
      if (clock_gettime(clock_id, &end) == 0) {
        time_t sec = rqtp->tv_sec - (end.tv_sec - start.tv_sec);
        long nsec = rqtp->tv_nsec - (end.tv_nsec - start.tv_nsec);
        if (nsec < 0) {
          sec -= 1;
          nsec += 1000000000L;
        }
        if (sec >= 0) {
          rmtp->tv_sec = sec;
          rmtp->tv_nsec = nsec;
        }
      }
    }
    return EINTR;
  }
  if (error == 0 && ev.error == 0) {
    // homescoop: slicc-kernel ends a clock wait early when a signal arrives
    // but reports the clock as expired, so a relative sleep that ended more
    // than 1 ms early was interrupted: EINTR and the time left, as Linux.
    if ((flags & TIMER_ABSTIME) == 0) {
      struct timespec end;
      if (clock_gettime(clock_id, &end) == 0) {
        long long left_ns = ((long long)rqtp->tv_sec - (end.tv_sec - start.tv_sec)) * 1000000000LL +
                            (rqtp->tv_nsec - (end.tv_nsec - start.tv_nsec));
        if (left_ns > 1000000LL) {
          if (rmtp) {
            rmtp->tv_sec = left_ns / 1000000000LL;
            rmtp->tv_nsec = left_ns % 1000000000LL;
          }
          return EINTR;
        }
      }
    }
    if (need_rem) {
      rmtp->tv_sec = 0;
      rmtp->tv_nsec = 0;
    }
    return 0;
  }
  return ENOTSUP;
}

weak_alias(clock_nanosleep, __clock_nanosleep);
