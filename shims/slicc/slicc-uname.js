addToLibrary({
  __syscall_uname__sig: 'ip',
  __syscall_uname__deps: ['$stringToUTF8'],
  __syscall_uname: (buf) => {
    if (!buf) return -21;
    ['Emscripten', 'emscripten', '{{{ EMSCRIPTEN_VERSION.split("-")[0] }}}', '#1', '{{{ MEMORY64 ? "wasm64" : "wasm32" }}}'].forEach((field, i) => stringToUTF8(field, buf + i * 65, 65));
    return 0;
  },
});
