/*
 * BSD sockets for Emscripten programs in slicc's wasm realm (#3571): stream
 * sockets on the kernel's virtual loopback network, backed by
 * Module.sliccKernel.net (packages/webapp/src/kernel/wasm-realm/process-sockets.ts).
 *
 * Emscripten routes socket(2) and friends to SOCKFS, which maps a socket to a
 * WebSocket and cannot listen in a browser. These definitions replace its
 * __syscall_* entry points (musl's libsockets wrappers call them), so
 * socket / bind / listen / accept4 / connect / send / recv / shutdown /
 * getsockname / getpeername / getsockopt / setsockopt / socketpair / sendmsg /
 * recvmsg reach the kernel. A socket is an ordinary fd of the program's FS:
 * read, write, close, dup, fcntl(O_NONBLOCK), poll and select (slicc_select.c)
 * work on it.
 *
 * select(2) too: musl's select() polls through __syscall_poll, which here is
 * slicc_select.c's kernel-backed poll (so link slicc_select.o as well; without
 * it the link fails instead of select() never waiting).
 *
 * AF_INET (IPv4) and AF_UNIX, SOCK_STREAM only. getaddrinfo resolves
 * localhost and numeric IPv4 without DNS; every other name is EAI_NONAME (the
 * realm has no network of its own).
 *
 * Link with --whole-archive (or as an object) so these win over libc's.
 */
#include <emscripten.h>
#include <errno.h>
#include <netdb.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <poll.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/uio.h>
#include <sys/un.h>

/* An address as it crosses to JavaScript: family 2 (inet: host-order ip, port) or 1 (unix: path). */
struct slicc_addr {
  int family;
  unsigned ip;
  int port;
  char path[108];
};

/* -ENOSYS without the wasm realm's kernel (the node realm, a plain runtime). */
EM_JS(int, slicc_net_ready, (void), {
  return Module.sliccKernel && Module.sliccKernel.net ? 1 : 0;
});

EM_JS(int, slicc_socket_js, (int unix_domain, int nonblock, int cloexec), {
  return Module.sliccKernel.net.socket(unix_domain ? 'unix' : 'inet', !!nonblock, !!cloexec);
});

EM_JS(int, slicc_socketpair_js, (int unix_domain, int nonblock, int cloexec, int *fds), {
  const r = Module.sliccKernel.net.socketpair(unix_domain ? 'unix' : 'inet', !!nonblock, !!cloexec);
  if (typeof r === 'number') return r;
  HEAP32[fds >> 2] = r[0];
  HEAP32[(fds >> 2) + 1] = r[1];
  return 0;
});

EM_JS(int, slicc_bind_js, (int fd, int family, unsigned ip, int port, const char *path, int connect), {
  const host = [ ip >>> 24, (ip >>> 16) & 255, (ip >>> 8) & 255, ip & 255 ].join('.');
  const addr = family === 1 ? { family : 'unix', path : UTF8ToString(path) } : { family : 'inet', host, port };
  const net = Module.sliccKernel.net;
  return connect ? net.connect(fd, addr) : net.bind(fd, addr);
});

EM_JS(int, slicc_listen_js, (int fd, int backlog), {
  return Module.sliccKernel.net.listen(fd, backlog);
});

/*
 * accept4 (op 0: `arg` bit 0 nonblock, bit 1 cloexec), getsockname (op 1) or
 * getpeername (op 2):
 * the address goes to `out`; accept answers the new fd.
 */
EM_JS(int, slicc_addr_call_js, (int op, int fd, int arg, struct slicc_addr *out), {
  const net = Module.sliccKernel.net;
  const r = op === 0 ? net.accept(fd, !!(arg & 1), !!(arg & 2)) : net.name(fd, op === 2);
  if (typeof r === 'number') return r;
  const a = op === 0 ? r.peer : r;
  if (a && a.family === 'unix') {
    HEAP32[out >> 2] = 1;
    const bytes = new TextEncoder().encode(a.path).subarray(0, 107);
    HEAPU8.set(bytes, out + 12);
    HEAPU8[out + 12 + bytes.length] = 0;
  } else if (a) {
    const q = a.host.split('.').map(Number);
    HEAP32[out >> 2] = 2;
    HEAPU32[(out + 4) >> 2] = ((q[0] << 24) | (q[1] << 16) | (q[2] << 8) | q[3]) >>> 0;
    HEAP32[(out + 8) >> 2] = a.port;
  }
  return op === 0 ? r.fd : 0;
});

EM_JS(int, slicc_shutdown_js, (int fd, int how), {
  return Module.sliccKernel.net.shutdown(fd, how);
});

EM_JS(int, slicc_getopt_js, (int fd, int level, int name, int *value), {
  const r = Module.sliccKernel.net.getopt(fd, level, name);
  if (typeof r === 'number') return r;
  HEAP32[value >> 2] = r.value;
  return 0;
});

EM_JS(int, slicc_setopt_js, (int fd, int level, int name, int value), {
  return Module.sliccKernel.net.setopt(fd, level, name, value);
});

EM_JS(int, slicc_send_js, (int fd, const void *buf, size_t len, int dontwait, int nosignal), {
  const bytes = HEAPU8.slice(buf, buf + len);
  return Module.sliccKernel.net.send(fd, bytes, { dontwait : !!dontwait, nosignal : !!nosignal });
});

EM_JS(int, slicc_recv_js, (int fd, void *buf, size_t len, int dontwait, int peek), {
  const r = Module.sliccKernel.net.recv(fd, len, { dontwait : !!dontwait, peek : !!peek });
  if (typeof r === 'number') return r;
  HEAPU8.set(r, buf);
  return r.length;
});

/* A sockaddr as the kernel names it; -errno when it is none the kernel knows. */
static int addr_in(const struct sockaddr *sa, socklen_t len, struct slicc_addr *out) {
  memset(out, 0, sizeof *out);
  if (!sa || len < (socklen_t)sizeof(sa_family_t)) return -EINVAL;
  if (sa->sa_family == AF_INET) {
    if (len < (socklen_t)sizeof(struct sockaddr_in)) return -EINVAL;
    const struct sockaddr_in *in = (const struct sockaddr_in *)sa;
    out->family = 2;
    out->ip = ntohl(in->sin_addr.s_addr);
    out->port = ntohs(in->sin_port);
    return 0;
  }
  if (sa->sa_family == AF_UNIX) {
    const struct sockaddr_un *un = (const struct sockaddr_un *)sa;
    size_t n = len - offsetof(struct sockaddr_un, sun_path);
    if (len <= offsetof(struct sockaddr_un, sun_path)) return -EINVAL;
    if (n > sizeof out->path - 1) n = sizeof out->path - 1;
    out->family = 1;
    if (un->sun_path[0] == '\0') {
      /* Linux's abstract namespace: the name after the NUL, shown as '@name'. */
      out->path[0] = '@';
      memcpy(out->path + 1, un->sun_path + 1, n > 1 ? n - 1 : 0);
    } else {
      memcpy(out->path, un->sun_path, n);
    }
    out->path[strnlen(out->path, sizeof out->path - 1)] = '\0';
    return 0;
  }
  return -EAFNOSUPPORT;
}

/* Write `a` to the caller's sockaddr, truncated to *len; *len becomes its full size. */
static void addr_out(const struct slicc_addr *a, struct sockaddr *sa, socklen_t *len) {
  if (!sa || !len) return;
  if (a->family == 2) {
    struct sockaddr_in in;
    memset(&in, 0, sizeof in);
    in.sin_family = AF_INET;
    in.sin_port = htons((unsigned short)a->port);
    in.sin_addr.s_addr = htonl(a->ip);
    memcpy(sa, &in, *len < sizeof in ? *len : sizeof in);
    *len = sizeof in;
    return;
  }
  struct sockaddr_un un;
  memset(&un, 0, sizeof un);
  un.sun_family = AF_UNIX;
  size_t n = strlen(a->path);
  if (a->path[0] == '@') {
    memcpy(un.sun_path + 1, a->path + 1, n - 1);
  } else {
    memcpy(un.sun_path, a->path, n);
  }
  socklen_t full = (socklen_t)(offsetof(struct sockaddr_un, sun_path) + n + (a->path[0] == '@' ? 0 : 1));
  memcpy(sa, &un, *len < full ? *len : full);
  *len = full;
}

int __syscall_socket(int domain, int type, int protocol, int u1, int u2, int u3) {
  int base = type & ~(SOCK_NONBLOCK | SOCK_CLOEXEC);
  if (!slicc_net_ready()) return -ENOSYS;
  if (domain != AF_INET && domain != AF_UNIX) return -EAFNOSUPPORT;
  if (base != SOCK_STREAM) return -EPROTONOSUPPORT;
  if (protocol != 0 && !(domain == AF_INET && protocol == IPPROTO_TCP)) return -EPROTONOSUPPORT;
  return slicc_socket_js(domain == AF_UNIX, (type & SOCK_NONBLOCK) != 0,
                         (type & SOCK_CLOEXEC) != 0);
}

int __syscall_socketpair(int domain, int type, int protocol, int fds[2], int u1, int u2) {
  int base = type & ~(SOCK_NONBLOCK | SOCK_CLOEXEC);
  if (!slicc_net_ready()) return -ENOSYS;
  if (domain != AF_UNIX) return -EOPNOTSUPP;
  if (base != SOCK_STREAM) return -EPROTONOSUPPORT;
  return slicc_socketpair_js(1, (type & SOCK_NONBLOCK) != 0, (type & SOCK_CLOEXEC) != 0, fds);
}

static int bind_or_connect(int fd, const struct sockaddr *sa, socklen_t len, int connect) {
  struct slicc_addr a;
  if (!slicc_net_ready()) return -ENOSYS;
  int r = addr_in(sa, len, &a);
  return r < 0 ? r : slicc_bind_js(fd, a.family, a.ip, a.port, a.path, connect);
}

int __syscall_bind(int fd, const struct sockaddr *sa, socklen_t len, int u1, int u2, int u3) {
  return bind_or_connect(fd, sa, len, 0);
}

int __syscall_connect(int fd, const struct sockaddr *sa, socklen_t len, int u1, int u2, int u3) {
  return bind_or_connect(fd, sa, len, 1);
}

int __syscall_listen(int fd, int backlog, int u1, int u2, int u3, int u4) {
  if (!slicc_net_ready()) return -ENOSYS;
  return slicc_listen_js(fd, backlog);
}

int __syscall_accept4(int fd, struct sockaddr *sa, socklen_t *len, int flags, int u1, int u2) {
  struct slicc_addr peer;
  if (!slicc_net_ready()) return -ENOSYS;
  if (flags & ~(SOCK_NONBLOCK | SOCK_CLOEXEC)) return -EINVAL;
  memset(&peer, 0, sizeof peer);
  peer.family = 2;
  int arg = ((flags & SOCK_NONBLOCK) != 0) | ((flags & SOCK_CLOEXEC) != 0) << 1;
  int r = slicc_addr_call_js(0, fd, arg, &peer);
  if (r >= 0) addr_out(&peer, sa, len);
  return r;
}

static int name(int fd, struct sockaddr *sa, socklen_t *len, int peer) {
  struct slicc_addr a;
  if (!slicc_net_ready()) return -ENOSYS;
  if (!sa || !len) return -EFAULT;
  int r = slicc_addr_call_js(peer ? 2 : 1, fd, 0, &a);
  if (r == 0) addr_out(&a, sa, len);
  return r;
}

int __syscall_getsockname(int fd, struct sockaddr *sa, socklen_t *len, int u1, int u2, int u3) {
  return name(fd, sa, len, 0);
}

int __syscall_getpeername(int fd, struct sockaddr *sa, socklen_t *len, int u1, int u2, int u3) {
  return name(fd, sa, len, 1);
}

int __syscall_shutdown(int fd, int how, int u1, int u2, int u3, int u4) {
  if (!slicc_net_ready()) return -ENOSYS;
  return slicc_shutdown_js(fd, how);
}

int __syscall_getsockopt(int fd, int level, int optname, void *optval, socklen_t *optlen, int u) {
  int value = 0;
  if (!slicc_net_ready()) return -ENOSYS;
  if (!optval || !optlen) return -EFAULT;
  int r = slicc_getopt_js(fd, level, optname, &value);
  if (r < 0) return r;
  /* A struct option (SO_LINGER, SO_RCVTIMEO, ...) reads as zeros; an int one as its value. */
  int is_struct = level == SOL_SOCKET && (optname == SO_LINGER || optname == SO_RCVTIMEO || optname == SO_SNDTIMEO);
  memset(optval, 0, *optlen);
  if (*optlen >= sizeof(int) && !is_struct) {
    memcpy(optval, &value, sizeof value);
    *optlen = sizeof(int);
  }
  return 0;
}

int __syscall_setsockopt(int fd, int level, int optname, const void *optval, socklen_t optlen, int u) {
  int value = 0;
  if (!slicc_net_ready()) return -ENOSYS;
  if (optlen > 0 && !optval) return -EFAULT;
  if (optlen >= sizeof(int)) memcpy(&value, optval, sizeof value);
  else if (optlen > 0) value = *(const unsigned char *)optval;
  return slicc_setopt_js(fd, level, optname, value);
}

int __syscall_sendto(int fd, const void *buf, size_t len, int flags, const struct sockaddr *sa, socklen_t alen) {
  if (!slicc_net_ready()) return -ENOSYS;
  /* A stream socket sends to its peer; the address is ignored, as Linux does once connected. */
  return slicc_send_js(fd, buf, len, (flags & MSG_DONTWAIT) != 0, (flags & MSG_NOSIGNAL) != 0);
}

int __syscall_recvfrom(int fd, void *buf, size_t len, int flags, struct sockaddr *sa, socklen_t *alen) {
  if (!slicc_net_ready()) return -ENOSYS;
  int r = slicc_recv_js(fd, buf, len, (flags & MSG_DONTWAIT) != 0, (flags & MSG_PEEK) != 0);
  if (r >= 0 && sa && alen) {
    struct slicc_addr peer;
    if (slicc_addr_call_js(2, fd, 0, &peer) == 0) addr_out(&peer, sa, alen);
  }
  return r;
}

int __syscall_sendmsg(int fd, const struct msghdr *msg, int flags, int u1, int u2, int u3) {
  ssize_t total = 0;
  if (!slicc_net_ready()) return -ENOSYS;
  for (int i = 0; i < (int)msg->msg_iovlen; i++) {
    const struct iovec *iov = &msg->msg_iov[i];
    if (iov->iov_len == 0) continue;
    int r = __syscall_sendto(fd, iov->iov_base, iov->iov_len, flags, 0, 0);
    if (r < 0) return total > 0 ? (int)total : r;
    total += r;
    if ((size_t)r < iov->iov_len) break; /* a short (non-blocking) send */
  }
  return (int)total;
}

int __syscall_recvmsg(int fd, struct msghdr *msg, int flags, int u1, int u2, int u3) {
  ssize_t total = 0;
  if (!slicc_net_ready()) return -ENOSYS;
  msg->msg_controllen = 0;
  msg->msg_flags = 0;
  for (int i = 0; i < (int)msg->msg_iovlen; i++) {
    struct iovec *iov = &msg->msg_iov[i];
    if (iov->iov_len == 0) continue;
    /* After the first bytes, take only what is there: never wait for more. */
    int r = __syscall_recvfrom(fd, iov->iov_base, iov->iov_len, total > 0 ? flags | MSG_DONTWAIT : flags, 0, 0);
    if (r < 0) return total > 0 ? (int)total : r;
    total += r;
    if ((size_t)r < iov->iov_len) break;
  }
  if (msg->msg_name && msg->msg_namelen) {
    struct slicc_addr peer;
    socklen_t len = msg->msg_namelen;
    if (slicc_addr_call_js(2, fd, 0, &peer) == 0) {
      addr_out(&peer, msg->msg_name, &len);
      msg->msg_namelen = len;
    }
  }
  return (int)total;
}

/* slicc_select.c's poll over kernel descriptors (count, or -errno). */
int slicc_poll_js(struct pollfd *fds, int n, int timeout_ms);

int __syscall_poll(struct pollfd *fds, nfds_t n, int timeout) {
  return slicc_poll_js(fds, (int)n, timeout);
}

/* ---- name resolution: localhost and numeric IPv4, no DNS ---- */

struct slicc_ai {
  struct addrinfo ai;
  struct sockaddr_in sin;
};

static int is_localhost(const char *name) {
  size_t n = strlen(name);
  if (n && name[n - 1] == '.') n--; /* a fully qualified "localhost." */
  if (n == 9 && strncasecmp(name, "localhost", 9) == 0) return 1;
  /* RFC 6761: every *.localhost name is loopback. */
  return n > 10 && strncasecmp(name + n - 10, ".localhost", 10) == 0;
}

static int service_port(const char *service, int flags, int *port) {
  char *end;
  if (!service || !*service) {
    *port = 0;
    return 0;
  }
  unsigned long n = strtoul(service, &end, 10);
  if (*end == '\0') {
    if (n > 65535) return EAI_SERVICE;
    *port = (int)n;
    return 0;
  }
  if (flags & AI_NUMERICSERV) return EAI_NONAME;
  if (strcmp(service, "http") == 0) *port = 80;
  else if (strcmp(service, "https") == 0) *port = 443;
  else return EAI_SERVICE;
  return 0;
}

static int host_ip(const char *node, int flags, struct in_addr *ip) {
  if (!node) {
    ip->s_addr = htonl((flags & AI_PASSIVE) ? INADDR_ANY : INADDR_LOOPBACK);
    return 0;
  }
  if (inet_aton(node, ip)) return 0;
  if (strchr(node, ':')) return EAI_FAMILY; /* an IPv6 literal: this network is IPv4 only */
  if (flags & AI_NUMERICHOST) return EAI_NONAME;
  if (is_localhost(node)) {
    ip->s_addr = htonl(INADDR_LOOPBACK);
    return 0;
  }
  return EAI_NONAME;
}

int getaddrinfo(const char *restrict node, const char *restrict service,
                const struct addrinfo *restrict hints, struct addrinfo **restrict res) {
  int flags = hints ? hints->ai_flags : 0;
  int family = hints ? hints->ai_family : AF_UNSPEC;
  int socktype = hints && hints->ai_socktype ? hints->ai_socktype : SOCK_STREAM;
  int port, r;
  struct in_addr ip;
  if (!node && !service) return EAI_NONAME;
  if (family == AF_INET6) return EAI_NONAME; /* no IPv6 addresses here */
  if (family != AF_UNSPEC && family != AF_INET) return EAI_FAMILY;
  if ((r = service_port(service, flags, &port)) != 0) return r;
  if ((r = host_ip(node, flags, &ip)) != 0) return r;
  struct slicc_ai *out = calloc(1, sizeof *out);
  if (!out) return EAI_MEMORY;
  out->sin.sin_family = AF_INET;
  out->sin.sin_port = htons((unsigned short)port);
  out->sin.sin_addr = ip;
  out->ai.ai_family = AF_INET;
  out->ai.ai_socktype = socktype;
  out->ai.ai_protocol = hints && hints->ai_protocol ? hints->ai_protocol
                        : socktype == SOCK_DGRAM   ? IPPROTO_UDP
                                                   : IPPROTO_TCP;
  out->ai.ai_addrlen = sizeof out->sin;
  out->ai.ai_addr = (struct sockaddr *)&out->sin;
  if (flags & AI_CANONNAME) {
    out->ai.ai_canonname = strdup(node ? node : "localhost");
    if (!out->ai.ai_canonname) {
      free(out);
      return EAI_MEMORY;
    }
  }
  *res = &out->ai;
  return 0;
}

void freeaddrinfo(struct addrinfo *ai) {
  while (ai) {
    struct addrinfo *next = ai->ai_next;
    free(ai->ai_canonname);
    free(ai); /* ai is the head of its struct slicc_ai */
    ai = next;
  }
}
