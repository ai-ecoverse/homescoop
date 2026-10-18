/* homescoop -36 (homescoop#1050): wasix-libc's uname() answers a fixed
 * nodename "wasmer.sh", so gethostname() (and ssh-keygen's default key
 * comment, git's committer host, ...) named Wasmer's site. slicc-kernel sets
 * HOSTNAME to its node name on every program start ("slicc" unless the kernel
 * was created with another); take it from there, and "slicc" without it. The
 * other fields keep upstream's placeholders. */
#define _GNU_SOURCE
#include <stdlib.h>
#include <string.h>
#include <sys/utsname.h>

int uname(struct utsname *uts)
{
	const char *h = getenv("HOSTNAME");
	if (!h || !*h || strlen(h) >= sizeof uts->nodename || strchr(h, '/')) h = "slicc";
	strcpy(uts->sysname, "wasi");
	strcpy(uts->nodename, h);
	strcpy(uts->release, "0.0.0");
	strcpy(uts->version, "0.0.0");
#if defined(__wasm32__)
	strcpy(uts->machine, "wasm32");
#elif defined(__wasm64__)
	strcpy(uts->machine, "wasm64");
#else
	strcpy(uts->machine, "unknown");
#endif
	strcpy(uts->domainname, "(none)");
	return 0;
}
