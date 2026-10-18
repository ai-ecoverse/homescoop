// homescoop#1000: poppler's POPPLER_DATADIR is CMAKE_INSTALL_FULL_DATADIR, and
// emcmake set CMAKE_INSTALL_PREFIX to the build host's emsdk sysroot, so the
// shipped wasm named /home/runner/.cache/emsdk/…/sysroot/share/poppler.
// build.sh configures with -DCMAKE_INSTALL_PREFIX=/usr/local.
const WASM = '/node_modules/@ai-ecoverse/wasm-poppler/bin/poppler-multicall.wasm';
const BUILD_PATH = /\/(?:home|Users|__w|private\/var)\/[\x21-\x7e]{0,80}|\.cache\/emsdk[\x21-\x7e]{0,60}|homescoop-work[\x21-\x7e]{0,60}/;

export default async function datadir(ctx) {
  const { assert } = ctx;
  const bytes = await ctx.readBytes(WASM);
  assert.ok(bytes && bytes.length > 1 << 20, `${WASM} is not there`);
  const text = bytes.toString('latin1');
  const leak = text.match(BUILD_PATH);
  assert.equal(leak, null, `poppler-multicall.wasm names a build path: ${leak?.[0]} (homescoop#1000)`);
  assert.ok(text.includes('/usr/local/share/poppler'), 'POPPLER_DATADIR is /usr/local/share/poppler');
  console.log('datadir: poppler-multicall.wasm names no build path; POPPLER_DATADIR is /usr/local/share/poppler');
}
