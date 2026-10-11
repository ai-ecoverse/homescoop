/**
 * Stand-in for the py-* re-pin wave, for certs of a new wasix-python build.
 *
 * The cert installs the published py-* packages, built for an earlier
 * wasix-python. Those that pin it exactly (py-numpy 2.3.2-7: "3.14.2-13")
 * come with their own nested copy, node_modules/@ai-ecoverse/wasix-python,
 * and _slicc_site.discover() rightly refuses a py-* whose python is another
 * version. The re-pin wave is packaging-only (same side modules, exact
 * dependency on the new python), so the cert moves those nested copies aside:
 * then every py-* resolves to the python under test, as re-pinned ones will.
 * restore() puts them back. Renames stay in the same directory: in the
 * browser /tmp is another mount, and mv there copies 114 MB per python.
 *
 * HOMESCOOP_CERT_NO_REPIN=1 (the re-pin wave's own cert, py-matplotlib
 * cert/), or "noRepin": true in wasix-python's cert/meta.json (needsInstall
 * pins the published wave for this python): the installed py-* are the real
 * re-pinned packages, so there must be nothing to move and every py-* must
 * declare exactly this python; repin() throws instead of standing in. A new
 * python build's cert sets noRepin false again until its own wave.
 */
import { readFileSync } from 'node:fs';

const NM = '/node_modules/@ai-ecoverse';
const AWAY = '.wasix-python.repin';
const META = JSON.parse(readFileSync(new URL('../meta.json', import.meta.url), 'utf8'));
const strict = () => process.env.HOMESCOOP_CERT_NO_REPIN === '1' || META.noRepin === true;

export async function repin({ run, read }) {
  const ls = await run(['bash', '-c', `ls -d ${NM}/py-*/node_modules/@ai-ecoverse/wasix-python 2>/dev/null || true`], { cwd: '/' });
  const want = JSON.parse(await read(`${NM}/wasix-python/package.json`)).version;
  const moved = [];
  if (strict()) {
    const pkgs = await run(['bash', '-c', `ls -d ${NM}/py-* 2>/dev/null || true`], { cwd: '/' });
    for (const p of pkgs.stdout.split('\n').filter(Boolean)) {
      const dep = (JSON.parse(await read(`${p}/package.json`)).dependencies || {})['@ai-ecoverse/wasix-python'];
      if (dep !== undefined && dep !== want) {
        throw new Error(`no-repin cert: ${p} depends on wasix-python ${dep}, not ${want}; the py-* are not re-pinned`);
      }
    }
  }
  for (const dir of ls.stdout.split('\n').filter(Boolean)) {
    const v = JSON.parse(await read(`${dir}/package.json`)).version;
    if (v === want) continue;
    if (strict()) {
      throw new Error(`no-repin cert: ${dir} is wasix-python ${v}, not ${want}; the py-* are not re-pinned`);
    }
    const pkg = dir.slice(NM.length + 1).split('/')[0];
    const away = dir.replace(/wasix-python$/, AWAY);
    const r = await run(['bash', '-c', `rm -rf ${away} && mv ${dir} ${away}`], { cwd: '/' });
    if (r.status !== 0) throw new Error(`repin ${dir}: ${r.stderr}`);
    moved.push({ pkg, dir, away, version: v });
  }
  if (strict()) console.log(`repin: none needed, every py-* resolves to wasix-python ${want}`);
  return {
    moved,
    async restore() {
      for (const m of moved.splice(0)) {
        const r = await run(['bash', '-c', `mv ${m.away} ${m.dir}`], { cwd: '/' });
        if (r.status !== 0) throw new Error(`restore ${m.dir}: ${r.stderr}`);
      }
    },
  };
}
