// writev/fd_write as one write (wasm-bash 5.3.0-11): emscripten 4.0.23's doWritev
// calls FS.write once per iovec. musl flushes a line-buffered stdout with a
// two-iovec writev (the buffered "one" and the "\n"), so a pipe or terminal
// reader sees two writes where a real system call delivers one. The
// emscripten that built wasm-bash 5.3.0-7 gathered the iovecs into one
// FS.write (as __syscall_sendmsg does); this restores that for every CLI
// linked with homescoop_em_cli_ldflags.
addToLibrary({
  $doWritev__deps: ['$FS'],
  $doWritev: (stream, iov, iovcnt, offset) => {
    if (iovcnt == 1) {
      return FS.write(stream, HEAP8, HEAPU32[iov >> 2], HEAPU32[(iov + 4) >> 2], offset);
    }
    var total = 0;
    for (var i = 0, p = iov; i < iovcnt; i++, p += 8) {
      total += HEAPU32[(p + 4) >> 2];
    }
    var view = new Uint8Array(total);
    var voff = 0;
    for (var i = 0; i < iovcnt; i++, iov += 8) {
      var ptr = HEAPU32[iov >> 2];
      var len = HEAPU32[(iov + 4) >> 2];
      view.set(HEAPU8.subarray(ptr, ptr + len), voff);
      voff += len;
    }
    return FS.write(stream, view, 0, total, offset);
  },
});
