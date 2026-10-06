// fork() for Emscripten programs in a slicc node realm: see slicc_fork.c.
//
// Run main with Module.sliccRunMain(args) instead of callMain. A fork()
// unwinds the call stack (Asyncify) back to sliccRunMain, which snapshots the
// parent and rewinds the child (fork returns 0). When the child exits, the
// snapshot is restored and the parent rewound (fork returns the child's pid).
// Children nest: the snapshots form a stack, innermost last.
//
// Per process (restored with the parent): linear memory, the stack pointer,
// the Asyncify data of the fork, FS.streams (the child runs on dup()ed
// clones, closed when it exits, so a pipe sees its writer go away), the cwd,
// and Module.sliccExited, slicc_spawn.c's table of exited children, which is
// what wait4 reaps from. Files and pipe contents are shared, as between real
// processes.
//
// In the wasm realm (Module.sliccKernel) fork is real: the kernel starts a new
// worker with a copy of this process (memory, the Asyncify state of the fork,
// the fd table), which resumes from fork() returning 0 (sliccForkChild), and
// the parent resumes with the child's pid at once. Where the kernel cannot
// fork, the in-process emulation above runs instead; there a child that execs
// does not wait for the program: it ends at once and its pid stands for the
// kernel process from then on (Module.sliccAliases, fork pid -> kernel pid).
addToLibrary({
  $SliccFork__deps: [
    '$Asyncify',
    '$FS',
    '$stackRestore',
    '$handleException',
    '$exitJS',
    '$stringToUTF8OnStack',
    '$stackAlloc',
    '$runtimeKeepalivePop',
  ],
  $SliccFork: {
    // The runtime (the wasm realm's glue trailer) checks this: the keepalive
    // each fork's unwind pushes is popped here (see settle).
    balancesKeepalive: true,
    pid: 100,
    ppid: 1,
    // Asyncify's saved state when the pending fork unwound, and the stack
    // pointer at the fork() call.
    forkSp: 0,
    stack: [],
    // Thrown by proc_exit in a child: unwinds the child to sliccRunMain.
    ChildExit: { toString: () => 'slicc fork: child exit' },
    exitCode: 0,
    // Set by an exec in a child: the kernel pid the child's pid now stands for.
    execPid: 0,

    nextPid() {
      Module.sliccNextPid = (Module.sliccNextPid || 1000) + 1;
      return Module.sliccNextPid;
    },

    // The child's fd table: a dup() of every open descriptor.
    dupStreams(streams) {
      const child = [];
      for (let fd = 0; fd < streams.length; fd++) {
        const s = streams[fd];
        if (!s) continue;
        const c = Object.assign(new FS.FSStream(), s);
        c.fd = fd;
        c.stream_ops?.dup?.(c);
        child[fd] = c;
      }
      return child;
    },

    // Asyncify's call-stack ids as export names: a rewind looks its bottom
    // function up by id, and function objects mean nothing in another worker.
    callStackNames() {
      const names = new Map();
      for (const [name, fn] of Object.entries(wasmExports)) names.set(fn, name);
      const out = [];
      for (const [id, original] of Asyncify.callStackIdToFunc) {
        const name = names.get(Asyncify.funcWrappers.get(original) ?? original);
        if (name) out.push([id, name]);
      }
      return out;
    },

    // Fork into a new kernel process. Returns the child's pid, or -errno
    // (ENOSYS 52 outside the wasm realm).
    kernelFork() {
      const fork = Module.sliccKernel?.fork;
      if (!fork) return -52;
      return fork({
        memory: HEAPU8.slice(),
        currData: Asyncify.currData,
        forkSp: SliccFork.forkSp,
        callStackNames: SliccFork.callStackNames(),
        ppid: SliccFork.pid,
      });
    },

    // Snapshot the parent at its fork() and continue as the child.
    begin() {
      const snap = {
        mem: HEAPU8.slice(),
        sp: SliccFork.forkSp,
        data: Asyncify.currData,
        pid: SliccFork.pid,
        ppid: SliccFork.ppid,
        childPid: SliccFork.nextPid(),
        streams: FS.streams,
        cwd: FS.cwd(),
        exited: Module.sliccExited,
        aliases: Module.sliccAliases,
      };
      SliccFork.stack.push(snap);
      FS.streams = SliccFork.dupStreams(snap.streams);
      Module.sliccExited = new Map();
      Module.sliccAliases = new Map();
      SliccFork.ppid = snap.pid;
      SliccFork.pid = snap.childPid;
      return snap;
    },

    // The innermost child is done (wait status `status`): back to its parent.
    // Returns the child's pid, which the parent's fork() returns.
    finish(status) {
      const snap = SliccFork.stack.pop();
      for (const s of FS.streams) {
        if (!s) continue;
        try {
          FS.close(s);
        } catch (e) {}
      }
      FS.streams = snap.streams;
      try {
        FS.chdir(snap.cwd);
      } catch (e) {}
      Module.sliccExited = snap.exited || new Map();
      Module.sliccAliases = snap.aliases || new Map();
      if (SliccFork.execPid) {
        Module.sliccAliases.set(snap.childPid, SliccFork.execPid);
      } else {
        Module.sliccExited.set(snap.childPid, status);
      }
      SliccFork.execPid = 0;
      SliccFork.pid = snap.pid;
      SliccFork.ppid = snap.ppid;
      HEAPU8.set(snap.mem);
      Asyncify.currData = snap.data;
      Asyncify.state = Asyncify.State.Normal;
      SliccFork.forkSp = snap.sp;
      return snap.childPid;
    },

    // Resume the process whose fork() unwound, with fork() returning `value`.
    // Returns when main returns or a fork unwinds again; throws on exit.
    rewind(value) {
      stackRestore(SliccFork.forkSp);
      Asyncify.handleSleepReturnValue = value;
      Asyncify.state = Asyncify.State.Rewinding;
      _asyncify_start_rewind(Asyncify.currData);
      const original = Asyncify.getDataRewindFunc(Asyncify.currData);
      return Asyncify.funcWrappers.get(original)();
    },

    // Run the rewound process until it returns or forks; a child that exits
    // (or crashes) hands control back to its parent.
    resume(value) {
      for (;;) {
        try {
          return SliccFork.rewind(value);
        } catch (e) {
          if (!SliccFork.stack.length) throw e;
          if (e === SliccFork.ChildExit) {
            value = SliccFork.finish((SliccFork.exitCode & 0xff) << 8);
          } else {
            err(`${thisProgram}: child ${SliccFork.pid} crashed: ${e?.stack || e}`);
            value = SliccFork.finish(6); // killed by SIGABRT
          }
        }
      }
    },

    // Drive forks until main itself returns (a child that returns from main
    // exits with that status).
    settle(ret) {
      for (;;) {
        if (Asyncify.currData) {
          // Only fork() unwinds on purpose; anything else suspending through
          // Asyncify (a libc call Emscripten made async, such as poll) would be
          // snapshotted as a fork and resumed on a zero stack pointer.
          if (!SliccFork.forking) {
            throw new Error(`${thisProgram}: unexpected Asyncify suspension (not a fork)`);
          }
          SliccFork.forking = false;
          // The unwind pushed a runtime keepalive (Asyncify's maybeStopUnwind),
          // and the rewinds below bypass doRewind, which would pop it. Left
          // pushed, exit() skips exitRuntime after the first fork: no atexit
          // handlers, no final stdio flush.
          runtimeKeepalivePop();
          const pid = SliccFork.stack.length ? -1 : SliccFork.kernelFork();
          if (pid > 0) {
            ret = SliccFork.resume(pid);
            continue;
          }
          SliccFork.begin();
          ret = SliccFork.resume(0);
          continue;
        }
        if (!SliccFork.stack.length) return ret;
        ret = SliccFork.resume(SliccFork.finish((ret & 0xff) << 8));
      }
    },
  },

  // The child of a kernel fork, in its new worker: become the parent's copy
  // and resume from fork() returning 0.
  $sliccForkChild__deps: ['$SliccFork', '$Asyncify', '$exitJS', '$handleException', '$growMemory'],
  $sliccForkChild: (state) => {
    if (state.memory.length > HEAPU8.length) growMemory(state.memory.length);
    HEAPU8.set(state.memory);
    const originals = new Map();
    for (const [original, wrapper] of Asyncify.funcWrappers) originals.set(wrapper, original);
    for (const [id, name] of state.callStackNames) {
      const original = originals.get(wasmExports[name]) ?? wasmExports[name];
      Asyncify.callstackFuncToId.set(original, id);
      Asyncify.callStackIdToFunc.set(id, original);
      Asyncify.callStackId = Math.max(Asyncify.callStackId, id + 1);
    }
    SliccFork.pid = state.pid;
    SliccFork.ppid = state.ppid;
    Module.sliccExited = new Map();
    Module.sliccAliases = new Map();
    Asyncify.currData = state.currData;
    SliccFork.forkSp = state.forkSp;
    try {
      const ret = SliccFork.settle(SliccFork.resume(0));
      exitJS(ret, true);
      return ret;
    } catch (e) {
      return handleException(e);
    }
  },

  // callMain, with the forks driven (see SliccFork.settle).
  $sliccRunMain__deps: ['$SliccFork', '$stringToUTF8OnStack', '$stackAlloc', '$exitJS', '$handleException'],
  $sliccRunMain: (args = []) => {
    args = [thisProgram, ...args];
    const argc = args.length;
    const argv = stackAlloc((argc + 1) * 4);
    let p = argv;
    for (const arg of args) {
      HEAPU32[p >> 2] = stringToUTF8OnStack(arg);
      p += 4;
    }
    HEAPU32[p >> 2] = 0;
    if (Module.sliccPid) SliccFork.pid = Module.sliccPid;
    if (Module.sliccPpid) SliccFork.ppid = Module.sliccPpid;
    try {
      const ret = SliccFork.settle(_main(argc, argv));
      exitJS(ret, true);
      return ret;
    } catch (e) {
      return handleException(e);
    }
  },

  slicc_fork_js__deps: ['$SliccFork', '$Asyncify', 'emscripten_stack_get_current'],
  slicc_fork_js__async: true,
  slicc_fork_js: () =>
    Asyncify.handleSleep(() => {
      SliccFork.forking = true;
      SliccFork.forkSp = _emscripten_stack_get_current();
    }),

  slicc_getpid_js__deps: ['$SliccFork'],
  slicc_getpid_js: () => SliccFork.pid,
  slicc_getppid_js__deps: ['$SliccFork'],
  slicc_getppid_js: () => SliccFork.ppid,

  // A forked child's exit ends only the child (see SliccFork.resume).
  proc_exit__deps: ['$SliccFork', '$ExitStatus', '$keepRuntimeAlive'],
  proc_exit: (code) => {
    if (SliccFork.stack.length) {
      SliccFork.exitCode = code;
      throw SliccFork.ChildExit;
    }
    EXITSTATUS = code;
    if (!keepRuntimeAlive()) {
      Module['onExit']?.(code);
      ABORT = true;
    }
    quit_(code, new ExitStatus(code));
  },
});
