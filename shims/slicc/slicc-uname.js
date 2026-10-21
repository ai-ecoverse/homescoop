// The default body of the env.__syscall_uname import (slicc_libc_gaps.c). A
// kernel that answers uname(2) itself (slicc-kernel#625) replaces it; older
// ones run this. The node name is /etc/hostname's first line, else HOSTNAME,
// else "slicc", as wasix-sysroot -36 and later (homescoop#1462): the kernel
// stops setting HOSTNAME (slicc-kernel#1296).
addToLibrary({
  __syscall_uname__sig: 'ip',
  __syscall_uname__deps: ['$stringToUTF8', '$FS', '$ENV'],
  __syscall_uname: (buf) => {
    if (!buf) return -21;
    let node = '';
    try {
      node = FS.readFile('/etc/hostname', { encoding: 'utf8' }).split('\n')[0].trim();
    } catch (e) {}
    if (!node && typeof ENV.HOSTNAME === 'string') node = ENV.HOSTNAME;
    if (!node) node = 'slicc';
    ['Emscripten', node, '{{{ EMSCRIPTEN_VERSION.split("-")[0] }}}', '#1', '{{{ MEMORY64 ? "wasm64" : "wasm32" }}}'].forEach((field, i) => stringToUTF8(field, buf + i * 65, 65));
    return 0;
  },
});
