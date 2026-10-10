// wasix-sysroot 2025.9.30-20 probe: strftime("%Z") for a struct tm whose
// tm_zone is not one of musl's own pointers (CPython's time.strftime builds
// struct tm from a tuple). musl's __tm_to_tzname printed "" for any such
// pointer; -20 maps a copy of a known zone name to musl's string.
// `tzname TZIF` also runs the TZif case with TZ=:TZIF.
// One line per result; test/tzname.mjs checks them.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static void show(const char *label, struct tm tm, const char *zone) {
  char *copy = zone ? strdup(zone) : NULL;
  tm.tm_zone = copy;
  char buf[32] = "?";
  strftime(buf, sizeof buf, "%Z", &tm);
  printf("%s: [%s]\n", label, buf);
  free(copy);
}

static struct tm at(const char *tz, time_t t) {
  setenv("TZ", tz, 1);
  tzset();
  struct tm tm;
  localtime_r(&t, &tm);
  return tm;
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  time_t jan = 1767268800, jul = 1783512000;  // 2026-01-01, 2026-07-08 12:00 UTC
  struct tm tm = at("EST5EDT,M3.2.0,M11.1.0", jan);
  char own[32] = "?";
  strftime(own, sizeof own, "%Z", &tm);
  printf("own pointer: [%s]\n", own);
  show("copy EST", tm, "EST");
  show("copy EDT", at("EST5EDT,M3.2.0,M11.1.0", jul), "EDT");
  show("copy UTC", at("UTC", jan), "UTC");
  show("copy XYZ", at("EST5EDT,M3.2.0,M11.1.0", jan), "XYZ");
  show("null", at("EST5EDT,M3.2.0,M11.1.0", jan), NULL);
  if (argc > 1) {
    char tz[256];
    snprintf(tz, sizeof tz, ":%s", argv[1]);
    show("tzif jan copy", at(tz, jan), "CET");
    show("tzif jul copy", at(tz, jul), "CEST");
    show("tzif bogus", at(tz, jul), "EDT");
  }
  printf("tzname done\n");
  return 0;
}
