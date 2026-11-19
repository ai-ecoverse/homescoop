import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixtures = fileURLToPath(new URL('../test/fixtures/valid/', import.meta.url));
const tree = (base) =>
  readdirSync(base, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(base, join(e.parentPath, e.name)))
    .sort();

export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const out = (r) => `rc=${r.status}\n${r.stdout.slice(0, 2000)}\n${r.stderr.slice(0, 2000)}`;
  const json = (r) => {
    try {
      return JSON.parse(r.stdout);
    } catch {
      assert.fail(`stdout is not JSON: ${out(r)}`);
    }
  };

  let r = await run(['okf', 'version']);
  assert.equal(r.status, 0, out(r));
  assert.equal(json(r).version, '0.5.2', out(r));

  r = await run(['okf', 'init', '/home/kb'], { cwd: '/' });
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(json(r).created, ['tables/', 'datasets/', 'playbooks/'], out(r));
  assert.ok(await read('/home/kb/index.md'), 'init writes index.md');

  const bundle = '/home/app/bundle';
  for (const path of tree(fixtures)) await write(`${bundle}/${path}`, readFileSync(join(fixtures, path), 'utf8'));

  r = await run(['okf', 'validate', '.'], { cwd: bundle });
  assert.equal(r.status, 0, out(r));
  let v = json(r);
  assert.equal(v.valid, true, out(r));
  assert.equal(v.errors, 0, out(r));
  assert.equal(v.warnings, 4, out(r));

  r = await run(['okf', 'lint', bundle]);
  assert.equal(r.status, 0, out(r));
  assert.equal(json(r).errors, 0, out(r));

  r = await run(['okf', 'list', bundle]);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(json(r).concepts.map((c) => c.id), ['datasets/ga4', 'playbooks/freshness', 'tables/events_'], out(r));

  r = await run(['okf', 'show', bundle, 'tables/events_']);
  assert.equal(r.status, 0, out(r));
  assert.match(json(r).concept.body, /^# Schema\n/, out(r));

  r = await run(['okf', 'search', bundle, '--tag', 'ga4']);
  assert.equal(r.status, 0, out(r));
  assert.match(r.stdout, /"datasets\/ga4"/, out(r));
  assert.match(r.stdout, /"tables\/events_"/, out(r));
  assert.doesNotMatch(r.stdout, /"playbooks\/freshness"/, out(r));

  r = await run(['okf', 'backlinks', bundle, 'tables/events_']);
  assert.equal(r.status, 0, out(r));
  assert.deepEqual(json(r).backlinks, ['datasets/ga4', 'playbooks/freshness'], out(r));

  r = await run(['okf', 'graph', bundle]);
  assert.equal(r.status, 0, out(r));
  assert.equal(json(r).edge_count, 3, out(r));

  r = await run(['okf', 'index', '.'], { cwd: bundle });
  assert.equal(r.status, 0, out(r));
  assert.equal(json(r).count, 4, out(r));
  assert.match(await read(`${bundle}/tables/index.md`), /events_/, 'tables/index.md lists its concept');
  await write(`${bundle}/tables/bad.md`, '---\ntitle: x\n---\nbody\n');
  r = await run(['okf', 'validate', bundle]);
  assert.equal(r.status, 1, out(r));
  v = json(r);
  assert.equal(v.valid, false, out(r));
  assert.equal(v.errors, 1, out(r));
  assert.ok(v.findings.some((f) => f.concept_id === 'tables/bad' && f.rule === 'okf/frontmatter/type-required'), out(r));
  r = await run(['okf', 'bogus']);
  assert.equal(r.status, 4, out(r));
  assert.match(r.stderr, /unknown command: bogus/, out(r));
  for (const missing of ['/nonexistent', '/home/app/nope']) {
    r = await run(['okf', 'validate', missing], { cwd: '/' });
    assert.equal(r.status, 2, out(r));
    assert.match(r.stderr, /no such file or directory/i, out(r));
    assert.doesNotMatch(r.stderr, /Bad file number/, out(r));
  }
  console.log('checklist: okf 0.5.2 init/validate/lint/list/show/search/backlinks/graph/index on the fixture bundle, exit codes 1/2/4, ENOENT for missing paths');
}
