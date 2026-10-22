#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>
#include <string.h>
#include <sys/utsname.h>
#include <unistd.h>

static int blank(char c)
{
	return c == ' ' || c == '\t' || c == '\r' || c == '\v' || c == '\f';
}

static int usable(const char *s, size_t n, size_t cap)
{
	if (!n || n >= cap) return 0;
	for (size_t i = 0; i < n; i++) {
		unsigned char c = s[i];
		if (c <= ' ' || c == 0x7f || c == '/') return 0;
	}
	return 1;
}

static int pick(const char *b, size_t n, int eof, size_t *ps, size_t *pe)
{
	size_t i = 0;
	while (i < n) {
		const char *nl = memchr(b + i, '\n', n - i);
		if (!nl && !eof) return 0;
		size_t end = nl ? (size_t)(nl - b) : n;
		size_t start = i;
		size_t stop = end;
		while (start < stop && blank(b[start])) start++;
		while (stop > start && blank(b[stop - 1])) stop--;
		if (stop > start && b[start] != '#') {
			*ps = start;
			*pe = stop;
			return 1;
		}
		i = end + 1;
	}
	return eof ? -1 : 0;
}

static int from_file(char *out, size_t cap)
{
	char b[1024];
	size_t n = 0, start = 0, end = 0;
	int got = 0;
	int fd = open("/etc/hostname", O_RDONLY | O_NONBLOCK | O_CLOEXEC);
	if (fd < 0) return 0;
	while (n < sizeof b) {
		ssize_t k = read(fd, b + n, sizeof b - n);
		if (k < 0 && errno == EINTR) continue;
		if (k < 0) {
			close(fd);
			return 0;
		}
		n += k;
		got = pick(b, n, k == 0, &start, &end);
		if (got || k == 0) break;
	}
	while (!got && n == sizeof b) {
		char extra;
		ssize_t k = read(fd, &extra, 1);
		if (k < 0 && errno == EINTR) continue;
		if (k == 0) got = pick(b, n, 1, &start, &end);
		break;
	}
	close(fd);
	if (got != 1 || !usable(b + start, end - start, cap)) return 0;
	memcpy(out, b + start, end - start);
	out[end - start] = 0;
	return 1;
}

int uname(struct utsname *uts)
{
	int saved = errno;
	if (!from_file(uts->nodename, sizeof uts->nodename)) {
		const char *h = getenv("HOSTNAME");
		if (!h || !usable(h, strlen(h), sizeof uts->nodename)) h = "slicc";
		strcpy(uts->nodename, h);
	}
	errno = saved;
	strcpy(uts->sysname, "wasi");
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
