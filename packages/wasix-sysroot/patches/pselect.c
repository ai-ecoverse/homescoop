// Copyright (c) 2015-2016 Nuxi, https://nuxi.nl/
// homescoop: wasix-libc v2025-09-02.1 libc-bottom-half/cloudlibc/src/libc/sys/select/pselect.c
// (sha256 62f1a35b…), errorfds accepted (homescoop#195).
//
// SPDX-License-Identifier: BSD-2-Clause

#include <sys/select.h>
#include <stdbool.h>
#include <stdint.h>
#include <time.h>

#include <wasi/api.h>
#include <errno.h>

// A relative timeout in nanoseconds. homescoop: upstream used common/time.h's
// timespec_to_timestamp_clamp, which is for absolute times and turns any
// tv_sec <= 0 into 1 ns, so every sub-second select()/pselect() timeout
// returned at once (a 0.2 s select took 0 ms).
static inline bool timespec_to_timestamp_clamp(
    const struct timespec *timespec, __wasi_timestamp_t *timestamp) {
  if (timespec->tv_nsec < 0 || timespec->tv_nsec >= 1000000000)
    return false;
  if (timespec->tv_sec < 0) {
    *timestamp = 1; // already expired: return at once
  } else if (__builtin_mul_overflow((__wasi_timestamp_t)timespec->tv_sec, 1000000000, timestamp) ||
             __builtin_add_overflow(*timestamp, (__wasi_timestamp_t)timespec->tv_nsec, timestamp)) {
    *timestamp = UINT64_MAX;
  } else if (*timestamp == 0) {
    *timestamp = 1; // a zero timeout polls once
  }
  return true;
}

int pselect(int nfds, fd_set *restrict readfds, fd_set *restrict writefds,
            fd_set *restrict errorfds, const struct timespec *restrict timeout,
            const sigset_t *sigmask) {
  // Negative file descriptor upperbound.
  if (nfds < 0) {
    errno = EINVAL;
    return -1;
  }

  // homescoop (wasix-sysroot -18, homescoop#195): WASI poll has no
  // exceptional conditions (no out-of-band data; <poll.h> has POLLPRI ==
  // POLLIN), so none is ever reported: errorfds is accepted and comes back
  // empty. Upstream failed with ENOSYS for any non-empty errorfds, which
  // broke select(r, w, x) in perl, python, ruby and C programs.
  bool wait_forever = errorfds != NULL && errorfds->__nfds > 0 && timeout == NULL;
  if (errorfds != NULL)
    FD_ZERO(errorfds);

  // Replace NULL pointers by the empty set.
  fd_set empty;
  FD_ZERO(&empty);
  if (readfds == NULL)
    readfds = &empty;
  if (writefds == NULL)
    writefds = &empty;

  // Determine the maximum number of events.
  size_t maxevents = readfds->__nfds + writefds->__nfds + 1;
  __wasi_subscription_t subscriptions[maxevents];
  size_t nsubscriptions = 0;

  // Convert the readfds set.
  for (size_t i = 0; i < readfds->__nfds; ++i) {
    int fd = readfds->__fds[i];
    if (fd < nfds) {
      __wasi_subscription_t *subscription = &subscriptions[nsubscriptions++];
      *subscription = (__wasi_subscription_t){
          .userdata = fd,
          .u.tag = __WASI_EVENTTYPE_FD_READ,
          .u.u.fd_read.file_descriptor = fd,
      };
    }
  }

  // Convert the writefds set.
  for (size_t i = 0; i < writefds->__nfds; ++i) {
    int fd = writefds->__fds[i];
    if (fd < nfds) {
      __wasi_subscription_t *subscription = &subscriptions[nsubscriptions++];
      *subscription = (__wasi_subscription_t){
          .userdata = fd,
          .u.tag = __WASI_EVENTTYPE_FD_WRITE,
          .u.u.fd_write.file_descriptor = fd,
      };
    }
  }

  // Only exceptional conditions and no timeout: nothing can ever be
  // reported, so wait as POSIX does (until a signal interrupts it).
  if (nsubscriptions == 0 && wait_forever) {
    __wasi_subscription_t *subscription = &subscriptions[nsubscriptions++];
    *subscription = (__wasi_subscription_t){
        .u.tag = __WASI_EVENTTYPE_CLOCK,
        .u.u.clock.id = __WASI_CLOCKID_MONOTONIC,
        .u.u.clock.timeout = UINT64_MAX,
    };
  }

  // Create extra event for the timeout.
  if (timeout != NULL) {
    __wasi_subscription_t *subscription = &subscriptions[nsubscriptions++];
    *subscription = (__wasi_subscription_t){
        .u.tag = __WASI_EVENTTYPE_CLOCK,
        .u.u.clock.id = __WASI_CLOCKID_REALTIME,
    };
    if (!timespec_to_timestamp_clamp(timeout, &subscription->u.u.clock.timeout)) {
      errno = EINVAL;
      return -1;
    }
  }

  // Execute poll().
  __wasi_size_t nevents;
  __wasi_event_t events[nsubscriptions];
  __wasi_errno_t error =
      __wasi_poll_oneoff(subscriptions, events, nsubscriptions, &nevents);
  if (error != 0) {
    // WASI's poll requires at least one subscription, or else it returns
    // `EINVAL`. Since a `pselect` with nothing to wait for is valid in POSIX,
    // return `ENOTSUP` to indicate that we don't support that case.
    //
    // Wasm has no signal handling, so if none of the user-provided `pollfd`
    // elements, nor the timeout, led us to producing even one subscription
    // to wait for, there would be no way for the poll to wake up. WASI
    // returns `EINVAL` in this case, but for users of `poll`, `ENOTSUP` is
    // more likely to be understood.
    if (nsubscriptions == 0)
      errno = ENOTSUP;
    else
      errno = error;
    return -1;
  }

  // Test for EBADF.
  for (size_t i = 0; i < nevents; ++i) {
    const __wasi_event_t *event = &events[i];
    if ((event->type == __WASI_EVENTTYPE_FD_READ ||
         event->type == __WASI_EVENTTYPE_FD_WRITE) &&
        event->error == __WASI_ERRNO_BADF) {
      errno = EBADF;
      return -1;
    }
  }

  // Clear and set entries in the result sets.
  FD_ZERO(readfds);
  FD_ZERO(writefds);
  for (size_t i = 0; i < nevents; ++i) {
    const __wasi_event_t *event = &events[i];
    if (event->type == __WASI_EVENTTYPE_FD_READ) {
      readfds->__fds[readfds->__nfds++] = event->userdata;
    } else if (event->type == __WASI_EVENTTYPE_FD_WRITE) {
      writefds->__fds[writefds->__nfds++] = event->userdata;
    }
  }
  return readfds->__nfds + writefds->__nfds;
}
