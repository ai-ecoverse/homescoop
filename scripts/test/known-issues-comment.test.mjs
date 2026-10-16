// ladder-pr's known-issues job: open next-build issues that name a touched package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { matchIssues, renderComment, titleLead, MARKER } from '../known-issues-comment.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-known-'));
  const pkg = (dir, name) => {
    mkdirSync(join(root, 'packages', dir, 'package'), { recursive: true });
    writeFileSync(join(root, 'packages', dir, 'package', 'package.json'), JSON.stringify({ name }));
  };
  pkg('sed', '@ai-ecoverse/wasm-sed');
  pkg('tree', '@ai-ecoverse/wasm-tree');
  pkg('file', '@ai-ecoverse/wasm-file');
  pkg('wasi-uv', '@ai-ecoverse/wasi-uv');
  pkg('bash', '@ai-ecoverse/wasm-bash');
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const issues = [
  { number: 683, title: '[cert] wasm-sed: cert covers only -i and e' },
  { number: 687, title: '[cert] which, tree, util-linux: no spec checks permissions' },
  { number: 690, title: 'tree -u prints the owner as a uid' },
  { number: 706, title: '[cert] wasi-uv: file locks are no-ops on WASI' },
  { number: 611, title: 'Emscripten packages keep the symlink limit (bash > redirections)' },
  { number: 655, title: 'ulimit limits are not inherited (wasm-bash 5.3.0-19)' },
  { number: 700, title: 'wasm-sedx: a different package' },
];

test('titleLead: text before the first colon, without a [tag]', () => {
  assert.equal(titleLead('[cert] which, tree, util-linux: x: y'), 'which, tree, util-linux');
  assert.equal(titleLead('tree -u prints'), 'tree');
});

test('matchIssues: npm names anywhere in the title, bare dir names only in the lead', () => {
  fixture((root) => {
    const m = Object.fromEntries(
      matchIssues(['sed', 'tree', 'file', 'wasi-uv', 'bash'], issues, root).map((x) => [x.dir, x.issues.map((i) => i.number)])
    );
    assert.deepEqual(m.sed, [683]); // not wasm-sedx
    assert.deepEqual(m.tree, [687, 690]);
    assert.deepEqual(m.file, []); // "file locks" in #706 is prose, not the package
    assert.deepEqual(m['wasi-uv'], [706]);
    assert.deepEqual(m.bash, [655]); // "(bash > ...)" outside the lead doesn't count
  });
});

test('renderComment: one marked comment; a "none" body when nothing matches', () => {
  fixture((root) => {
    const body = renderComment(matchIssues(['sed', 'file'], issues, root));
    assert.ok(body.startsWith(MARKER));
    assert.match(body, /\*\*sed\*\* \(`@ai-ecoverse\/wasm-sed`\)\n- #683 /);
    assert.doesNotMatch(body, /\*\*file\*\*/);
    const none = renderComment(matchIssues(['file'], issues, root));
    assert.ok(none.startsWith(MARKER));
    assert.match(none, /No open `next-build` issue names a package this PR touches \(`file`\)/);
  });
});
