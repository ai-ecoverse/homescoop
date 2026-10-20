import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SHIM_HEADING, SLICC_SHIM_MARK, shimNoticeErrors } from '../shim-notice.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const apache = readFileSync(join(root, 'LICENSE'), 'utf8');

function build(script) {
  const dir = mkdtempSync(join(tmpdir(), 'shim-notice-'));
  try {
    const em = join(dir, 'em');
    mkdirSync(join(em, 'system/lib/libc/musl'), { recursive: true });
    mkdirSync(join(em, 'system/lib/libcxx'), { recursive: true });
    for (const [f, t] of [['LICENSE', 'Emscripten licence'], ['system/lib/libc/musl/COPYRIGHT', 'musl copyright'], ['system/lib/libcxx/LICENSE.TXT', 'libc++ licence']]) writeFileSync(join(em, f), `${t}\n`);
    writeFileSync(join(em, 'emcc'), `#!/usr/bin/env bash\nif [[ "$1" == -dumpversion ]]; then echo 5.0.0; exit 0; fi\nwhile (($#)); do [[ "$1" == -o ]] && { : > "$2"; shift; }; shift; done\n`);
    writeFileSync(join(em, 'emar'), '#!/usr/bin/env bash\n: > "$2"\n');
    chmodSync(join(em, 'emcc'), 0o755);
    chmodSync(join(em, 'emar'), 0o755);
    const pkg = join(dir, 'pkg');
    const r = spawnSync('bash', ['-c', `source "$HOMESCOOP_ROOT/scripts/build-common.sh"\nHOMESCOOP_PKG="${pkg}"\n${script}\ncat "$HOMESCOOP_NOTICES"`], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${em}:${process.env.PATH}`, HOMESCOOP_ROOT: root, HOMESCOOP_WORK: join(dir, 'work'), PREFIX: join(dir, 'prefix') },
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const headings = (md) => md.split('\n').filter((l) => l.startsWith('## '));

test('homescoop_notice_emscripten adds the slicc shims section after homescoop_slicc_archive, once (#853)', () => {
  const linked = build('homescoop_slicc_archive "$WORK/s/libslicc.a" cli\nhomescoop_notices_begin "x.wasm links:"\nhomescoop_notice_emscripten\nhomescoop_notice_slicc_shims');
  assert.deepEqual(headings(linked), ['## Emscripten 5.0.0 (runtime and system libraries)', '## homescoop: the slicc shims (shims/slicc, Apache-2.0)']);
  assert.ok(linked.includes(apache.trim().split('\n')[0].trim()), 'the section carries the repo LICENSE');
  assert.match(linked, SHIM_HEADING);
  assert.deepEqual(shimNoticeErrors('bin/x.wasm', { files: ['THIRD-PARTY-NOTICES.md'] }, linked), []);
  const plain = build('homescoop_notices_begin "x.wasm links:"\nhomescoop_notice_emscripten');
  assert.deepEqual(headings(plain), ['## Emscripten 5.0.0 (runtime and system libraries)'], 'no shims archive, no section');
  const named = build('homescoop_slicc_archive "$WORK/s/libslicc.a" gaps\nhomescoop_notices_begin "x"\nhomescoop_notice_slicc_shims "wasm-stubs.c and the slicc shims"\nhomescoop_notice_emscripten');
  assert.deepEqual(headings(named), ['## homescoop: wasm-stubs.c and the slicc shims (shims/slicc, Apache-2.0)', '## Emscripten 5.0.0 (runtime and system libraries)']);
});

test('shimNoticeErrors: a wasm with the shims needs the section, its Apache text and files[] (#853)', () => {
  const ok = `# Third-party notices\n\n## homescoop: the slicc shims (shims/slicc, Apache-2.0)\n\n\`\`\`text\n${apache}\n\`\`\`\n`;
  const files = { files: ['LICENSE', 'THIRD-PARTY-NOTICES.md'] };
  assert.deepEqual(shimNoticeErrors('bin/a.wasm', files, ok), []);
  assert.match(shimNoticeErrors('bin/a.wasm', files, null)[0], /ships no THIRD-PARTY-NOTICES\.md/);
  assert.match(shimNoticeErrors('bin/a.wasm', files, '# Third-party notices\n\n## Emscripten 5.0.0\n')[0], /no "## homescoop: … slicc shims/);
  assert.match(shimNoticeErrors('bin/a.wasm', files, '## homescoop: the slicc shims (Apache-2.0)\n\nsee LICENSE\n')[0], /lacks the Apache-2\.0 text/);
  assert.match(shimNoticeErrors('bin/a.wasm', { files: ['LICENSE'] }, ok)[0], /files\[\] must include/);
  assert.ok(Buffer.from('\0asm..slicc_sig_mask..').includes(SLICC_SHIM_MARK));
});

test('every build script that makes a slicc shims archive writes the shims notice (#853)', () => {
  const bad = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const dir = join(root, 'packages', name);
    if (!existsSync(join(dir, 'build.sh'))) continue;
    let text = readdirSync(dir).filter((f) => f.endsWith('.sh')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    for (const m of text.matchAll(/scripts\/(build-[\w-]+\.sh)/g)) if (existsSync(join(root, 'scripts', m[1]))) text += `\n${readFileSync(join(root, 'scripts', m[1]), 'utf8')}`;
    const code = text.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    const archive = code.search(/(^|[\s;&|])homescoop_slicc_archive\s/m);
    if (archive < 0) continue;
    const notice = code.slice(archive).search(/(^|[\s;&|])homescoop_notice_(emscripten|slicc_shims)(\s|$)/m);
    if (notice < 0) bad.push(name);
  }
  assert.deepEqual(bad, [], 'these build scripts link the slicc shims but call neither homescoop_notice_emscripten nor homescoop_notice_slicc_shims after homescoop_slicc_archive');
});
