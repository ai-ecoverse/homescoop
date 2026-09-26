#!/usr/bin/env jsh
// zlib build.jsh — slicc flip target; CI ships via build.sh (builder: host).
// Runs inside SLICC. Mirrors ladder.sh rung_zlib:
//   emconfigure ./configure --static && emmake make libz.a
const { spawn } = require('child_process');

const ROOT = process.env.HOMESCOOP_ROOT || '/mnt/homescoop';
const PKG = `${ROOT}/packages/zlib`;
const VERSION = '1.3.1';
const SRC_URL = 'https://zlib.net/fossils/zlib-1.3.1.tar.gz';
const SRC_SHA =
  '9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23';
const WORK = process.env.HOMESCOOP_WORK || '/tmp/homescoop/work';
const PREFIX = process.env.PREFIX || '/tmp/homescoop/prefix';
const SRC_DIR = `${WORK}/zlib-${VERSION}`;
const TARBALL = `${WORK}/zlib-${VERSION}.tar.gz`;

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(opts.env || {}) },
      cwd: opts.cwd || process.cwd(),
    });
    child.stdout.on('data', (c) => process.stdout.write(c));
    child.stderr.on('data', (c) => process.stderr.write(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

async function existsFile(p) {
  try {
    await sh('test', ['-f', p]);
    return true;
  } catch {
    return false;
  }
}

async function ensureEmcc() {
  for (const b of ['emconfigure', 'emmake', 'emcc']) {
    try {
      await sh('sh', ['-c', `command -v ${b}`]);
    } catch {
      throw new Error(
        `missing ${b} on PATH — mount/install the emscripten ladder toolchain ` +
          `(e.g. /emscripten/slicc) before running build.jsh`
      );
    }
  }
}

async function download() {
  await sh('mkdir', ['-p', WORK, `${PREFIX}/lib`, `${PREFIX}/include`]);
  if (!(await existsFile(TARBALL))) {
    console.log(`== zlib: fetch ${SRC_URL}`);
    await sh('curl', ['-fsSL', SRC_URL, '-o', TARBALL]);
  }
  try {
    await sh('sh', [
      '-c',
      `echo "${SRC_SHA}  ${TARBALL}" | shasum -a 256 -c -`,
    ]);
  } catch {
    await sh('sh', [
      '-c',
      `echo "${SRC_SHA}  ${TARBALL}" | sha256sum -c -`,
    ]);
  }
}

async function extract() {
  if ((await existsFile(`${SRC_DIR}/configure`)) && !process.env.FORCE) {
    console.log(`== zlib: have source ${SRC_DIR}`);
    return;
  }
  await sh('rm', ['-rf', SRC_DIR]);
  await sh('tar', ['xzf', TARBALL, '-C', WORK]);
}

async function build() {
  const libz = `${SRC_DIR}/libz.a`;
  if ((await existsFile(libz)) && !process.env.FORCE) {
    console.log(`== zlib: have ${libz}`);
    return;
  }
  console.log('== zlib: emconfigure + emmake');
  await sh('emconfigure', ['./configure', '--static'], { cwd: SRC_DIR });
  await sh('emmake', ['make', 'libz.a', `AR=`, `RANLIB=`], { cwd: SRC_DIR });
  if (!(await existsFile(libz))) throw new Error('libz.a not produced');
}

async function stage() {
  const destLib = `${PKG}/package/lib`;
  const destInc = `${PKG}/package/include`;
  await sh('mkdir', ['-p', destLib, destInc]);
  await sh('cp', [`${SRC_DIR}/libz.a`, `${destLib}/libz.a`]);
  await sh('cp', [`${SRC_DIR}/zlib.h`, `${destInc}/zlib.h`]);
  await sh('cp', [`${SRC_DIR}/zconf.h`, `${destInc}/zconf.h`]);
  await sh('cp', [`${SRC_DIR}/libz.a`, `${PREFIX}/lib/libz.a`]);
  await sh('cp', [`${SRC_DIR}/zlib.h`, `${PREFIX}/include/zlib.h`]);
  await sh('cp', [`${SRC_DIR}/zconf.h`, `${PREFIX}/include/zconf.h`]);
  console.log(`== zlib: staged → ${PKG}/package/{lib,include} and ${PREFIX}`);
}

async function main() {
  await ensureEmcc();
  await download();
  await extract();
  await build();
  await stage();
  console.log('== zlib: build.jsh ok');
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
