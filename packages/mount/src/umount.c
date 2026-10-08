/*
 * umount for slicc (homescoop#62): umount2(2) through the kernel
 * (slicc-kernel#92). An argument that isn't a mount point is looked up as a
 * source in /proc/mounts, as util-linux does, and its newest mount goes.
 * -l and -f both detach at once; files still open on the mount then fail.
 */
#include <errno.h>
#include <getopt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>

#include "mnt.h"

static void usage(FILE *out) {
  fputs("Usage:\n"
        " umount [-lfv] <directory>|<source>...\n"
        "\n"
        "Options:\n"
        " -l, --lazy      detach now, even when the filesystem is busy\n"
        " -f, --force     same as --lazy here\n"
        " -v, --verbose   say what is being done\n"
        " -h, --help      display this help\n"
        " -V, --version   display version\n",
        out);
}

/* The newest mount of `source`, or NULL. The caller frees the result. */
static char *target_of(const char *source) {
  FILE *f = mnt_open();
  if (!f) return NULL;
  struct mnt_entry e;
  char *found = NULL;
  while (mnt_next(f, &e)) {
    if (e.source && strcmp(e.source, source) == 0) {
      free(found);
      found = strdup(e.target);
    }
  }
  fclose(f);
  return found;
}

static int fail(const char *target, int err) {
  const char *what;
  switch (err) {
  case EBUSY:
    what = "target is busy (use -l to detach anyway)";
    break;
  case EINVAL:
    what = "not mounted";
    break;
  case EPERM:
    what = "Operation not permitted (process mounts are disabled here)";
    break;
  case ENOSYS:
    what = "umount2(2) is not available (needs a slicc-kernel with process mounts)";
    break;
  default:
    what = strerror(err);
  }
  fprintf(stderr, "umount: %s: %s.\n", target, what);
  return MNT_EX_FAIL;
}

static int umount_one(const char *arg, int flags, int verbose) {
  const char *target = arg;
  char *alt = NULL;
  int r = umount2(target, flags);
  if (r != 0 && (errno == EINVAL || errno == ENOENT)) {
    int err = errno;
    alt = target_of(arg);
    if (alt && strcmp(alt, arg) != 0) {
      target = alt;
      r = umount2(target, flags);
    } else {
      errno = err;
    }
  }
  int rc = r == 0 ? MNT_EX_SUCCESS : fail(arg, errno);
  if (r == 0 && verbose) printf("umount: %s unmounted.\n", target);
  free(alt);
  return rc;
}

int main(int argc, char **argv) {
  static const struct option longopts[] = {
      {"lazy", no_argument, NULL, 'l'},
      {"force", no_argument, NULL, 'f'},
      {"verbose", no_argument, NULL, 'v'},
      {"no-mtab", no_argument, NULL, 'n'},
      {"all", no_argument, NULL, 'a'},
      {"help", no_argument, NULL, 'h'},
      {"version", no_argument, NULL, 'V'},
      {NULL, 0, NULL, 0},
  };
  int flags = 0, verbose = 0, c;

  while ((c = getopt_long(argc, argv, "lfvahVn", longopts, NULL)) != -1) {
    switch (c) {
    case 'l':
      flags |= MNT_DETACH;
      break;
    case 'f':
      flags |= MNT_FORCE;
      break;
    case 'v':
      verbose = 1;
      break;
    case 'n':
      break;
    case 'a':
      fputs("umount: -a is not supported; name the directories to unmount.\n", stderr);
      return MNT_EX_USAGE;
    case 'h':
      usage(stdout);
      return MNT_EX_SUCCESS;
    case 'V':
      mnt_version("umount");
      return MNT_EX_SUCCESS;
    default:
      usage(stderr);
      return MNT_EX_USAGE;
    }
  }
  if (optind == argc) {
    fputs("umount: no directory given.\n", stderr);
    usage(stderr);
    return MNT_EX_USAGE;
  }

  int rc = MNT_EX_SUCCESS;
  for (int i = optind; i < argc; i++)
    if (umount_one(argv[i], flags, verbose) != MNT_EX_SUCCESS) rc = MNT_EX_FAIL;
  return rc;
}
