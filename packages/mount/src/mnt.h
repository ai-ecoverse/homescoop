/* Shared bits of the slicc mount/umount pair (homescoop#62). */
#ifndef HOMESCOOP_MNT_H
#define HOMESCOOP_MNT_H

#include <stdio.h>

/* util-linux exit codes, so scripts that test them keep working. */
#define MNT_EX_SUCCESS 0
#define MNT_EX_USAGE 1
#define MNT_EX_SYSERR 2
#define MNT_EX_FAIL 32

#ifndef ENOMEDIUM
#define ENOMEDIUM 148
#endif

struct mnt_entry {
  char *source;
  char *target;
  char *fstype;
  char *options;
};

/* Opens /proc/mounts (or /proc/self/mounts); NULL with errno set. */
FILE *mnt_open(void);

/*
 * Reads the next entry into `e`, with \ooo escapes undone. The strings point
 * into a buffer owned by the reader and stay valid until the next call.
 * Returns 1 for an entry, 0 at the end.
 */
int mnt_next(FILE *f, struct mnt_entry *e);

/* Does a comma-separated option list contain `word` as a whole item? */
int mnt_has_option(const char *options, const char *word);

void mnt_version(const char *prog);

#endif
