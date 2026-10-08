/*
 * mount for slicc (homescoop#62): list /proc/mounts, or ask the kernel to
 * mount `source` on `target` through mount(2) (slicc-kernel#92).
 *
 * The kernel's drivers decide what a source means: tmpfs and fsa ignore it
 * (`none` is customary), hostfs takes the host path. ro/rw become MS_RDONLY;
 * every other -o item goes to the driver as the data string, which the
 * kernel parses like `kernel.mount({ options })` and drops generic words
 * from (defaults, noatime, …). Remount, bind and move give EINVAL there.
 */
#include <errno.h>
#include <getopt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <unistd.h>

#include "mnt.h"

static void usage(FILE *out) {
  fputs("Usage:\n"
        " mount [-l] [-t type]                 list mounted filesystems\n"
        " mount [-rwv] [-t type] [-o options] <source> <directory>\n"
        "\n"
        "Options:\n"
        " -t, --types <type>     filesystem type (tmpfs, fsa, hostfs, ...)\n"
        " -o, --options <list>   comma-separated mount options (ro, rw, maxfile=1g, ...)\n"
        " -r, --read-only        mount read-only (same as -o ro)\n"
        " -w, --rw, --read-write mount read-write (default)\n"
        " -v, --verbose          say what is being done\n"
        " -l, --show-labels      accepted for compatibility\n"
        " -h, --help             display this help\n"
        " -V, --version          display version\n",
        out);
}

static int list(const char *type) {
  FILE *f = mnt_open();
  if (!f) {
    fprintf(stderr, "mount: cannot read /proc/mounts: %s\n", strerror(errno));
    return MNT_EX_SYSERR;
  }
  struct mnt_entry e;
  while (mnt_next(f, &e)) {
    if (type && strcmp(type, e.fstype) != 0) continue;
    printf("%s on %s type %s (%s)\n", e.source ? e.source : "none", e.target, e.fstype,
           e.options);
  }
  fclose(f);
  return MNT_EX_SUCCESS;
}

/* Appends `item` to the comma-separated `*list`. */
static void append(char **list, const char *item, size_t len) {
  size_t old = *list ? strlen(*list) : 0;
  char *s = realloc(*list, old + len + 2);
  if (!s) {
    perror("mount");
    exit(MNT_EX_SYSERR);
  }
  if (old) s[old++] = ',';
  memcpy(s + old, item, len);
  s[old + len] = '\0';
  *list = s;
}

struct flag_word {
  const char *word;
  unsigned long set;
  unsigned long clear;
};

/*
 * Option words that are mount(2) flags rather than driver options. The
 * kernel accepts and ignores the nosuid/atime family; it answers remount,
 * bind and move with EINVAL, which the error message explains.
 */
static const struct flag_word flag_words[] = {
    {"ro", MS_RDONLY, 0},
    {"rw", 0, MS_RDONLY},
    {"nosuid", MS_NOSUID, 0},
    {"nodev", MS_NODEV, 0},
    {"noexec", MS_NOEXEC, 0},
    {"sync", MS_SYNCHRONOUS, 0},
    {"dirsync", MS_DIRSYNC, 0},
    {"noatime", MS_NOATIME, 0},
    {"nodiratime", MS_NODIRATIME, 0},
    {"relatime", MS_RELATIME, 0},
    {"strictatime", MS_STRICTATIME, 0},
    {"lazytime", MS_LAZYTIME, 0},
    {"silent", MS_SILENT, 0},
    {"remount", MS_REMOUNT, 0},
    {"bind", MS_BIND, 0},
    {"rbind", MS_BIND | MS_REC, 0},
    {"move", MS_MOVE, 0},
};

/* fstab-only words: meaningful to mount -a, never to the driver. */
static const char *const fstab_words[] = {
    "defaults", "auto", "noauto", "user", "nouser", "users", "owner", "group",
    "nofail",   "_netdev", "suid", "dev", "exec", "async", "atime", "diratime", "loud",
};

/* Splits -o options into mount(2) flags and the driver's data string. */
static void parse_options(const char *opts, unsigned long *flags, char **data) {
  const char *p = opts;
  while (*p) {
    // An item ends at a comma outside double quotes (context="a,b").
    const char *end = p;
    int quoted = 0;
    for (; *end && (quoted || *end != ','); end++)
      if (*end == '"') quoted = !quoted;
    size_t len = (size_t)(end - p);
    int known = len == 0 || (len > 2 && strncmp(p, "x-", 2) == 0);
    for (size_t i = 0; !known && i < sizeof flag_words / sizeof *flag_words; i++) {
      if (strlen(flag_words[i].word) == len && strncmp(p, flag_words[i].word, len) == 0) {
        *flags = (*flags | flag_words[i].set) & ~flag_words[i].clear;
        known = 1;
      }
    }
    for (size_t i = 0; !known && i < sizeof fstab_words / sizeof *fstab_words; i++)
      known = strlen(fstab_words[i]) == len && strncmp(p, fstab_words[i], len) == 0;
    if (!known) append(data, p, len);
    p = *end ? end + 1 : end;
  }
}

static int fail(const char *target, const char *type, unsigned long flags, int err) {
  const char *what;
  char buf[256];
  switch (err) {
  case ENODEV:
    // The kernel knows hostfs but refuses it when the page has no grant hook.
    snprintf(buf, sizeof buf,
             strcmp(type, "hostfs") == 0 ? "%s is not available here (no host connection)"
                                         : "unknown filesystem type '%s'",
             type);
    what = buf;
    break;
  case EBUSY:
    what = "already mounted or mount point busy";
    break;
  case EPERM:
    what = "Operation not permitted (process mounts are disabled here)";
    break;
  case EINVAL:
    what = flags & (MS_REMOUNT | MS_BIND | MS_MOVE)
               ? "remount, bind and move are not supported"
               : "bad option, flag or option value";
    break;
  case ENOMEDIUM:
    what = "No medium found";
    break;
  case ENOENT:
    what = "mount point does not exist";
    break;
  case ENOTDIR:
    what = "mount point is not a directory";
    break;
  case EINTR:
    what = "interrupted while waiting for the mount";
    break;
  case ENOSYS:
    what = "mount(2) is not available (needs a slicc-kernel with process mounts)";
    break;
  default:
    what = strerror(err);
  }
  fprintf(stderr, "mount: %s: %s.\n", target, what);
  return MNT_EX_FAIL;
}

/* A just-mounted fsa drive is empty until the user picks a folder. */
static void note_nomedium(const char *target) {
  FILE *f = mnt_open();
  if (!f) return;
  struct mnt_entry e;
  int nomedium = 0;
  while (mnt_next(f, &e))
    if (strcmp(e.target, target) == 0) nomedium = mnt_has_option(e.options, "nomedium");
  fclose(f);
  if (nomedium)
    fprintf(stderr, "mount: %s: no medium yet; choose \"Insert folder\" in the page to fill it.\n",
            target);
}

int main(int argc, char **argv) {
  static const struct option longopts[] = {
      {"types", required_argument, NULL, 't'},
      {"options", required_argument, NULL, 'o'},
      {"read-only", no_argument, NULL, 'r'},
      {"rw", no_argument, NULL, 'w'},
      {"read-write", no_argument, NULL, 'w'},
      {"verbose", no_argument, NULL, 'v'},
      {"show-labels", no_argument, NULL, 'l'},
      {"help", no_argument, NULL, 'h'},
      {"version", no_argument, NULL, 'V'},
      {NULL, 0, NULL, 0},
  };
  const char *type = NULL;
  char *data = NULL;
  unsigned long flags = 0;
  int verbose = 0, c;

  while ((c = getopt_long(argc, argv, "t:o:rwvlhVn", longopts, NULL)) != -1) {
    switch (c) {
    case 't':
      type = optarg;
      break;
    case 'o':
      parse_options(optarg, &flags, &data);
      break;
    case 'r':
      flags |= MS_RDONLY;
      break;
    case 'w':
      flags &= ~(unsigned long)MS_RDONLY;
      break;
    case 'v':
      verbose = 1;
      break;
    case 'l':
    case 'n':
      break;
    case 'h':
      usage(stdout);
      return MNT_EX_SUCCESS;
    case 'V':
      mnt_version("mount");
      return MNT_EX_SUCCESS;
    default:
      usage(stderr);
      return MNT_EX_USAGE;
    }
  }

  int rest = argc - optind;
  if (rest == 0) return list(type);
  if (rest == 1) {
    fprintf(stderr, "mount: %s: give both a source and a directory (there is no fstab lookup).\n",
            argv[optind]);
    return MNT_EX_USAGE;
  }
  if (rest > 2) {
    usage(stderr);
    return MNT_EX_USAGE;
  }

  const char *source = argv[optind], *target = argv[optind + 1];
  if (!type) {
    fprintf(stderr, "mount: %s: no filesystem type given; use -t (tmpfs, fsa, hostfs, ...).\n",
            target);
    return MNT_EX_USAGE;
  }
  if (mount(source, target, type, flags, data) != 0) return fail(target, type, flags, errno);

  if (verbose) printf("mount: %s mounted on %s.\n", source, target);
  if (verbose || isatty(STDERR_FILENO)) note_nomedium(target);
  return MNT_EX_SUCCESS;
}
