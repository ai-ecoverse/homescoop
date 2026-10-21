export const SLICC_SHIM_MARK = Buffer.from('slicc_sig_mask');

export const SHIM_HEADING = /^## homescoop: .*\bslicc shims\b.*Apache-2\.0/m;

export const KNOWN_WITHOUT_SHIM_NOTICE = {
  'wasm-binaryen': '#844',
  'wasm-clang': '#844',
  'wasm-emscripten': '#844',
};

export function shimNoticeErrors(wasm, pkg, notices, name) {
  const errors = [];
  if (notices == null) errors.push(`${wasm} links homescoop's slicc shims, but the package ships no THIRD-PARTY-NOTICES.md (homescoop_notices_begin and homescoop_notice_emscripten in build.sh; homescoop#853)`);
  else if (!SHIM_HEADING.test(notices)) errors.push(`${wasm} links homescoop's slicc shims, but THIRD-PARTY-NOTICES.md has no "## homescoop: … slicc shims (… Apache-2.0)" section (homescoop_notice_emscripten after homescoop_slicc_archive, or homescoop_notice_slicc_shims; homescoop#853)`);
  else if (!/Apache License\s+Version 2\.0/.test(notices.slice(notices.search(SHIM_HEADING)))) errors.push(`${wasm}: THIRD-PARTY-NOTICES.md's slicc shims section lacks the Apache-2.0 text (homescoop#853)`);
  if (!Array.isArray(pkg.files) || !pkg.files.includes('THIRD-PARTY-NOTICES.md')) errors.push('package.json files[] must include "THIRD-PARTY-NOTICES.md" (slicc shims notice, homescoop#853)');
  const known = name && KNOWN_WITHOUT_SHIM_NOTICE[name];
  if (!known) return { errors, known: null };
  if (!errors.length) return { errors: [`${name} ships the slicc shims notice now: delete its KNOWN_WITHOUT_SHIM_NOTICE entry in scripts/shim-notice.mjs`], known: null };
  return { errors: [], known: `${known}: ${errors.join('; ')}` };
}
