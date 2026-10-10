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
  // interrupts them (nanosleep's rem, PEP 475). rqtp and rmtp may be the
  // same struct (sleep() passes &ts twice): the request is copied first and
  // *rmtp written last.
  const struct timespec req = *rqtp;
  struct timespec start;
  int relative = (flags & TIMER_ABSTIME) == 0;
  if (relative && clock_gettime(clock_id, &start) != 0)
    return EINVAL;

  // Block until polling event is triggered.
  __wasi_size_t nevents;
  __wasi_event_t ev;
  __wasi_errno_t error = __wasi_poll_oneoff(&sub, &ev, 1, &nevents);

  // Nanoseconds of req not slept yet; 0 if the clock cannot tell.
  long long left_ns = 0;
  if (relative) {
    struct timespec end;
    if (clock_gettime(clock_id, &end) == 0) {
      left_ns = ((long long)req.tv_sec - (end.tv_sec - start.tv_sec)) * 1000000000LL +
                (req.tv_nsec - (end.tv_nsec - start.tv_nsec));
      if (left_ns < 0) left_ns = 0;
    }
  }

  // homescoop: upstream mapped every failure, EINTR included, to ENOTSUP;
  // slicc-kernel answers EINTR when a signal interrupts the wait (modules
  // with fd_fdflags_set). Without it, it ends the wait early but reports the
  // clock as expired, so a relative sleep that ended more than 1 ms early
  // was interrupted too: EINTR and the time left, as on Linux.
  int interrupted = error == __WASI_ERRNO_INTR || (error == 0 && ev.error == __WASI_ERRNO_INTR) ||
                    (error == 0 && ev.error == 0 && left_ns > 1000000LL);
  if (!interrupted && !(error == 0 && ev.error == 0))
    return ENOTSUP;
  if (!interrupted)
    left_ns = 0;
  if (rmtp && relative) {
    rmtp->tv_sec = left_ns / 1000000000LL;
    rmtp->tv_nsec = left_ns % 1000000000LL;
  }
  return interrupted ? EINTR : 0;
}

weak_alias(clock_nanosleep, __clock_nanosleep);
