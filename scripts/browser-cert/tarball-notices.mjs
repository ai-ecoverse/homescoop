import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const NOTICES_FILE = 'THIRD-PARTY-NOTICES.md';

export const EMSCRIPTEN_TEXTS = ['University of Illinois/NCSA Open Source License', 'musl as a whole is licensed', 'Apache License v2.0 with LLVM Exceptions'];

const HELPERS = new Set(['build-common.sh', 'notices-common.sh']);

export function buildScriptText(root, name) {
  const dir = join(root, 'packages', name);
  if (!existsSync(join(dir, 'build.sh'))) return '';
  let text = readdirSync(dir).filter((f) => f.endsWith('.sh')).sort().map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  for (const m of [...text.matchAll(/scripts\/([\w.-]+\.sh)/g)]) {
    if (!HELPERS.has(m[1]) && existsSync(join(root, 'scripts', m[1]))) text += `\n${readFileSync(join(root, 'scripts', m[1]), 'utf8')}`;
  }
  return text;
}

const calls = (text, fn) => new RegExp(`(^|[\\s;&|(])${fn}(\\s|$|\\))`, 'm').test(text);

export function sections(md) {
  const out = [];
  let cur = null;
  for (const line of md.split('\n')) {
    if (/^## /.test(line)) out.push((cur = { heading: line.slice(3).trim(), body: '' }));
    else if (cur) cur.body += `${line}\n`;
  }
  return out;
}

export function tarballNoticeErrors({ scripts: raw, manifest, notices }) {
  const scripts = String(raw).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const writes = calls(scripts, 'homescoop_notices_begin');
  const required = calls(scripts, 'homescoop_notice_emscripten') ? ['Emscripten'] : [];
  if (!writes && !required.length && notices == null) return { required, errors: [], skipped: 'the build writes no notices and the tarball ships none' };
  if (notices == null) return { required, errors: [`${NOTICES_FILE} is not in the tarball${writes ? ' (build.sh calls homescoop_notices_begin)' : ''}`] };
  const errors = [];
  if (!Array.isArray(manifest.files) || !manifest.files.includes(NOTICES_FILE)) errors.push(`package.json files[] doesn't list ${NOTICES_FILE}`);
  const secs = sections(notices);
  if (required.includes('Emscripten')) {
    const em = secs.find((s) => /^Emscripten \d/.test(s.heading));
    if (!em) errors.push('no "## Emscripten <version>" section (build.sh calls homescoop_notice_emscripten)');
    else for (const t of EMSCRIPTEN_TEXTS) if (!em.body.includes(t)) errors.push(`"## ${em.heading}" lacks "${t}"`);
  }
  return { required, errors, sections: secs.map((s) => s.heading) };
}

export function checkTarballNotices({ root, pkgName, pkgRoot, manifest }) {
  const file = join(pkgRoot, NOTICES_FILE);
  const notices = existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : null;
  return tarballNoticeErrors({ scripts: buildScriptText(root, pkgName), manifest, notices });
}
