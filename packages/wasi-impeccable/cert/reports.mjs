export default async function ({ run, write, read, assert }) {
  const H = '/home/impreports';
  const site = `${H}/site`;
  await write(`${site.slice(1)}/package.json`, '{"name":"site"}\n');
  await write(`${site.slice(1)}/index.html`, '<!doctype html><html><body><h1>Hi</h1></body></html>\n');
  await write(`${site.slice(1)}/report.md`, '# Review\n\nContrast is low on the hero.\n');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 600)}\n--- stderr\n${r.stderr.slice(0, 600)}`;
  const imp = (args) => run(['impeccable', ...args], { cwd: site, env: { HOME: H } });
  const ls = async (dir) => {
    const r = await run(['ls', '-A', dir], { cwd: H });
    return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const audit = await imp(['audit-storage', 'write', '.', 'report.md']);
  assert.equal(audit.status, 0, show('audit-storage write', audit));
  assert.equal(audit.stderr, '', show('audit-storage write', audit));
  const auditPath = audit.stdout.trim();
  assert.match(auditPath, new RegExp(`^${esc(site)}/\\.impeccable/audit/[^/]+__project\\.md$`), show('audit-storage write', audit));
  const auditBody = await read(auditPath);
  assert.match(auditBody, /^slug: project$/m, auditBody);
  assert.match(auditBody, /Contrast is low on the hero\./, auditBody);
  const ignore = await read(`${site}/.impeccable/audit/.gitignore`);
  assert.match(ignore, /^\*$/m, ignore);
  assert.match(ignore, /^!ignore\.md$/m, ignore);

  const slug = await imp(['audit-storage', 'slug', 'index.html']);
  assert.equal(slug.status, 0, show('audit-storage slug', slug));
  assert.match(slug.stdout, /^[a-z0-9-]+\n$/, show('audit-storage slug', slug));

  const critique = await imp(['critique-storage', 'write', 'index.html', 'report.md']);
  assert.equal(critique.status, 0, show('critique-storage write', critique));
  assert.equal(critique.stderr, '', show('critique-storage write', critique));
  assert.match(critique.stdout.trim(), new RegExp(`^${esc(site)}/\\.impeccable/critique/[^/]+__[a-z0-9-]+\\.md$`), show('critique-storage write', critique));
  const critiques = (await ls(`${site}/.impeccable/critique`)).filter((n) => n.endsWith('.md'));
  assert.equal(critiques.length, 1, critiques.join(','));

  await write(`${site.slice(1)}/.impeccable/config.json`, '{"reports":{"enabled":false}}\n');
  const off = await imp(['critique-storage', 'write', 'index.html', 'report.md']);
  assert.equal(off.status, 0, show('critique-storage write, reports off', off));
  assert.match(off.stdout, /^REPORTS OFF: this project turned saved reports off/, show('critique-storage write, reports off', off));
  const offAudit = await imp(['audit-storage', 'write', '.', 'report.md']);
  assert.equal(offAudit.status, 0, show('audit-storage write, reports off', offAudit));
  assert.match(offAudit.stdout, /^REPORTS OFF: /, show('audit-storage write, reports off', offAudit));
  assert.deepEqual((await ls(`${site}/.impeccable/critique`)).filter((n) => n.endsWith('.md')), critiques);
  assert.equal((await ls(`${site}/.impeccable/audit`)).filter((n) => n.endsWith('.md')).length, 1);
}
