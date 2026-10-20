import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkCertKernel } from '../check-cert-kernel.mjs';

const KERNEL = '@ai-ecoverse/slicc-kernel';
const REPO = 'https://github.com/ai-ecoverse/slicc-kernel';
const COMMIT = '746d966b38d40aa82d00f22d3bf072966fc741a1';
const digest = createHash('sha512').update('kernel tarball bytes').digest();
const integrity = `sha512-${digest.toString('base64')}`;
const pkg = (pin) => ({
  devDependencies: {
    [KERNEL]: pin,
    'slicc-kernel-negative': 'npm:@ai-ecoverse/slicc-kernel@1.78.0',
  },
});

function statement(v, edit = () => {}) {
  const s = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: `pkg:npm/%40ai-ecoverse/slicc-kernel@${v}`, digest: { sha512: digest.toString('hex') } }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: { workflow: { ref: 'refs/heads/main', repository: REPO, path: '.github/workflows/release.yml' } },
        resolvedDependencies: [{ uri: `git+${REPO}@refs/heads/main`, digest: { gitCommit: COMMIT } }],
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: { invocationId: 'https://github.com/ai-ecoverse/slicc-kernel/actions/runs/39435789511/attempts/1' },
      },
    },
  };
  edit(s);
  return s;
}

const attested = (s) => ({
  attestations: [
    { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: { dsseEnvelope: { payload: '' } } },
    { predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(s)).toString('base64') } } },
  ],
});

function fetchers({ edit, doc, manifest, compare = { status: 'ahead', merge_base_commit: { sha: COMMIT } }, fail } = {}) {
  const calls = [];
  return {
    calls,
    async manifest(v) {
      calls.push(['manifest', v]);
      if (fail === 'manifest') throw new Error('HTTP 503');
      return manifest ?? { version: v, dist: { integrity } };
    },
    async attestations(v) {
      calls.push(['attestations', v]);
      if (fail === 'attestations') throw new Error('ECONNRESET');
      return doc !== undefined ? doc : attested(statement(v, edit));
    },
    async compare(c) {
      calls.push(['compare', c]);
      if (fail === 'compare') throw new Error('HTTP 404');
      return compare;
    },
  };
}

test('a pin with provenance from slicc-kernel release.yml on main, GitHub-hosted, for its bytes, from a commit on main passes', async () => {
  const f = fetchers();
  const r = await checkCertKernel(pkg('1.136.8'), f);
  assert.deepEqual(r, { pin: '1.136.8', integrity, commit: COMMIT, run: 'https://github.com/ai-ecoverse/slicc-kernel/actions/runs/39435789511/attempts/1' });
  assert.deepEqual(f.calls, [
    ['manifest', '1.136.8'],
    ['attestations', '1.136.8'],
    ['compare', COMMIT],
  ]);
  const same = await checkCertKernel(pkg('1.136.8'), fetchers({ compare: { status: 'identical', merge_base_commit: { sha: COMMIT } } }));
  assert.equal(same.commit, COMMIT);
});

test('no attestation fails', async () => {
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ doc: null })), /has no valid provenance: no npm provenance attestation/);
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ doc: { attestations: [] } })), /no SLSA provenance among its attestations/);
});

test('provenance from another workflow, repository or builder fails', async () => {
  const cases = [
    [(s) => (s.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/manual-publish.yml'), /manual-publish\.yml, not \.github\/workflows\/release\.yml/],
    [(s) => (s.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/someone/slicc-kernel'), /someone\/slicc-kernel, not https:\/\/github\.com\/ai-ecoverse\/slicc-kernel/],
    [(s) => (s.predicate.runDetails.builder.id = 'https://github.com/actions/runner/self-hosted'), /self-hosted, not GitHub-hosted/],
  ];
  for (const [edit, why] of cases) {
    const f = fetchers({ edit });
    await assert.rejects(checkCertKernel(pkg('1.136.8'), f), why);
    assert.ok(!f.calls.some(([c]) => c === 'compare'));
  }
});

test('provenance from another ref fails', async () => {
  const edit = (s) => (s.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/bb/hotfix');
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ edit })), /refs\/heads\/bb\/hotfix, not refs\/heads\/main/);
});

test('an integrity mismatch fails: provenance for other bytes, or for another version', async () => {
  const other = `sha512-${createHash('sha512').update('republished bytes').digest('base64')}`;
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ manifest: { version: '1.136.8', dist: { integrity: other } } })), /other bytes than the published tarball's/);
  const edit = (s) => (s.subject[0].name = 'pkg:npm/%40ai-ecoverse/slicc-kernel@1.136.7');
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ edit })), /another subject than pkg:npm\/%40ai-ecoverse\/slicc-kernel@1\.136\.8/);
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ manifest: { version: '1.136.8', dist: {} } })), /no sha512 dist\.integrity/);
});

test('a provenance commit that is not on slicc-kernel main fails', async () => {
  for (const compare of [
    { status: 'diverged', merge_base_commit: { sha: 'a'.repeat(40) } },
    { status: 'behind', merge_base_commit: { sha: 'a'.repeat(40) } },
    { status: 'ahead', merge_base_commit: { sha: 'a'.repeat(40) } },
    {},
  ]) {
    await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ compare })), new RegExp(`${COMMIT} is not on ai-ecoverse/slicc-kernel main`), JSON.stringify(compare));
  }
});

test('a pin that is not an exact version fails before any fetch', async () => {
  for (const pin of ['^1.102.5', '~1.102.5', 'latest', '1.102', ' 1.102.5', 'npm:@ai-ecoverse/slicc-kernel@1.102.5', undefined]) {
    const f = fetchers();
    await assert.rejects(checkCertKernel(pkg(pin), f), /is not an exact version/, String(pin));
    assert.deepEqual(f.calls, []);
  }
});

test('a network or attestation-fetch error fails closed, with the reason', async () => {
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ fail: 'manifest' })), /cannot read the registry manifest: HTTP 503/);
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ fail: 'attestations' })), /cannot read its npm attestations: ECONNRESET/);
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ fail: 'compare' })), /cannot check that commit .* is on ai-ecoverse\/slicc-kernel main: HTTP 404/);
  const garbled = { attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: 'not base64 json' } } }] };
  await assert.rejects(checkCertKernel(pkg('1.136.8'), fetchers({ doc: garbled })), /unreadable SLSA provenance statement/);
});
