// --pre-js for programs built inside slicc: when the program runs in a slicc
// node realm, mount the live VFS into its FS before main (the realm's `fs`
// has no file descriptors, so NODERAWFS cannot work there), and write open
// dirty buffers back when it ends. Elsewhere this is a no-op.
//
// emcc links it into every program when SLICC_VFS_PRE_JS is set (see
// patches/emscripten-slicc-configure.patch); by hand:
//
//   emcc prog.c -o prog.js --pre-js /emscripten/slicc/lib/slicc-vfs-pre.js
if (typeof globalThis.__slicc_mountVfs === 'function') {
  let sliccVfs;
  const sliccFlush = () => sliccVfs?.flush();
  // Checked in preRun, not here: the library's `var FS` and `var ENV` are
  // hoisted but not yet assigned while this pre-js runs.
  Module.preRun = [].concat(Module.preRun || [], () => {
    // environ is Emscripten's ENV (fake defaults like PATH=/) unless the
    // realm's environment is copied in: pkgconf needs PKG_CONFIG_PATH, for one.
    if (typeof ENV === 'object' && ENV) Object.assign(ENV, process.env);
    // A program that never touches files is built without FS (and without
    // addRunDependency): there is nothing to mount. Under run-tool.js (a tool
    // of the toolchain itself), that host mounts the VFS.
    if (typeof FS !== 'object' || !FS || Module.sliccVfsHosted) return;
    // Without a mountable FS (a program linked with only the minimal stdio FS
    // has no FS.filesystems / FS.mount) there is nothing to mount either.
    if (typeof addRunDependency !== 'function' || !FS.filesystems || !FS.mount) return;
    addRunDependency('slicc-vfs');
    globalThis.__slicc_mountVfs(FS, { cwd: process.cwd() }).then(
      (handle) => {
        sliccVfs = handle;
        removeRunDependency('slicc-vfs');
      },
      (e) => {
        err(`slicc: live VFS mount failed: ${e}`);
        removeRunDependency('slicc-vfs');
      }
    );
  });
  // main returning (postRun) and exit() (onExit) both end the program.
  Module.postRun = [].concat(Module.postRun || [], sliccFlush);
  const onExit = Module.onExit;
  Module.onExit = (code) => {
    sliccFlush();
    onExit?.(code);
  };
}
