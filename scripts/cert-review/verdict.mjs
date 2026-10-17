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
    specs: { type: 'string', default: '' },
    'repack-input': { type: 'string', default: '' },
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
  const parsed = JSON.parse(readFileSync(join(values.review, 'verdict.json'), 'utf8'));
  if (Array.isArray(parsed?.packages)) {
    verdicts = parsed.packages.filter((v) => {
      const valid = v && typeof v === 'object' && typeof v.package === 'string';
      if (!valid) problems.push(`verdict.json has an entry that isn't { "package": "<name>", … }`);
      return valid;
    });
  } else {
    problems.push('verdict.json has no "packages" list');
  }
} catch (error) {
  problems.push(`no readable verdict.json (${one(error.message)})`);
}
let specCounts = null;
if (values.specs) {
  try {
    specCounts = JSON.parse(readFileSync(values.specs, 'utf8'));
  } catch (error) {
    problems.push(`no readable specs file (${one(error.message)})`);
  }
}
const UNSPECIFIED = "no committed cert specs; this certification rests on the reviewer's own run";
const unspecified = (pkg) => specCounts !== null && !(specCounts[pkg.recipe] > 0);

let repackInputs = null;
if (values['repack-input']) {
  try {
    repackInputs = JSON.parse(readFileSync(values['repack-input'], 'utf8'));
  } catch (error) {
    problems.push(`no readable repack-input file (${one(error.message)})`);
    repackInputs = {};
  }
}
const unverifiable = (pkg) => {
  if (repackInputs === null) return '';
  const r = repackInputs[pkg.recipe];
  if (!r || typeof r !== 'object') return "repack-input.mjs didn't run for it";
  if (r.error) return `repack-input.mjs couldn't trace it (${one(r.error)})`;
  if (r.attested === true) return '';
  return one(r.reason) || 'no reason given';
};
const forcedKnown = (pkg) => {
  const r = repackInputs?.[pkg.recipe];
  if (!r || r.attested !== true || r.known === undefined) return [];
  if (!Array.isArray(r.known)) {
    problems.push(`${pkg.name}@${pkg.version}: repack-input.mjs's "known" isn't a list`);
    return [];
  }
  return r.known.map((k) => one(k)).filter(Boolean);
};

const listOf = (value, what, pkg) => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;
  problems.push(`${pkg.name}@${pkg.version}: "${what}" isn't a list`);
  return [value];
};

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
    const input = unverifiable(pkg);
    if (input) return { ok: false, line: `cert-ci: INCOMPLETE ${pkg.name}@${pkg.version}: unverifiable input: ${input}` };
    return { ok: false, line: `cert-ci: NO VERDICT ${pkg.name}@${pkg.version}` };
  }
  const [v] = found;
  const input = unverifiable(pkg);
  if (input && v.verdict !== 'fail') {
    return { ok: false, line: `cert-ci: INCOMPLETE ${pkg.name}@${pkg.version}: unverifiable input: ${input}` };
  }
  if (v.verdict === 'certified') {
    const known = [...forcedKnown(pkg), ...listOf(v.known, 'known', pkg).map((k) => one(k).slice(0, 120)).filter(Boolean)];
    const notes = [...(unspecified(pkg) ? [UNSPECIFIED] : []), ...(known.length ? [`known: ${known.join(', ')}`] : [])];
    if (held) return { ok: false, line: `cert-ci: HELD ${pkg.name}@${pkg.version}: the reviewer certified it, but ${held}` };
    return {
      ok: true,
      line: `certified=${pkg.sha} ${pkg.name} ${pkg.version}${notes.length ? ` (${notes.join('; ')})` : ''}`,
    };
  }
  if (v.verdict === 'fail') {
    const also = input ? `; also unverifiable input: ${input}` : '';
    return { ok: false, line: `cert-ci: FAIL ${pkg.name}@${pkg.version}: ${one(v.reason) || 'no reason given'}${also}` };
  }
  problems.push(`${pkg.name}@${pkg.version}: verdict "${one(v.verdict)}" is neither certified nor fail`);
  return { ok: false, line: `cert-ci: NO VERDICT ${pkg.name}@${pkg.version}` };
});

const comment = existsSync(join(values.review, 'comment.md'))
  ? readFileSync(join(values.review, 'comment.md'), 'utf8').trim()
  : '**Cert review:** the reviewer wrote no comment.';
const result = lines.map(({ line }) => line).join('\n');
const unspecifiedNote = specCounts !== null && packages.some(unspecified)
  ? `\n\n**${packages.filter(unspecified).map((pkg) => pkg.name).join(', ')}: ${UNSPECIFIED}.**`
  : '';
const incomplete = lines.filter(({ line }) => line.startsWith('cert-ci: INCOMPLETE'));
const incompleteNote = incomplete.length
  ? `\n\n**Not certified, whatever the review says: ${incomplete.length === 1 ? 'an input is' : 'inputs are'} unverifiable.** A build must fetch the recipe's pinned source (homescoop_fetch with its sha256) with no stage or prebuilt path, and a repack must trace its bytes to such a build that is provenance-attested from CI, or reproducible (\`scripts/cert-review/repack-input.mjs\`).`
  : '';
const trouble = problems.length ? `\n\n**Problems:**\n${problems.map((p) => `- ${p}`).join('\n')}` : '';
const footer = values.run ? `\n\n<sub>shas computed from the ladder-pr artifacts, not by the reviewer · [run](${values.run})</sub>` : '';
writeFileSync(values.body, `${comment}${unspecifiedNote}${incompleteNote}\n\n\`\`\`\n${result}\n\`\`\`${trouble}${footer}\n`);
writeFileSync(values.lines, `${result}\n`);
writeFileSync(`${values.lines}.unspecified`, `${JSON.stringify(packages.filter(unspecified).map((pkg) => pkg.name))}\n`);

const passed = !problems.length && lines.length > 0 && lines.every(({ ok }) => ok);
console.log(result);
for (const p of problems) console.error(`problem: ${p}`);
process.exit(passed ? 0 : 1);
