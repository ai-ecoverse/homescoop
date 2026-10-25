import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const fixtures = new URL('./fixtures/', import.meta.url);
export const fixture = (name) => readFileSync(new URL(name, fixtures), 'utf8');
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function largeYaml() {
  const tiers = ['gold', 'silver', 'bronze'];
  const parts = ['# generated inventory: 12000 services', 'services:'];
  for (let i = 0; i < 12000; i++) {
    parts.push(
      `  - name: svc-${i}`,
      `    tier: ${tiers[i % 3]} # tier ${i % 3}`,
      `    owner: "team-${i % 97}@example.com"`,
      `    replicas: ${(i * 7919) % 13}`,
      `    image: ghcr.io/example/svc-${i}:${i % 5}.${i % 11}.${i % 7}`,
      '    ports:',
      `      - {name: http, port: ${8000 + (i % 1000)}}`,
      `      - {name: metrics, port: ${9000 + (i % 1000)}}`,
      '    labels:',
      `      app: svc-${i}`,
      `      region: ${['eu-west-1', 'us-east-1', 'ap-south-1'][i % 3]}`,
      `    description: "Service ${i}: caf\u00e9 \u2014 na\u00efve \\"quoted\\" text"`,
    );
  }
  return `${parts.join('\n')}\n`;
}

const content = (name) => (name === 'large.yaml' ? largeYaml() : fixture(name));

export const cases = [
  { name: 'version', args: ['--version'] },
  { name: 'gha first steps', args: ['.jobs.*.steps[0]', 'ci.yml'], files: ['ci.yml'] },
  { name: 'gha job names', args: ['.jobs | keys', 'ci.yml'], files: ['ci.yml'] },
  { name: 'gha matrix as json', args: ['-o', 'json', '-I0', '.jobs.test.strategy.matrix', 'ci.yml'], files: ['ci.yml'] },
  { name: 'gha on from stdin', args: ['.on'], stdin: 'ci.yml' },
  { name: 'gha edit in place', args: ['-i', '.jobs.lint.steps[1].with.node-version = 22 | .permissions.checks = "write"', 'ci.yml'], files: ['ci.yml'], after: 'ci.yml' },
  { name: 'k8s images', args: ['select(.kind == "Deployment") | .spec.template.spec.containers[].image', 'k8s.yaml'], files: ['k8s.yaml'] },
  { name: 'k8s second document', args: ['select(document_index == 1) | .spec.replicas', 'k8s.yaml'], files: ['k8s.yaml'] },
  { name: 'k8s names on stdin with -', args: ['.kind + "/" + .metadata.name', '-'], stdin: 'k8s.yaml' },
  { name: 'k8s edit in place', args: ['-i', '(select(.kind == "Deployment") | .spec.replicas) = 3 | (select(.kind == "Deployment") | .spec.template.spec.containers[0].image) = "ghcr.io/example/web:1.5.0"', 'k8s.yaml'], files: ['k8s.yaml'], after: 'k8s.yaml' },
  { name: 'front matter extract', args: ['--front-matter=extract', '.title', 'post.md'], files: ['post.md'] },
  { name: 'front matter process', args: ['--front-matter=process', '.tags += ["browser"]', 'post.md'], files: ['post.md'] },
  { name: 'front matter in place', args: ['-i', '-f', 'process', '.draft = false', 'post.md'], files: ['post.md'], after: 'post.md' },
  { name: 'yaml to json', args: ['-o', 'json', 'ci.yml'], files: ['ci.yml'] },
  { name: 'json to yaml', args: ['-p', 'json', '-o', 'yaml', 'package.json'], files: ['package.json'] },
  { name: 'json query', args: ['.dependencies | keys | .[]', 'package.json'], files: ['package.json'] },
  { name: 'json edit in place', args: ['-i', '.version = "1.5.0" | .scripts.lint = "eslint ."', 'package.json'], files: ['package.json'], after: 'package.json' },
  { name: 'toml query', args: ['.package.version', 'Cargo.toml'], files: ['Cargo.toml'] },
  { name: 'toml to json', args: ['-o', 'json', 'Cargo.toml'], files: ['Cargo.toml'] },
  { name: 'toml on stdin to yaml', args: ['-p', 'toml', '-o', 'yaml', '.features'], stdin: 'Cargo.toml' },
  { name: 'yaml to toml', args: ['-o', 'toml', 'base.yaml'], files: ['base.yaml'] },
  { name: 'toml edit in place', args: ['-i', '.package.version = "15.2.0"', 'Cargo.toml'], files: ['Cargo.toml'], after: 'Cargo.toml' },
  { name: 'xml query', args: ['-oy', '.project.dependencies.dependency[].artifactId', 'pom.xml'], files: ['pom.xml'] },
  { name: 'xml to json', args: ['-p', 'xml', '-o', 'json', 'pom.xml'], files: ['pom.xml'] },
  { name: 'yaml to xml', args: ['-o', 'xml', '{"config": .}', 'base.yaml'], files: ['base.yaml'] },
  { name: 'xml edit in place', args: ['-i', '.project.version = "2.4.0"', 'pom.xml'], files: ['pom.xml'], after: 'pom.xml' },
  { name: 'eval-all merge', args: ['eval-all', '. as $item ireduce ({}; . * $item)', 'base.yaml', 'prod.yaml'], files: ['base.yaml', 'prod.yaml'] },
  { name: 'ea file index', args: ['ea', 'select(fi == 1) | filename + ": " + (keys | join(","))', 'base.yaml', 'prod.yaml'], files: ['base.yaml', 'prod.yaml'] },
  { name: 'ea collect documents', args: ['ea', '[.metadata.name + "/" + .kind]', 'k8s.yaml'], files: ['k8s.yaml'] },
  { name: 'env and strenv', args: ['-n', '.tag = env(TAG) | .text = strenv(TAG) | .home = strenv(APP_HOME)'], env: { TAG: '1.20', APP_HOME: '/srv/app' } },
  { name: 'strenv in place', args: ['-i', '(select(.kind == "Deployment") | .spec.template.spec.containers[0].image) = "ghcr.io/example/web:" + strenv(TAG)', 'k8s.yaml'], files: ['k8s.yaml'], env: { TAG: '2.0.0' }, after: 'k8s.yaml' },
  { name: 'envsubst', args: ['-n', '"image: ${REGISTRY}/web:${TAG}" | envsubst'], env: { REGISTRY: 'ghcr.io/example', TAG: '1.4.2' } },
  { name: 'bad expression', args: ['.jobs[', 'ci.yml'], files: ['ci.yml'] },
  { name: 'bad expression in place', args: ['-i', '.jobs | bad(', 'ci.yml'], files: ['ci.yml'], after: 'ci.yml' },
  { name: 'missing file', args: ['.a', 'missing.yaml'] },
  { name: 'bad yaml', args: ['.a'], stdin: { text: 'a: [1, 2\nb: 3\n' } },
  { name: 'exit status', args: ['-e', '.jobs.deploy', 'ci.yml'], files: ['ci.yml'] },
  { name: 'large count', args: ['.services | length', 'large.yaml'], files: ['large.yaml'] },
  { name: 'large select', args: ['[.services[] | select(.tier == "gold" and .replicas > 10) | .name] | length', 'large.yaml'], files: ['large.yaml'] },
  { name: 'large to json', args: ['-o', 'json', 'large.yaml'], files: ['large.yaml'], digest: true },
  { name: 'large edit in place', args: ['-i', '.services[] |= (.replicas += 1)', 'large.yaml'], files: ['large.yaml'], after: 'large.yaml', digest: true },
];

export const files = (c) => Object.fromEntries((c.files || []).map((f) => [f, content(f)]));
export const stdin = (c) => (c.stdin === undefined ? undefined : typeof c.stdin === 'string' ? content(c.stdin) : c.stdin.text);

export const digest = (text) => ({ sha256: sha256(text), bytes: Buffer.byteLength(text) });

export const tempFiles = (names) => names.filter((n) => n.startsWith('temp')).length;

export function observed(c, r, after, left) {
  const o = { status: r.status, stdout: c.digest ? digest(r.stdout) : r.stdout, stderr: r.stderr };
  if (c.after) {
    o.after = c.digest ? digest(after ?? '') : after;
    o.left = left;
  }
  return o;
}

export const expected = () => JSON.parse(fixture('expected.json'));

export function compare(c, o) {
  const want = expected()[c.name];
  if (!want) return [`${c.name}: no golden`];
  const bad = [];
  for (const k of ['status', 'stdout', 'stderr', 'after', 'left']) {
    if (JSON.stringify(want[k]) !== JSON.stringify(o[k])) bad.push(`${c.name}: ${k} ${JSON.stringify(o[k])?.slice(0, 400)} != native ${JSON.stringify(want[k])?.slice(0, 400)}`);
  }
  return bad;
}
