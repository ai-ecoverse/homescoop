# `@ai-ecoverse/wasm-screen`

GNU screen 5.0.1 for slicc (Emscripten ABI). Needs SLICC PTY ioctls
(PR #3733). Dist-tag `next` only until the kernel lands.

Sockets: `SCREENDIR=/tmp/screens` (no global SOCKET_DIR). `screen -ls` may
show nothing — AF_UNIX paths are not VFS-readdir visible yet.
