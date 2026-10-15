import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    artifacts: { type: 'string' },
    pr: { type: 'string' },
    review: { type: 'string' },
    body: { type: 'string' },
    lines: { type: 'string' },
    run: { type: 'string', default: '' },
    'ladder-run': { type: 'string', default: '' },
    'ladder-conclusion': { type: 'string', default: '' },
  },
});

const one = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const problems = [];
const ladder = values['ladder-conclusion'];
const held = ladder !== 'success' ? `ladder-pr run ${values['ladder-run'] || '?'} concluded ${ladder || 'nothing'}` : '';
if (held) problems.push(`${held}, so nothing is certified`);

const pattern = new RegExp(`^host-(.+)-pr${values.pr}$`);
const packages = readdirSync(values.artifacts)
  .sort()
  .flatMap((dir) => {
    const match = dir.match(pattern);
    if (!match) return [];
    const path = join(values.artifacts, dir);
    const tgz = join(path, 'package.tgz');
    if (!existsSync(tgz)) {
      problems.push(`${dir} has no package.tgz`);
      return [];
    }
    const sha = createHash('sha256').update(readFileSync(tgz)).digest('hex');
    const recorded = existsSync(`${tgz}.sha256`) ? readFileSync(`${tgz}.sha256`, 'utf8').split(/\s+/)[0] : '';
    if (recorded !== sha) problems.push(`${dir}: package.tgz is ${sha}, package.tgz.sha256 says ${recorded || 'nothing'}`);
    const manifest = JSON.parse(execFileSync('tar', ['-xzf', tgz, '-O', 'package/package.json'], { encoding: 'utf8' }));
    return [{ recipe: match[1], name: manifest.name, version: manifest.version, sha }];
  });
if (!packages.length) problems.push(`no host-<package>-pr${values.pr} artifacts`);

let verdicts = [];
try {
  verdicts = JSON.parse(readFileSync(join(values.review, 'verdict.json'), 'utf8')).packages ?? [];
} catch (error) {
  problems.push(`no readable verdict.json (${one(error.message)})`);
}

const find = (pkg) => verdicts.filter((v) => v.package === pkg.recipe || v.package === pkg.name);
for (const v of verdicts) {
  if (!packages.some((pkg) => v.package === pkg.recipe || v.package === pkg.name)) {
    problems.push(`verdict.json names ${one(v.package)}, which this pull request's ladder-pr run didn't build`);
  }
}

const lines = packages.map((pkg) => {
  const found = find(pkg);
  if (found.length !== 1) {
    problems.push(`${pkg.name}@${pkg.version}: ${found.length} verdicts`);
    return { ok: false, line: `cert-ci: NO VERDICT ${pkg.name}@${pkg.version}` };
  }
  const [v] = found;
  if (v.verdict === 'certified') {
    const known = (v.known ?? []).map((k) => one(k).slice(0, 120)).filter(Boolean);
    if (held) return { ok: false, line: `cert-ci: HELD ${pkg.name}@${pkg.version}: the reviewer certified it, but ${held}` };
    return {
      ok: true,
      line: `certified=${pkg.sha} ${pkg.name} ${pkg.version}${known.length ? ` (known: ${known.join(', ')})` : ''}`,
    };
  }
  if (v.verdict === 'fail') return { ok: false, line: `cert-ci: FAIL ${pkg.name}@${pkg.version}: ${one(v.reason) || 'no reason given'}` };
  problems.push(`${pkg.name}@${pkg.version}: verdict "${one(v.verdict)}" is neither certified nor fail`);
  return { ok: false, line: `cert-ci: NO VERDICT ${pkg.name}@${pkg.version}` };
});

const comment = existsSync(join(values.review, 'comment.md'))
  ? readFileSync(join(values.review, 'comment.md'), 'utf8').trim()
  : '**Cert review:** the reviewer wrote no comment.';
const result = lines.map(({ line }) => line).join('\n');
const trouble = problems.length ? `\n\n**Problems:**\n${problems.map((p) => `- ${p}`).join('\n')}` : '';
const footer = values.run ? `\n\n<sub>shas computed from the ladder-pr artifacts, not by the reviewer · [run](${values.run})</sub>` : '';
writeFileSync(values.body, `${comment}\n\n\`\`\`\n${result}\n\`\`\`${trouble}${footer}\n`);
writeFileSync(values.lines, `${result}\n`);

const passed = !problems.length && lines.length > 0 && lines.every(({ ok }) => ok);
console.log(result);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(passed ? 0 : 1);
