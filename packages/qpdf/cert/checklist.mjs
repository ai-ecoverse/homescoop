/**
 * qpdf checklist (homescoop#96): the pdftk verbs slicc 6 had (cat, burst,
 * rotate, dump_data) plus decrypt, --check, linearize, fix-qdf and
 * zlib-flate. Test PDFs are generated here: makePdf writes a tiny
 * Helvetica PDF with one line of text per page and a correct xref.
 */

function makePdf(texts) {
  const objs = [];
  const pageIds = texts.map((_, i) => 4 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${texts.length} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  texts.forEach((t, i) => {
    const content = `BT /F1 18 Tf 20 50 Td (${t}) Tj ET`;
    objs[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
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

export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/qp';
  const go = (argv) => run(argv, { cwd });
  const sh = (script) => run(['bash', '-c', script], { cwd });
  const ok = async (argv) => {
    const r = await go(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const npages = async (f) => Number((await ok(['qpdf', '--show-npages', f])).stdout.trim());
  // Page texts in order: uncompressed QDF puts every content stream inline.
  const texts = async (f) => {
    const r = await ok(['qpdf', '--qdf', '--object-streams=disable', f, '-']);
    return [...r.stdout.matchAll(/\(([A-Za-z !]*)\) Tj/g)].map((m) => m[1]);
  };

  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);
  for (const [file, pages] of [
    ['a.pdf', ['Alpha one', 'Alpha two', 'Alpha three']],
    ['b.pdf', ['Bravo one', 'Bravo two']],
  ]) {
    const w = await run(['bash', '-c', `cat > ${file}`], { cwd, stdin: makePdf(pages) });
    assert.equal(w.status, 0, `write ${file} stderr=${w.stderr}`);
  }

  const ver = await ok(['qpdf', '--version']);
  assert.match(ver.stdout, /^qpdf version 12\.4\.2$/m);

  // --check on a good file.
  const chk = await ok(['qpdf', '--check', 'a.pdf']);
  assert.match(chk.stdout, /PDF Version: 1\.4/);
  assert.match(chk.stdout, /No syntax or stream encoding errors found/);
  assert.equal(await npages('a.pdf'), 3);

  // pdftk cat: merge, in order.
  await ok(['qpdf', '--empty', '--pages', 'a.pdf', 'b.pdf', '--', 'm.pdf']);
  assert.equal(await npages('m.pdf'), 5);
  assert.deepEqual(await texts('m.pdf'), ['Alpha one', 'Alpha two', 'Alpha three', 'Bravo one', 'Bravo two']);

  // Page ranges and reordering.
  await ok(['qpdf', 'm.pdf', '--pages', '.', '5,1-2', '--', 'r.pdf']);
  assert.deepEqual(await texts('r.pdf'), ['Bravo two', 'Alpha one', 'Alpha two']);
  await ok(['qpdf', '--empty', '--pages', 'a.pdf', 'z-1', 'b.pdf', '1', '--', 'rz.pdf']);
  assert.deepEqual(await texts('rz.pdf'), ['Alpha three', 'Alpha two', 'Alpha one', 'Bravo one']);

  // pdftk burst: one file per page.
  await ok(['mkdir', 'split']);
  await ok(['qpdf', '--split-pages', 'm.pdf', 'split/page-%d.pdf']);
  const ls = await ok(['ls', 'split']);
  assert.equal(ls.stdout, 'page-1.pdf\npage-2.pdf\npage-3.pdf\npage-4.pdf\npage-5.pdf\n');
  assert.equal(await npages('split/page-4.pdf'), 1);
  assert.deepEqual(await texts('split/page-4.pdf'), ['Bravo one']);

  // pdftk rotate: only page 1 gets /Rotate 90.
  await ok(['qpdf', '--rotate=+90:1', 'a.pdf', 'rot.pdf']);
  const rj = JSON.parse((await ok(['qpdf', '--json', 'rot.pdf'])).stdout);
  const objs = rj.qpdf[1];
  const rot = rj.pages.map((p) => objs[`obj:${p.object}`].value['/Rotate'] ?? 0);
  assert.deepEqual(rot, [90, 0, 0], `rotations ${JSON.stringify(rot)}`);

  // pdftk dump_data: --json metadata.
  const j = JSON.parse((await ok(['qpdf', '--json', 'm.pdf'])).stdout);
  assert.equal(j.version, 2);
  assert.equal(j.pages.length, 5);
  assert.equal(j.encrypt.encrypted, false);
  assert.equal(j.qpdf[0].pdfversion, '1.4');

  // Encrypt (AES-256, needs the kernel's random source), then decrypt.
  await ok(['qpdf', '--encrypt', '--user-password=u', '--owner-password=o', '--bits=256', '--', 'a.pdf', 'enc.pdf']);
  assert.equal((await go(['qpdf', '--is-encrypted', 'enc.pdf'])).status, 0);
  assert.equal((await go(['qpdf', '--requires-password', 'enc.pdf'])).status, 0);
  assert.equal((await go(['qpdf', '--requires-password', 'a.pdf'])).status, 2);
  const se = await ok(['qpdf', '--show-encryption', '--password=u', 'enc.pdf']);
  assert.match(se.stdout, /^R = 6$/m);
  assert.match(se.stdout, /Supplied password is user password/);
  const nopw = await go(['qpdf', '--check', 'enc.pdf']);
  assert.equal(nopw.status, 2, `no password rc=${nopw.status}`);
  assert.match(nopw.stderr, /invalid password/);
  const badpw = await go(['qpdf', '--password=nope', '--decrypt', 'enc.pdf', 'x.pdf']);
  assert.equal(badpw.status, 2, `wrong password rc=${badpw.status}`);
  assert.match(badpw.stderr, /invalid password/);
  await ok(['qpdf', '--password=u', '--decrypt', 'enc.pdf', 'dec.pdf']);
  assert.equal((await go(['qpdf', '--is-encrypted', 'dec.pdf'])).status, 2, 'dec.pdf still encrypted');
  assert.deepEqual(await texts('dec.pdf'), ['Alpha one', 'Alpha two', 'Alpha three']);
  await ok(['qpdf', '--password=o', '--decrypt', 'enc.pdf', 'dec-o.pdf']);
  assert.deepEqual(await texts('dec-o.pdf'), ['Alpha one', 'Alpha two', 'Alpha three']);

  // Linearize.
  const notLin = await ok(['qpdf', '--check-linearization', 'a.pdf']);
  assert.match(notLin.stdout, /a\.pdf is not linearized/);
  await ok(['qpdf', '--linearize', 'm.pdf', 'lin.pdf']);
  const lin = await ok(['qpdf', '--check-linearization', 'lin.pdf']);
  assert.match(lin.stdout, /lin\.pdf: no linearization errors/);
  assert.match((await ok(['qpdf', '--check', 'lin.pdf'])).stdout, /File is linearized/);
  assert.equal(await npages('lin.pdf'), 5);

  // fix-qdf: edit a QDF file by hand (stream length changes), then repair.
  await ok(['qpdf', '--qdf', '--object-streams=disable', 'a.pdf', 'q.pdf']);
  const qdf = (await ok(['cat', 'q.pdf'])).stdout;
  assert.ok(qdf.includes('(Alpha two) Tj'), 'q.pdf has no inline content stream');
  const edit = await run(['bash', '-c', 'cat > q-edit.pdf'], {
    cwd,
    stdin: qdf.replace('(Alpha two)', '(Alpha TWO edited!)'),
  });
  assert.equal(edit.status, 0, `write q-edit.pdf stderr=${edit.stderr}`);
  // Unfixed, the stale /Length and xref make qpdf complain.
  assert.notEqual((await go(['qpdf', '--check', 'q-edit.pdf'])).stderr, '');
  const fq = await ok(['bash', '-c', 'fix-qdf q-edit.pdf > fixed.pdf']);
  assert.equal(fq.stderr, '');
  const fchk = await ok(['qpdf', '--check', 'fixed.pdf']);
  assert.match(fchk.stdout, /No syntax or stream encoding errors found/);
  assert.doesNotMatch(fchk.stderr, /WARNING/);
  assert.deepEqual(await texts('fixed.pdf'), ['Alpha one', 'Alpha TWO edited!', 'Alpha three']);

  // zlib-flate round trip, and the stream qpdf wrote is really zlib.
  const zr = await sh('printf "hello homescoop\\n" | zlib-flate -compress | zlib-flate -uncompress');
  assert.equal(zr.status, 0, `zlib-flate stderr=${zr.stderr}`);
  assert.equal(zr.stdout, 'hello homescoop\n');
  const zh = await sh('printf abc | zlib-flate -compress | od -An -tx1 -N2 | tr -d " \\n"');
  assert.equal(zh.stdout, '789c', `zlib header ${zh.stdout}`);
  const zbad = await sh('printf "not zlib" | zlib-flate -uncompress');
  assert.notEqual(zbad.status, 0, 'zlib-flate -uncompress on garbage should fail');

  // Corrupt input: non-zero exit.
  await ok(['bash', '-c', 'printf "garbage, not a pdf" > bad.pdf; head -c 400 a.pdf > trunc.pdf']);
  const bad = await go(['qpdf', '--check', 'bad.pdf']);
  assert.equal(bad.status, 2, `garbage rc=${bad.status}`);
  assert.match(bad.stderr, /can't find PDF header/);
  const trunc = await go(['qpdf', '--check', 'trunc.pdf']);
  assert.equal(trunc.status, 3, `truncated rc=${trunc.status}`);
  assert.match(trunc.stderr, /file is damaged/);
  const miss = await go(['qpdf', '--check', 'no-such.pdf']);
  assert.equal(miss.status, 2, `missing rc=${miss.status}`);
  assert.match(miss.stderr, /No such file/);
}
