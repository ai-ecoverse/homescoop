import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default async function ({ assert, dir, stdout, version }) {
  assert.match(stdout, new RegExp(`^libxml2 ${version.replaceAll('.', '\\.')}$`, 'm'), 'LIBXML_DOTTED_VERSION is the recipe version');
  const raw = readFileSync(join(dir, 'probe.xml'));
  assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe], 'probe.xml is UTF-16LE with a BOM');
  const text = raw.subarray(2).toString('utf16le');
  assert.match(text, /^<\?xml version="1\.0" encoding="UTF-16"\?>/);
  assert.match(text, /<title>Naïve café<\/title>/, 'the ISO-8859-1 title, re-encoded');
  assert.match(text, /<book id="3">\s*<title>日本 &amp; &lt;more&gt;<\/title>/, "the new book, escaped, decoded by Node's own UTF-16");
}
