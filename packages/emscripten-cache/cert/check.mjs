import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const tarballArg = args[args.indexOf('--tarball') + 1];
if (!args.includes('--tarball') || !tarballArg) {
  console.error('usage: check.mjs --tarball <emscripten-cache package.tgz | npm spec>');
  process.exit(2);
}
const sh = (cmd, argv, o = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...o }).toString();
const work = mkdtempSync(join(tmpdir(), 'emscripten-cache-cert-'));
const treeCache = process.env.HOMESCOOP_EM_TREE_CACHE || join(work, 'tree');
try {
  let tgz = resolve(tarballArg);
  if (!statSync(tgz, { throwIfNoEntry: false })) tgz = join(work, sh('npm', ['pack', '--silent', '--pack-destination', work, tarballArg]).trim().split('\n').pop());
  sh('tar', ['xzf', tgz, '-C', work]);
  const pkg = join(work, 'package');
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  console.log(`== ${manifest.name}@${manifest.version}`);
  const libdir = join(pkg, 'sysroot/lib/wasm32-emscripten');
  const want = readFileSync(join(root, 'packages/emscripten-cache/libs.txt'), 'utf8').split('\n').filter(Boolean);
  const missing = want.filter((l) => !existsSync(join(libdir, /^crt1/.test(l) ? `${l}.o` : `${l}.a`)));
  assert.deepEqual(missing, [], `libraries in libs.txt missing from sysroot/lib/wasm32-emscripten: ${missing.join(' ')}`);
  for (const l of want.filter((x) => !/^crt1/.test(x))) {
    const head = readFileSync(join(libdir, `${l}.a`)).subarray(0, 8).toString('latin1');
    assert.equal(head, '!<arch>\n', `${l}.a is an archive`);
  }
  const alltypes = readFileSync(join(pkg, 'sysroot/include/bits/alltypes.h'), 'utf8');
  assert.match(alltypes, /typedef struct __sigset_t \{ unsigned long __bits\[128\/sizeof\(long\)\]; \} sigset_t;/, 'the 128-byte musl sigset_t (patch 0007)');
  assert.ok(existsSync(join(pkg, 'stamps/sysroot_install.stamp')), 'stamps/sysroot_install.stamp');
  assert.equal(readFileSync(join(pkg, 'EMSCRIPTEN_VERSION'), 'utf8').trim(), '6.0.9-git');
  console.log(`== ${want.length} libraries, 128-byte sigset_t, stamp and version`);
  const leaks = want.flatMap((l) => {
    const m = readFileSync(join(pkg, 'sysroot/lib/wasm32-emscripten', /^crt1/.test(l) ? `${l}.o` : `${l}.a`), 'latin1').match(/\/(?:home|Users|__w|private\/var)\/[\x21-\x7e]{0,80}/);
    return m ? [`${l}: ${m[0]}`] : [];
  });
  assert.deepEqual(leaks, [], `libraries name a build path in their DWARF (patch 0011 maps the cache and the llvm root): ${leaks.slice(0, 3).join(' | ')}`);
  console.log('== no library names a build path');
  // homescoop#1328: libc's musl sources are walked in name order (wasm-emscripten
  // patch 0013), so exit/_Exit.c is _Exit.o and unistd/_exit.c _exit__1.o on
  // every host; os.walk's filesystem order made it a coin flip between runners.
  // --member-order: this package's own ci row; wasm-emscripten's pinned-cache.mjs
  // also runs this file on 6.0.9-4, whose names are the other way round.
  const members = (buf) => {
    const out = [];
    let names = '';
    for (let p = 8; p + 60 <= buf.length; ) {
      const raw = buf.toString('latin1', p, p + 16).trimEnd();
      const size = Number(buf.toString('latin1', p + 48, p + 58).trim());
      if (raw === '//') names = buf.toString('latin1', p + 60, p + 60 + size);
      else if (raw !== '/' && raw !== '/SYM64/') {
        const n = raw.startsWith('/') ? names.slice(Number(raw.slice(1))).split('/\n')[0] : raw.replace(/\/$/, '');
        out.push(n);
      }
      p += 60 + size + (size & 1);
    }
    return out;
  };
  for (const lib of args.includes('--member-order') ? ['libc.a', 'libc-debug.a'] : []) {
    const names = members(readFileSync(join(pkg, 'sysroot/lib/wasm32-emscripten', lib)));
    const exits = names.filter((n) => /^_exit(__\d+)?\.o$/i.test(n));
    assert.deepEqual(exits, ['_Exit.o', '_exit__1.o'], `${lib}: the _Exit/_exit members are ${exits.join(', ')}, not the name-ordered _Exit.o, _exit__1.o (homescoop#1328)`);
  }
  if (args.includes('--member-order')) console.log('== libc.a and libc-debug.a name _Exit.o and _exit__1.o (musl walked in name order)');

  const out = sh('bash', [join(root, 'scripts/emscripten-tree.sh'), treeCache], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ex = Object.fromEntries(out.trim().split('\n').map((l) => l.replace(/^export /, '').split('=')).map(([k, ...v]) => [k, v.join('=').replace(/^'(.*)'$/, '$1')]));
  const t = { EM: ex.EMSCRIPTEN_TREE, LLVM: ex.EMSDK_RELEASE_LLVM, BINARYEN: ex.EMSDK_RELEASE_BINARYEN };
  const cache = join(work, 'cache');
  mkdirSync(cache);
  symlinkSync(join(pkg, 'sysroot'), join(cache, 'sysroot'));
  copyFileSync(join(pkg, 'stamps/sysroot_install.stamp'), join(cache, 'sysroot_install.stamp'));
  const cfg = join(work, 'config.py');
  writeFileSync(cfg, `LLVM_ROOT = ${JSON.stringify(t.LLVM)}\nBINARYEN_ROOT = ${JSON.stringify(t.BINARYEN)}\nNODE_JS = ${JSON.stringify(process.execPath)}\nCACHE = ${JSON.stringify(cache)}\nFROZEN_CACHE = True\n`);
  const env = { ...process.env, EM_CONFIG: cfg, SLICC_EMCC_PLAIN: '1' };
  const run = join(work, 'run');
  mkdirSync(run);
  writeFileSync(join(run, 'hello.c'), '#include <stdio.h>\n#include <string.h>\n#include <signal.h>\nint main(void){ sigset_t s; sigemptyset(&s); printf("hello %d %zu\\n", 6*7, sizeof(struct sigaction)); return strcmp("a","a"); }\n');
  writeFileSync(join(run, 'eh.cpp'), '#include <cstdio>\n#include <stdexcept>\n#include <string>\n#include <vector>\nint main(){ std::vector<std::string> v{"x","y"}; try { throw std::runtime_error("boom " + v[1]); } catch (const std::exception &e) { std::printf("caught %s\\n", e.what()); } return 0; }\n');
  sh('python3', [join(t.EM, 'emcc.py'), '-O2', 'hello.c', '-o', 'hello.js'], { cwd: run, env });
  assert.equal(sh(process.execPath, ['hello.js'], { cwd: run }), 'hello 42 140\n', 'C links against the frozen sysroot; struct sigaction is 140 bytes');
  writeFileSync(join(run, 'newer.c'), '#define _GNU_SOURCE\n#include <poll.h>\n#include <sys/epoll.h>\n#include <stdio.h>\nint main(void){ int e = epoll_create1(0); struct timespec ts = {0, 0}; int p = ppoll(0, 0, &ts, 0); printf("epoll %d ppoll %d\\n", e >= 0 || e == -1, p); return 0; }\n');
  let linked = true;
  try {
    sh('python3', [join(t.EM, 'emcc.py'), '-O2', 'newer.c', '-o', 'newer.js'], { cwd: run, env });
  } catch (e) {
    linked = false;
    console.log(`   newer.c: ${`${e.stderr}`.split('\n').filter((l) => /undefined symbol/.test(l)).join(' | ')}`);
  }
  assert.ok(linked, 'libc.a has what the 6.0.9 headers declare: epoll_create1 and ppoll link (the libraries and the headers come from one emscripten tree)');
  sh(process.execPath, ['newer.js'], { cwd: run });
  sh('python3', [join(t.EM, 'em++.py'), '-O2', '-fwasm-exceptions', 'eh.cpp', '-o', 'eh.js'], { cwd: run, env });
  assert.equal(sh(process.execPath, ['eh.js'], { cwd: run }), 'caught boom y\n', 'C++ with wasm exceptions (libc++/libc++abi/libunwind -wasmexcept)');
  sh('python3', [join(t.EM, 'em++.py'), '-O2', '-fexceptions', 'eh.cpp', '-o', 'eh2.js'], { cwd: run, env });
  assert.equal(sh(process.execPath, ['eh2.js'], { cwd: run }), 'caught boom y\n', 'C++ with JS exceptions (-legacyexcept)');
  console.log(`PASS ${manifest.name}@${manifest.version}: every library in libs.txt, and C and C++ (wasm and JS exceptions) link against the frozen sysroot and run`);
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}${e.stderr ? `\n${e.stderr}` : ''}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
