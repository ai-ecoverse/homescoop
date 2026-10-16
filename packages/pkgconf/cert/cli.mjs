/**
 * pkgconf in real use: a .pc set shaped like the wasix/emscripten dev
 * packages (zlib, libpng with Requires.private, OpenSSL's three files, a
 * relocatable .pc on ${pcfiledir}), queried the way configure scripts and
 * build.sh files do, through both commands the package ships.
 *
 * The outputs below are what pkgconf 2.5.1 printed for the same files, so a
 * bump that changes them fails here. The last block is pkgconf 3 behaviour
 * that 2.5.1 doesn't have (cert/NEGATIVE.md).
 */
const PC = {
  'zlib.pc': [
    'prefix=/opt/wasm',
    'exec_prefix=${prefix}',
    'libdir=${exec_prefix}/lib',
    'sharedlibdir=${libdir}',
    'includedir=${prefix}/include',
    '',
    'Name: zlib',
    'Description: zlib compression library',
    'Version: 1.3.1',
    '',
    'Requires:',
    'Libs: -L${libdir} -L${sharedlibdir} -lz',
    'Cflags: -I${includedir}',
  ],
  'libpng16.pc': [
    'prefix=/opt/wasm',
    'exec_prefix=${prefix}',
    'libdir=${exec_prefix}/lib',
    'includedir=${prefix}/include/libpng16',
    '',
    'Name: libpng',
    'Description: Loads and saves PNG files',
    'Version: 1.6.50',
    'Requires.private: zlib',
    'Libs: -L${libdir} -lpng16',
    'Libs.private: -lm -lz -lm',
    'Cflags: -I${includedir}',
  ],
  'libcrypto.pc': [
    'prefix=/opt/wasm',
    'exec_prefix=${prefix}',
    'libdir=${exec_prefix}/lib',
    'includedir=${prefix}/include',
    'enginesdir=${libdir}/engines-3',
    '',
    'Name: OpenSSL-libcrypto',
    'Description: OpenSSL cryptography library',
    'Version: 3.5.9',
    'Libs: -L${libdir} -lcrypto',
    'Libs.private: -ldl -pthread',
    'Cflags: -I${includedir} -DOPENSSL_NO_ASYNC',
  ],
  'libssl.pc': [
    'prefix=/opt/wasm',
    'exec_prefix=${prefix}',
    'libdir=${exec_prefix}/lib',
    'includedir=${prefix}/include',
    '',
    'Name: OpenSSL-libssl',
    'Description: Secure Sockets Layer and cryptography libraries',
    'Version: 3.5.9',
    'Requires.private: libcrypto',
    'Libs: -L${libdir} -lssl',
    'Cflags: -I${includedir}',
  ],
  'openssl.pc': [
    'prefix=/opt/wasm',
    '',
    'Name: OpenSSL',
    'Description: Secure Sockets Layer and cryptography libraries and tools',
    'Version: 3.5.9',
    'Requires: libssl libcrypto',
  ],
  'conflict.pc': [
    'Name: conflict',
    'Description: conflicts with zlib < 2',
    'Version: 1.0',
    'Conflicts: zlib < 2',
    'Libs: -lconflict',
  ],
};
const RELO = [
  'prefix=${pcfiledir}/../..',
  'libdir=${prefix}/lib',
  'includedir=${prefix}/include',
  '',
  'Name: relo',
  'Description: relocatable via pcfiledir',
  'Version: 4.2.0',
  'Libs: -L${libdir} -lrelo',
  'Cflags: -I${includedir}',
];

export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (const [file, lines] of Object.entries(PC)) {
    await write(`home/sdk/lib/pkgconfig/${file}`, `${lines.join('\n')}\n`);
  }
  await write('home/sdk/share/pkgconfig/relo.pc', `${RELO.join('\n')}\n`);
  const PATH_ = '/home/sdk/lib/pkgconfig:/home/sdk/share/pkgconfig';
  const base = { PKG_CONFIG_PATH: PATH_, PKG_CONFIG_LIBDIR: '/home/sdk/none' };

  async function pc(args, { cmd = 'pkg-config', env = {}, status = 0 } = {}) {
    const r = await run([cmd, ...args], { cwd: '/home', env: { ...base, ...env } });
    const what = `${cmd} ${args.join(' ')}${Object.keys(env).length ? ` (${JSON.stringify(env)})` : ''}`;
    if (status === 0) assert.equal(r.status, 0, `${what}: exit ${r.status}: ${r.stderr}`);
    else assert.notEqual(r.status, 0, `${what}: expected to fail, printed ${JSON.stringify(r.stdout)}`);
    return r.stdout.replace(/\n$/, '');
  }

  // The binary is the upstream the package says it is, under both names.
  const upstream = ctx.installed?.[0]?.homescoop?.upstream;
  assert.ok(upstream, 'manifest has homescoop.upstream');
  assert.equal(await pc(['--version'], { cmd: 'pkgconf' }), upstream);
  assert.equal(await pc(['--version']), upstream);
  assert.equal(await pc(['--modversion', 'pkg-config']), upstream);

  // --modversion / --exists / version constraints.
  assert.equal(await pc(['--modversion', 'zlib', 'libpng16', 'openssl']), '1.3.1\n1.6.50\n3.5.9');
  assert.equal(await pc(['--exists', 'zlib']), '');
  await pc(['--exists', 'no-such-pkg'], { status: 1 });
  await pc(['--exists', 'zlib >= 1.2', 'libpng16 < 1.7']);
  await pc(['--exists', 'zlib >= 2'], { status: 1 });
  await pc(['--atleast-version=1.3', 'zlib']);
  await pc(['--atleast-version=1.4', 'zlib'], { status: 1 });
  await pc(['--exact-version=1.3.1', 'zlib']);
  await pc(['--max-version=1.3.0', 'zlib'], { status: 1 });
  await pc(['--exists', 'libpng16', 'no-such-pkg'], { status: 1 });

  // --cflags / --libs, shared and static, with Requires(.private) pulled in.
  assert.equal(await pc(['--cflags', 'zlib']), '-I/opt/wasm/include');
  assert.equal(await pc(['--libs', 'zlib']), '-L/opt/wasm/lib -lz');
  assert.equal(await pc(['--cflags', '--libs', 'zlib'], { cmd: 'pkgconf' }), '-I/opt/wasm/include -L/opt/wasm/lib -lz');
  assert.equal(await pc(['--cflags', 'libpng16']), '-I/opt/wasm/include/libpng16 -I/opt/wasm/include');
  assert.equal(await pc(['--libs', 'libpng16']), '-L/opt/wasm/lib -lpng16');
  assert.equal(await pc(['--libs', '--static', 'libpng16']), '-L/opt/wasm/lib -lpng16 -lm -lm -lz');
  assert.equal(await pc(['--libs', 'openssl']), '-L/opt/wasm/lib -lssl -lcrypto');
  assert.equal(
    await pc(['--cflags', '--libs', '--static', 'openssl']),
    '-I/opt/wasm/include -DOPENSSL_NO_ASYNC -L/opt/wasm/lib -lssl -lcrypto -ldl -pthread',
  );
  assert.equal(await pc(['--libs-only-l', '--static', 'openssl']), '-lssl -lcrypto -ldl');
  assert.equal(await pc(['--libs-only-L', 'openssl']), '-L/opt/wasm/lib');
  assert.equal(await pc(['--libs-only-other', '--static', 'libcrypto']), '-pthread');
  assert.equal(await pc(['--cflags-only-I', 'libcrypto']), '-I/opt/wasm/include');
  assert.equal(await pc(['--cflags-only-other', 'libcrypto']), '-DOPENSSL_NO_ASYNC');
  assert.equal(await pc(['--print-requires', 'openssl']), 'libssl\nlibcrypto');
  assert.equal(await pc(['--print-requires-private', 'libpng16']), 'zlib');
  await pc(['--cflags', 'no-such-pkg'], { status: 1 });

  // --variable / --define-variable / sysroot / ${pcfiledir}.
  assert.equal(await pc(['--variable=prefix', 'zlib']), '/opt/wasm');
  assert.equal(await pc(['--variable', 'libdir', 'zlib']), '/opt/wasm/lib');
  assert.equal(await pc(['--variable=enginesdir', 'libcrypto']), '/opt/wasm/lib/engines-3');
  assert.equal(await pc(['--variable=pcfiledir', 'zlib']), '/home/sdk/lib/pkgconfig');
  assert.equal(await pc(['--variable=nosuch', 'zlib']), '');
  assert.equal(
    await pc(['--define-variable=prefix=/sysroot', '--cflags', '--libs', 'zlib']),
    '-I/sysroot/include -L/sysroot/lib -lz',
  );
  assert.equal(await pc(['--define-variable=prefix=/sysroot', '--variable=libdir', 'zlib']), '/sysroot/lib');
  assert.equal(
    await pc(['--cflags', '--libs', 'zlib'], { env: { PKG_CONFIG_SYSROOT_DIR: '/sr' } }),
    '-I/sr/opt/wasm/include -L/sr/opt/wasm/lib -lz',
  );
  assert.equal(await pc(['--cflags', 'relo']), '-I/home/sdk/share/pkgconfig/../../include');
  assert.equal(await pc(['--libs', 'relo']), '-L/home/sdk/share/pkgconfig/../../lib -lrelo');

  // pkgconf 3 behaviour (cert/NEGATIVE.md: the first four fail on 2.5.1-1;
  // the last, PKG_CONFIG_IGNORE_CONFLICTS, is the way back to 2.x).
  assert.equal(await pc(['--variable=prefix', 'zlib', 'libpng16']), '/opt/wasm /opt/wasm');
  assert.equal(await pc(['--variable=prefix', 'zlib'], { env: { PKG_CONFIG_ZLIB_PREFIX: '/env' } }), '/env');
  assert.equal(await pc(['--newlines', '--cflags', '--libs', 'zlib']), '-I/opt/wasm/include\n-L/opt/wasm/lib\n-lz');
  await pc(['--cflags', 'conflict', 'zlib'], { status: 1 });
  assert.equal(
    await pc(['--libs', 'conflict', 'zlib'], { env: { PKG_CONFIG_IGNORE_CONFLICTS: '1' } }),
    '-lconflict -L/opt/wasm/lib -lz',
  );
}
