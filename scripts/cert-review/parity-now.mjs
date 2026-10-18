import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { npmParity } from '../npm-parity.mjs';
import { recipeTag } from '../npm-tag.mjs';

const one = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export async function tagsAt({ recipes, read }) {
  const out = {};
  for (const recipe of recipes) {
    try {
      const text = await read(`packages/${recipe}/recipe.yaml`);
      if (text == null) throw new Error(`no packages/${recipe}/recipe.yaml at the head`);
      out[recipe] = { tag: recipeTag(text) };
    } catch (error) {
      out[recipe] = { error: one(error.message) };
    }
  }
  return out;
}

export function githubRead({ repo, ref, token }) {
  return async (path) => {
    const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    const res = await fetch(url, { headers: { accept: 'application/vnd.github.raw+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${url} returned ${res.status}`);
    return res.text();
  };
}

export function parityNow({ artifacts, pr, tags = null, check = (buf, tag) => npmParity(buf, { drift: 'fail', tag }) }) {
  const pattern = new RegExp(`^host-(.+)-pr${pr}$`);
  const out = {};
  for (const dir of readdirSync(artifacts).sort()) {
    const match = dir.match(pattern);
    if (!match) continue;
    const tgz = join(artifacts, dir, 'package.tgz');
    try {
      if (!existsSync(tgz)) throw new Error(`${dir} has no package.tgz`);
      const t = tags ? tags[match[1]] : { tag: 'latest' };
      if (!t) throw new Error(`no npm-tag read for ${match[1]} at the head`);
      if (t.error) throw new Error(`the npm-tag of ${match[1]} at the head: ${t.error}`);
      const r = check(readFileSync(tgz), t.tag);
      out[match[1]] = { verdict: r.verdict, name: r.name, version: r.version, tag: t.tag, latest: r.latest ?? null, message: one(r.message) };
    } catch (error) {
      out[match[1]] = { verdict: 'error', message: one(error.message) };
    }
  }
  return out;
}

export function parityProblem(r) {
  if (!r || typeof r !== 'object') return { tag: 'INCOMPLETE', why: "npm parity didn't run for it at record time" };
  if (r.verdict === 'new' || r.verdict === 'same') return null;
  if (r.verdict === 'behind') return { tag: 'BEHIND', why: `npm at record time: ${one(r.message)}` };
  if (r.verdict === 'drift') return { tag: 'DRIFT', why: `npm at record time: ${one(r.message)}` };
  return { tag: 'INCOMPLETE', why: `npm parity at record time failed: ${one(r.message) || one(r.verdict) || 'no verdict'}` };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values } = parseArgs({ options: { artifacts: { type: 'string' }, pr: { type: 'string' }, out: { type: 'string' }, head: { type: 'string' }, repo: { type: 'string' }, checkout: { type: 'string' } } });
  const remote = Boolean(values.head && values.repo);
  if (!values.artifacts || !values.pr || !values.out || remote === Boolean(values.checkout)) {
    console.error('usage: parity-now.mjs --artifacts <dir> --pr <n> (--head <sha> --repo <owner/name> | --checkout <dir>) --out <parity.json>');
    process.exit(2);
  }
  const pattern = new RegExp(`^host-(.+)-pr${values.pr}$`);
  const recipes = readdirSync(values.artifacts).map((d) => d.match(pattern)?.[1]).filter(Boolean);
  const read = remote
    ? githubRead({ repo: values.repo, ref: values.head, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN })
    : async (path) => (existsSync(join(values.checkout, path)) ? readFileSync(join(values.checkout, path), 'utf8') : null);
  const tags = await tagsAt({ recipes, read });
  const result = parityNow({ artifacts: values.artifacts, pr: values.pr, tags });
  writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  for (const [recipe, r] of Object.entries(result)) console.log(`${recipe}: ${r.verdict}${r.tag ? ` (--tag ${r.tag})` : ''}: ${r.message}`);
}
