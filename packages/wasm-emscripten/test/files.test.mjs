// homescoop#205: build.sh writes package.json's "files" for the next real
// build. npm matches those entries case-sensitively on Linux, so "Media"
// packed nothing of the staged media/ (it matched only on macOS, where
// 6.0.9-11 was packed). Checked against the built tarball (ladder-pr's
// .homescoop-out/package.tgz, or HOMESCOOP_TGZ): every entry of build.sh's
// list names a top-level entry of it with exactly that spelling, and every
// top-level entry is named by one, so a Linux `npm pack` of the next real
// build keeps all of it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = new URL('..', import.meta.url);
const tgz = process.env.HOMESCOOP_TGZ || fileURLToPath(new URL('../../.homescoop-out/package.tgz', here));

function buildShFiles() {
  return JSON.parse(readFileSync(new URL('package/package.json', here), 'utf8')).files;
}

/** Top-level names in the tarball's package/, and every path. */
function tarball() {
  assert.ok(existsSync(tgz), `no tarball at ${tgz}`);
  const paths = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
  const top = new Set(paths.map((p) => p.replace(/^package\//, '').split('/')[0]).filter(Boolean));
  return { paths, top: [...top] };
}

const matches = (entry, name) => (entry.startsWith('*.') ? name.endsWith(entry.slice(1)) : entry === name);

test('build.sh files entries name the tarball exactly (case-sensitive)', () => {
  const { top } = tarball();
  assert.ok(top.includes('emcc.py'), `${tgz} is not a wasm-emscripten tarball (no emcc.py)`);
  const missing = buildShFiles().filter((f) => !top.some((n) => matches(f, n)));
  const near = missing.map((f) => `${f} (there: ${top.filter((n) => n.toLowerCase() === f.toLowerCase()).join(', ') || 'nothing'})`);
  assert.deepEqual(near, [], `build.sh files entries that match nothing in the tarball: ${near.join('; ')}`);
});

test('every top-level entry of the tarball is in build.sh files', () => {
  const files = buildShFiles();
  const dropped = tarball().top.filter((n) => n !== 'package.json' && !files.some((f) => matches(f, n)));
  assert.deepEqual(dropped, [], `npm pack of the next build would drop: ${dropped.join(', ')}`);
});

test('media/ (the logos) is in the tarball', () => {
  const { paths } = tarball();
  for (const f of ['logo.png', 'logo.svg', 'powered_by_logo.png']) assert.ok(paths.includes(`package/media/${f}`), `no package/media/${f}`);
});

test('every file LICENSE cites, and SECURITY.md, is in the tarball (homescoop#538)', () => {
  const { paths } = tarball();
  const lic = execFileSync('tar', ['-xzOf', tgz, 'package/LICENSE'], { encoding: 'utf8' });
  const cited = [...new Set([...lic.matchAll(/see (\S+) file/g)].map((m) => m[1]))];
  assert.ok(cited.includes('AUTHORS'), 'LICENSE no longer cites AUTHORS; update this test');
  for (const f of [...cited, 'SECURITY.md']) assert.ok(paths.includes(`package/${f}`), `the tarball lacks package/${f}, which LICENSE cites`);
});

test("lib/slicc carries today's shims: the inherited-ignore seed and the strong flock() (homescoop#973, #947)", () => {
  const obj = (n) => execFileSync('tar', ['-xzOf', tgz, `package/lib/slicc/${n}`], { maxBuffer: 1 << 26 }).toString('latin1');
  assert.match(obj('slicc_signals.o'), /slicc_sig_inherited_js/, 'slicc_signals.o has no slicc_sig_inherited_js (the #973 constructor)');
  assert.match(obj('slicc_libc_gaps.o'), /__syscall_flock/, 'slicc_libc_gaps.o has no __syscall_flock (the #947 flock)');
});

test('tools/system_libs.py walks musl in name order, so libc member names are the same on every host (homescoop#1328, patch 0013)', () => {
  const src = execFileSync('tar', ['-xzOf', tgz, 'package/tools/system_libs.py'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.match(src, /dirnames\.sort\(\)\n\n {6}for f in sorted\(filenames\):/, 'libc.get_files walks os.walk in filesystem order');
});

test('lib/slicc ships slicc-env.js and the default link adds it, so a program sees only the environment the kernel passes (homescoop#1531, package patch 0015)', () => {
  const { paths } = tarball();
  assert.ok(paths.includes('package/lib/slicc/slicc-env.js'), 'the tarball lacks package/lib/slicc/slicc-env.js');
  const env = execFileSync('tar', ['-xzOf', tgz, 'package/lib/slicc/slicc-env.js'], { encoding: 'utf8' });
  assert.match(env, /\$getEnvStrings:/, 'lib/slicc/slicc-env.js does not replace $getEnvStrings');
  const link = execFileSync('tar', ['-xzOf', tgz, 'package/tools/link.py'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.match(link, /for js in \('slicc-writev\.js', 'slicc-linkat\.js', 'slicc-uname\.js', 'slicc-env\.js'\):/, "tools/link.py's default link does not add slicc-env.js");
});

test('FS.lookupPath follows 40 symlinks, as Linux does (homescoop#611, package patch 0014)', () => {
  const src = execFileSync('tar', ['-xzOf', tgz, 'package/src/lib/libfs.js'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.match(src, /linkloop: for \(var nlinks = 0; nlinks <= \{\{\{ cDefs\.SYMLOOP_MAX \}\}\}; nlinks\+\+\)/, 'src/lib/libfs.js stops at 39 symlink follows');
});

test('THIRD-PARTY-NOTICES.md carries the slicc shims notice for lib/slicc (homescoop#1536)', () => {
  const { paths } = tarball();
  assert.ok(paths.includes('package/THIRD-PARTY-NOTICES.md'), 'the tarball has no THIRD-PARTY-NOTICES.md');
  const notices = execFileSync('tar', ['-xzOf', tgz, 'package/THIRD-PARTY-NOTICES.md'], { encoding: 'utf8' });
  assert.match(notices, /^## homescoop: the slicc shims \(shims\/slicc, Apache-2\.0\)$/m);
  assert.match(notices, /Apache License\s+Version 2\.0/);
});

test('realpath() follows 40 symlinks, as glibc does: the default link adds lib/slicc/libslicc_realpath.a, musl realpath.c with the <= bound (homescoop#1631, package patches 0016 and libc/0017)', () => {
  const { paths } = tarball();
  const src = execFileSync('tar', ['-xzOf', tgz, 'package/system/lib/libc/musl/src/misc/realpath.c'], { encoding: 'utf8' });
  assert.match(src, /if \(cnt\+\+ == SYMLOOP_MAX\) \{/, "musl's realpath.c stops at 39 symlink follows");
  assert.ok(paths.includes('package/lib/slicc/libslicc_realpath.a'), 'the tarball lacks package/lib/slicc/libslicc_realpath.a');
  const members = arMembers(execFileSync('tar', ['-xzOf', tgz, 'package/lib/slicc/libslicc_realpath.a'], { maxBuffer: 1 << 26 }));
  const defs = members.filter((m) => m.data.subarray(0, 4).toString('latin1') === '\0asm' && wasmSymbols(m.data).some((s) => s.name === 'realpath' && s.defined && s.binding === 'global'));
  assert.deepEqual(defs.map((m) => m.name), ['slicc_realpath.o'], 'lib/slicc/libslicc_realpath.a has no wasm member slicc_realpath.o that defines realpath');
  const link = execFileSync('tar', ['-xzOf', tgz, 'package/tools/link.py'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.match(link, ARCHIVES, "tools/link.py's default link does not add lib/slicc/libslicc_realpath.a");
});

test("a program's own realpath wins: no object the default link always adds defines realpath, which is only an archive member (homescoop#1664, package patch 0016)", () => {
  const { paths } = tarball();
  const link = execFileSync('tar', ['-xzOf', tgz, 'package/tools/link.py'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const tuple = link.match(/for obj in \(([^)]*'slicc_spawn\.o'[^)]*)\):/);
  assert.ok(tuple, "tools/link.py has no default-link object tuple");
  const objs = [...tuple[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(objs.includes('slicc_spawn.o') && objs.every((o) => o.endsWith('.o')), `the default-link tuple is not a list of objects: ${objs.join(', ')}`);
  const strong = objs.filter((o) => paths.includes(`package/lib/slicc/${o}`)).filter((o) => {
    const data = execFileSync('tar', ['-xzOf', tgz, `package/lib/slicc/${o}`], { maxBuffer: 1 << 26 });
    return wasmSymbols(data).some((s) => s.name === 'realpath' && s.defined && s.binding !== 'local');
  });
  assert.deepEqual(strong, [], `the default link always adds ${strong.join(', ')}, which defines realpath, so a program that defines realpath gets duplicate symbol: realpath`);
  assert.ok(!paths.includes('package/lib/slicc/slicc_realpath.o'), 'the tarball still ships lib/slicc/slicc_realpath.o as a plain object');
});

const ARCHIVES = /for lib in \('libslicc_jobs\.a', 'libslicc_realpath\.a'\):\n {6}path = os\.path\.join\(slicc_lib, lib\)\n {6}if not linkable and os\.path\.isfile\(path\) and path not in linker_args:\n {8}linker_args\.append\(path\)\n/;
const LIBC_OWN = ['kill', 'nanosleep', 'poll', 'pselect', 'realpath', 'setegid', 'seteuid', 'setgid', 'setregid', 'setresgid', 'setresuid', 'setreuid', 'setuid', 'tcgetpgrp', 'tcsetpgrp'];

function defaultLink() {
  const link = execFileSync('tar', ['-xzOf', tgz, 'package/tools/link.py'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const tuple = link.match(/for obj in \(([^)]*'slicc_spawn\.o'[^)]*)\):/);
  assert.ok(tuple, 'tools/link.py has no default-link object tuple');
  return { link, objs: [...tuple[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) };
}

const defines = (data, names) => wasmSymbols(data).filter((s) => names.includes(s.name) && s.defined && s.binding !== 'local').map((s) => s.name);

test("a program's own tcgetpgrp and tcsetpgrp win: no object the default link always adds defines them, and lib/slicc/libslicc_jobs.a has one member per override (homescoop#1678, package patch 0018)", () => {
  const { paths } = tarball();
  const { link, objs } = defaultLink();
  const tc = ['tcgetpgrp', 'tcsetpgrp'];
  const always = objs.filter((o) => paths.includes(`package/lib/slicc/${o}`)).flatMap((o) => defines(execFileSync('tar', ['-xzOf', tgz, `package/lib/slicc/${o}`], { maxBuffer: 1 << 26 }), tc).map((s) => `${o} (${s})`));
  assert.deepEqual(always, [], `the default link always adds ${always.join(', ')}, so a program that defines it gets duplicate symbol`);
  assert.ok(paths.includes('package/lib/slicc/libslicc_jobs.a'), 'the tarball lacks package/lib/slicc/libslicc_jobs.a');
  const members = arMembers(execFileSync('tar', ['-xzOf', tgz, 'package/lib/slicc/libslicc_jobs.a'], { maxBuffer: 1 << 26 }));
  assert.deepEqual(members.map((m) => [m.name, defines(m.data, tc)]), [['slicc_tcgetpgrp.o', ['tcgetpgrp']], ['slicc_tcsetpgrp.o', ['tcsetpgrp']]], 'lib/slicc/libslicc_jobs.a is not one member per override');
  assert.match(link, ARCHIVES, "tools/link.py's default link does not add lib/slicc/libslicc_jobs.a");
});

test('-sMAIN_MODULE=1 and -sLINKABLE links take lib/slicc/linkable, which defines none of libc.a\'s own symbols, and leave the override archives out (homescoop#1678, package patch 0018)', () => {
  const { paths } = tarball();
  const { link, objs } = defaultLink();
  assert.match(link, /linkable = settings\.MAIN_MODULE == 1 or settings\.LINKABLE\n/, 'tools/link.py does not tell -sMAIN_MODULE=1 and -sLINKABLE links apart');
  assert.match(link, /linkable_path = os\.path\.join\(slicc_lib, 'linkable', obj\)\n {6}if linkable and os\.path\.isfile\(linkable_path\):\n {8}path = linkable_path\n/, 'tools/link.py does not take lib/slicc/linkable for -sMAIN_MODULE=1 and -sLINKABLE links');
  assert.match(link, ARCHIVES, 'tools/link.py adds the override archives to -sMAIN_MODULE=1 links, which wrap them in --whole-archive');
  const missing = objs.filter((o) => !paths.includes(`package/lib/slicc/linkable/${o}`));
  assert.deepEqual(missing, [], `the tarball lacks lib/slicc/linkable/${missing.join(', ')}, so -sMAIN_MODULE=1 links the plain objects, which libc.a duplicates`);
  const dup = objs.flatMap((o) => defines(execFileSync('tar', ['-xzOf', tgz, `package/lib/slicc/linkable/${o}`], { maxBuffer: 1 << 26 }), LIBC_OWN).map((s) => `${o} (${s})`));
  assert.deepEqual(dup, [], `lib/slicc/linkable defines libc.a's own ${dup.join(', ')}, so -sMAIN_MODULE=1 gets duplicate symbol`);
});

function arMembers(buf) {
  assert.equal(buf.subarray(0, 8).toString('latin1'), '!<arch>\n', 'not an ar archive');
  const out = [];
  let longNames = '';
  for (let off = 8; off + 60 <= buf.length;) {
    const head = buf.subarray(off, off + 60).toString('latin1');
    const size = Number.parseInt(head.slice(48, 58).trim(), 10);
    const data = buf.subarray(off + 60, off + 60 + size);
    let name = head.slice(0, 16).trim();
    if (name === '//') longNames = data.toString('latin1');
    else if (name !== '/' && name !== '/SYM64/') {
      if (/^\/\d+$/.test(name)) name = longNames.slice(Number(name.slice(1))).split('\n')[0];
      out.push({ name: name.replace(/\/$/, ''), data });
    }
    off += 60 + size + (size % 2);
  }
  return out;
}

function wasmSymbols(buf) {
  let pos = 8;
  const u = () => {
    let r = 0;
    let shift = 0;
    for (;;) {
      const b = buf[pos++];
      r += (b & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(b & 0x80)) return r;
    }
  };
  const str = () => {
    const n = u();
    const s = buf.subarray(pos, pos + n).toString('utf8');
    pos += n;
    return s;
  };
  const syms = [];
  while (pos < buf.length) {
    const id = buf[pos++];
    const size = u();
    const end = pos + size;
    if (id === 0 && str() === 'linking') {
      u();
      while (pos < end) {
        const sub = buf[pos++];
        const subEnd = pos + u();
        if (sub === 8) {
          for (let n = u(); n > 0; n--) {
            const kind = buf[pos++];
            const flags = u();
            const defined = !(flags & 0x10);
            let name = '';
            if (kind === 1) {
              name = str();
              if (defined) { u(); u(); u(); }
            } else if (kind === 3) {
              u();
            } else {
              u();
              if (defined || flags & 0x40) name = str();
            }
            syms.push({ name, defined, binding: ['global', 'weak', 'local'][flags & 3] });
          }
        }
        pos = subEnd;
      }
    }
    pos = end;
  }
  return syms;
}
