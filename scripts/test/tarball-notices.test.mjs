import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tarballNoticeErrors, buildScriptText, EMSCRIPTEN_TEXTS } from '../browser-cert/tarball-notices.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const block = (t) => `\n\`\`\`text\n${t}\n\`\`\`\n`;
const em = `## Emscripten 4.0.23 (runtime and system libraries)\n${block(EMSCRIPTEN_TEXTS.join('\n'))}`;
const files = { files: ['LICENSE', 'THIRD-PARTY-NOTICES.md'] };
const scripts = 'homescoop_notices_begin "x"\nhomescoop_notice_emscripten\n';

test('tarball notices: the file, files[] and the Emscripten texts (#893, #906)', () => {
  const ok = tarballNoticeErrors({ scripts, manifest: files, notices: `# Third-party notices\n\nx\n\n${em}\n## zlib 1.3.1\n\nsee LICENSE\n` });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.required, ['Emscripten']);
  assert.deepEqual(tarballNoticeErrors({ scripts, manifest: files, notices: null }).errors, ['THIRD-PARTY-NOTICES.md is not in the tarball (build.sh calls homescoop_notices_begin)']);
  assert.deepEqual(tarballNoticeErrors({ scripts, manifest: { files: ['LICENSE'] }, notices: em }).errors, ["package.json files[] doesn't list THIRD-PARTY-NOTICES.md"]);
  assert.deepEqual(tarballNoticeErrors({ scripts, manifest: files, notices: '## zlib\n' }).errors, ['no "## Emscripten <version>" section (build.sh calls homescoop_notice_emscripten)']);
  const thin = `## Emscripten 4.0.23 (runtime and system libraries)\n${block(EMSCRIPTEN_TEXTS[0])}`;
  assert.deepEqual(tarballNoticeErrors({ scripts, manifest: files, notices: thin }).errors, EMSCRIPTEN_TEXTS.slice(1).map((t) => `"## Emscripten 4.0.23 (runtime and system libraries)" lacks "${t}"`));
  assert.match(tarballNoticeErrors({ scripts: 'make\n', manifest: files, notices: null }).skipped, /writes no notices/);
  assert.deepEqual(tarballNoticeErrors({ scripts: '# homescoop_notice_emscripten\nhomescoop_notices_begin "x"\n', manifest: files, notices: '## zlib\n' }).errors, [], 'a commented call is not a call');
});

test('the #893 and #906 packages write notices, so the cert reads their shipped file', () => {
  for (const p of ['which', 'tree', 'util-linux', 'bzip2', 'procps', 'xz', 'zip', 'pkgconf']) {
    const text = buildScriptText(root, p);
    assert.match(text, /homescoop_notices_begin/, `${p}: build scripts call homescoop_notices_begin`);
    assert.match(text, /homescoop_notice_emscripten/, `${p}: build scripts call homescoop_notice_emscripten`);
  }
});
