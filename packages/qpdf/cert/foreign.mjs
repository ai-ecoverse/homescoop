function pdf(texts, { dangling = false } = {}) {
  const objs = [];
  const pageIds = texts.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${texts.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  texts.forEach((t, i) => {
    const content = `BT /F1 18 Tf 20 50 Td (${t}) Tj ET`;
    const extra = dangling && i === 0 ? ' /XObject << /Gone 99 0 R >>' : '';
    objs[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ` +
      `/Resources << /Font << /F1 3 0 R >>${extra} >> /Contents ${5 + i * 2} 0 R >>`;
    objs[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offs = [];
  for (let id = 1; id < objs.length; id++) {
    offs[id] = out.length;
    out += `${id} 0 obj\n${objs[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objs.length; id++) out += `${String(offs[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

const TRAP = /RuntimeError|unreachable|Aborted|memory access out of bounds|wasm trap|exception thrown/i;

export default async function foreign(ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/qpforeign';
  const go = (argv) => run(argv, { cwd });
  const ok = async (argv) => {
    const r = await go(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    assert.doesNotMatch(r.stderr, TRAP, `${argv.join(' ')}: trap`);
    return r;
  };
  const doc = async (f) => JSON.parse((await ok(['qpdf', '--json', '--json-key=pages', '--json-key=qpdf', '--json-stream-data=inline', '--decode-level=generalized', f])).stdout);
  const texts = async (f) => {
    const j = await doc(f);
    const objs = j.qpdf[1];
    return j.pages.map((p) => {
      const data = p.contents.map((c) => Buffer.from(objs[`obj:${c}`].stream.data, 'base64').toString('latin1')).join('\n');
      return [...data.matchAll(/\(([A-Za-z !]*)\) Tj/g)].map((m) => m[1]).join('|');
    });
  };
  const fonts = async (f) => Object.values((await doc(f)).qpdf[1]).filter((o) => o.value && o.value['/Type'] === '/Font').length;
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  for (const [file, body] of [
    ['a.pdf', pdf(['Alpha one', 'Alpha two', 'Alpha three'])],
    ['b.pdf', pdf(['Bravo one', 'Bravo two'])],
    ['c.pdf', pdf(['Charlie one', 'Charlie two'], { dangling: true })],
  ]) {
    const w = await run(['bash', '-c', `cat > ${file}`], { cwd, stdin: body });
    assert.equal(w.status, 0, `write ${file}: ${w.stderr}`);
  }

  await ok(['qpdf', '--empty', '--pages', 'a.pdf', '1', 'b.pdf', '1', 'a.pdf', '2', 'b.pdf', '2', 'a.pdf', '3', '--', 'i.pdf']);
  assert.deepEqual(await texts('i.pdf'), ['Alpha one', 'Bravo one', 'Alpha two', 'Bravo two', 'Alpha three']);
  assert.equal(await fonts('i.pdf'), 2, 'interleaved pages share one copied font per source file');
  const ic = await ok(['qpdf', '--check', 'i.pdf']);
  assert.match(ic.stdout, /No syntax or stream encoding errors found/);

  await ok(['qpdf', '--empty', '--pages', 'b.pdf', '2,2,1,2', 'b.pdf', '1', '--', 'rep.pdf']);
  assert.deepEqual(await texts('rep.pdf'), ['Bravo two', 'Bravo two', 'Bravo one', 'Bravo two', 'Bravo one']);
  assert.equal(await fonts('rep.pdf'), 1, 'repeated pages from one file copy its font once');

  await ok(['qpdf', 'a.pdf', '--pages', '.', '1', 'b.pdf', '2', '.', '3', '--', 'self.pdf']);
  assert.deepEqual(await texts('self.pdf'), ['Alpha one', 'Bravo two', 'Alpha three']);

  await ok(['qpdf', '--compress-streams=y', '--object-streams=disable', 'i.pdf', 'z.pdf']);
  const zq = await ok(['cat', 'z.pdf']);
  assert.match(zq.stdout, /\/Filter \/FlateDecode/, 'qpdf.wasm deflates the copied content streams (zlib linked)');
  assert.deepEqual(await texts('z.pdf'), ['Alpha one', 'Bravo one', 'Alpha two', 'Bravo two', 'Alpha three']);

  const d = await ok(['qpdf', '--empty', '--pages', 'c.pdf', 'a.pdf', '2', '--', 'd.pdf']);
  assert.equal(d.stderr, '', 'a dangling reference copies as null, quietly');
  assert.deepEqual(await texts('d.pdf'), ['Charlie one', 'Charlie two', 'Alpha two']);
  assert.match((await ok(['qpdf', '--check', 'd.pdf'])).stdout, /No syntax or stream encoding errors found/);

  await ok(['bash', '-c', 'head -c 400 b.pdf > trunc.pdf; printf "garbage, not a pdf" > bad.pdf']);
  const t = await go(['qpdf', '--empty', '--pages', 'a.pdf', '1', 'trunc.pdf', '--', 'out-trunc.pdf']);
  assert.equal(t.status, 3, `damaged --pages source rc=${t.status}`);
  assert.match(t.stderr, /trunc\.pdf: file is damaged/);
  assert.match(t.stderr, /operation succeeded with warnings/);
  assert.doesNotMatch(t.stderr, TRAP, 'damaged source: no trap');
  assert.equal((await texts('out-trunc.pdf'))[0], 'Alpha one');
  for (const [src, msg] of [
    ['bad.pdf', /bad\.pdf: unable to find trailer dictionary/],
    ['none.pdf', /open none\.pdf: No such file or directory/],
  ]) {
    const r = await go(['qpdf', '--empty', '--pages', 'a.pdf', '1', src, '--', `out-${src}`]);
    assert.equal(r.status, 2, `${src} as a --pages source rc=${r.status}`);
    assert.match(r.stderr, msg);
    assert.doesNotMatch(r.stderr, TRAP, `${src}: no trap`);
    assert.notEqual((await go(['test', '-e', `out-${src}`])).status, 0, `${src}: no output written`);
  }
}
