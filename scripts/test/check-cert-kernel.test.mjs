import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { checkCertKernel } from '../check-cert-kernel.mjs';

const tgz = new TextEncoder().encode('kernel tarball bytes');
const sha = createHash('sha256').update(tgz).digest('hex');
const url = (v) => `https://registry.npmjs.org/@ai-ecoverse/slicc-kernel/-/slicc-kernel-${v}.tgz`;
const pkg = (pin) => ({
  devDependencies: {
    '@ai-ecoverse/slicc-kernel': pin,
    'slicc-kernel-negative': 'npm:@ai-ecoverse/slicc-kernel@1.78.0',
  },
});

function fetchers(body, { tarball = tgz, fail } = {}) {
  const calls = [];
  return {
    calls,
    async release(tag) {
      calls.push(['release', tag]);
      if (fail === 'release') throw new Error('ECONNRESET');
      return { tag_name: tag, draft: false, body };
    },
    async manifest(v) {
      calls.push(['manifest', v]);
      if (fail === 'manifest') throw new Error('HTTP 503');
      return { version: v, dist: { tarball: url(v) } };
    },
    async tarball(u) {
      calls.push(['tarball', u]);
      if (fail === 'tarball') throw new Error('socket hang up');
      return tarball;
    },
  };
}

const certified = (v, s = sha) =>
  `## ${v}\n\n<!-- cert-review -->\ncertified @ai-ecoverse/slicc-kernel@${v} sha256=${s} (covers ${v}; ci: https://example)\n`;

test('a certified pin whose registry tarball re-hashes to the cert sha passes', async () => {
  const f = fetchers(certified('1.102.5'));
  assert.deepEqual(await checkCertKernel(pkg('1.102.5'), f), { pin: '1.102.5', sha256: sha });
  assert.deepEqual(f.calls, [
    ['release', 'v1.102.5'],
    ['manifest', '1.102.5'],
    ['tarball', url('1.102.5')],
  ]);
});

test('a release with no certified line fails (1.102.6)', async () => {
  const f = fetchers('## [1.102.6](https://github.com/ai-ecoverse/slicc-kernel/compare/v1.102.5...v1.102.6)\n\n### Bug Fixes\n');
  await assert.rejects(checkCertKernel(pkg('1.102.6'), f), /1\.102\.6 is not certified/);
  assert.deepEqual(f.calls, [['release', 'v1.102.6']]);
});

test('a certified line for another version does not certify the pin', async () => {
  await assert.rejects(checkCertKernel(pkg('1.102.6'), fetchers(certified('1.102.5'))), /1\.102\.6 is not certified/);
  await assert.rejects(checkCertKernel(pkg('1.102.5'), fetchers(certified('1.102.50'))), /1\.102\.5 is not certified/);
  await assert.rejects(
    checkCertKernel(pkg('1.102.5'), fetchers(`see: certified @ai-ecoverse/slicc-kernel@1.102.5 sha256=${sha}`)),
    /not certified/,
  );
});

test('a registry tarball that does not match the certified sha fails', async () => {
  const f = fetchers(certified('1.102.5', 'a'.repeat(64)));
  await assert.rejects(checkCertKernel(pkg('1.102.5'), f), new RegExp(`sha256=${sha} does not match the certified sha256=a{64}`));
  const g = fetchers(certified('1.102.5'), { tarball: new TextEncoder().encode('force-pushed bytes') });
  await assert.rejects(checkCertKernel(pkg('1.102.5'), g), /does not match/);
});

test('a pin that is not an exact version fails before any fetch', async () => {
  for (const pin of ['^1.102.5', '~1.102.5', 'latest', '1.102', ' 1.102.5', 'npm:@ai-ecoverse/slicc-kernel@1.102.5', undefined]) {
    const f = fetchers(certified('1.102.5'));
    await assert.rejects(checkCertKernel(pkg(pin), f), /is not an exact version/, String(pin));
    assert.deepEqual(f.calls, []);
  }
});

test('a fetch or parse error fails closed', async () => {
  for (const fail of ['release', 'manifest', 'tarball']) {
    await assert.rejects(checkCertKernel(pkg('1.102.5'), fetchers(certified('1.102.5'), { fail })), /cannot/, fail);
  }
  const bad = {
    ...fetchers(certified('1.102.5')),
    async manifest() {
      return { version: '1.102.5', dist: { tarball: 'https://evil.example/k.tgz' } };
    },
  };
  await assert.rejects(checkCertKernel(pkg('1.102.5'), bad), /cannot re-hash/);
  const noBody = { ...fetchers(null), async release(tag) { return { tag_name: tag, draft: false, body: null }; } };
  await assert.rejects(checkCertKernel(pkg('1.102.5'), noBody), /missing, a draft, or has no body/);
  const conflict = fetchers(certified('1.102.5') + certified('1.102.5', 'b'.repeat(64)));
  await assert.rejects(checkCertKernel(pkg('1.102.5'), conflict), /conflicting/);
});
