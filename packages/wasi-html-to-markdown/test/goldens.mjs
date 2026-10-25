import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const fixtures = new URL('./fixtures/', import.meta.url);
export const fixture = (name) => readFileSync(new URL(name, fixtures), 'utf8');
export const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

export function largeHtml() {
  const parts = ['<!doctype html><html><head><title>Large page</title><style>body{margin:0}</style></head><body>'];
  for (let i = 0; i < 5000; i++) {
    parts.push(
      `<section id="s${i}"><h2>Section ${i}: caf\u00e9 &amp; na\u00efve</h2>`,
      `<p>Paragraph ${i} links to <a href="https://example.com/docs/${i}?q=${i % 7}">page ${i}</a>, has <strong>bold</strong>, <em>emphasis</em> and <code>inline_${i}()</code>.</p>`,
      `<ul><li>item ${i}.1</li><li>item ${i}.2 <ol><li>nested ${i}</li></ol></li></ul>`,
      `<pre><code class="language-js">const x${i} = ${i} * 2;\nconsole.log(x${i} &lt; ${i * 3});\n</code></pre>`,
      `<table><thead><tr><th>key</th><th>value</th></tr></thead><tbody><tr><td>k${i}</td><td>${(i * 7919) % 10007}</td></tr></tbody></table>`,
      `<blockquote>Quote ${i}</blockquote><script>var s${i}=1;</script></section>`,
    );
  }
  parts.push('</body></html>');
  return parts.join('\n');
}

export const cases = [
  { name: 'page', args: [], input: () => fixture('tty.html'), golden: 'tty.md' },
  { name: 'page --plugin-table', args: ['--plugin-table'], input: () => fixture('tty.html'), golden: 'tty.table.md' },
  { name: 'invalid', args: [], input: () => fixture('invalid.html'), golden: 'invalid.md' },
  { name: 'large', args: [], input: largeHtml, digest: 'large.json' },
  { name: 'empty', args: [], input: () => '', expected: '\n' },
];

export function expected(c) {
  if (c.golden) return { text: fixture(c.golden) };
  if (c.digest) return JSON.parse(fixture(c.digest));
  return { text: c.expected };
}

export function matches(c, stdout) {
  const want = expected(c);
  if (want.text !== undefined) return stdout === want.text;
  return sha256(stdout) === want.sha256 && Buffer.byteLength(stdout) === want.bytes;
}

