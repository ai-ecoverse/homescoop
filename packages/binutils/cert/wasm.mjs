const BASH_WASM = '/node_modules/@ai-ecoverse/wasm-bash/bin/bash.wasm';
const MODULES = {
  'mvp.wasm': 'AGFzbQEAAAABBAFgAAADAgEACgQBAgAL',
  'datacount.wasm': 'AGFzbQEAAAABBAFgAAADAgEADAEACgQBAgAL',
  'tag.wasm': 'AGFzbQEAAAABBQFgAX8ADQMBAAA=',
};

const sections = (out) => out.split('\n').filter((l) => l.startsWith('.wasm.')).map((l) => l.split(/\s+/)[0]);

export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/buwasm';
  const go = (argv) => run(argv, { cwd });
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  for (const [file, b64] of Object.entries(MODULES)) {
    const w = await run(['bash', '-c', `base64 -d > ${file}`], { cwd, stdin: b64 });
    assert.equal(w.status, 0, `write ${file}: ${w.stderr}`);
  }

  const mvp = await go(['size', '-A', 'mvp.wasm']);
  assert.equal(mvp.status, 0, `size -A mvp.wasm: ${mvp.stderr}`);
  assert.deepEqual(sections(mvp.stdout), ['.wasm.type', '.wasm.function', '.wasm.code'], mvp.stdout);

  const dc = await go(['size', '-A', 'datacount.wasm']);
  assert.equal(dc.status, 0, `size -A on a module with a DataCount section (12): rc=${dc.status} ${dc.stderr}`);
  assert.deepEqual(sections(dc.stdout), ['.wasm.type', '.wasm.function', '.wasm.datacount', '.wasm.code'], dc.stdout);
  assert.match(dc.stdout, /^\.wasm\.datacount +1 +/m, dc.stdout);

  const tag = await go(['size', '-A', 'tag.wasm']);
  assert.equal(tag.status, 0, `size -A on a module with a Tag section (13): rc=${tag.status} ${tag.stderr}`);
  assert.deepEqual(sections(tag.stdout), ['.wasm.type', '.wasm.tag'], tag.stdout);

  const bash = await go(['size', '-A', BASH_WASM]);
  assert.equal(bash.status, 0, `size -A bash.wasm (Emscripten, DataCount): rc=${bash.status} ${bash.stderr}`);
  const names = sections(bash.stdout);
  for (const s of ['.wasm.import', '.wasm.datacount', '.wasm.code', '.wasm.data']) assert.ok(names.includes(s), `size -A bash.wasm lists ${s}: ${names.join(' ')}`);
  const code = bash.stdout.match(/^\.wasm\.code +(\d+) /m);
  assert.ok(code && Number(code[1]) > 100000, `bash.wasm's code section is its bulk (${code?.[1]})`);
  const berkeley = await go(['size', BASH_WASM]);
  assert.equal(berkeley.status, 0, `size bash.wasm: ${berkeley.stderr}`);
  assert.match(berkeley.stdout, /^\s+text\s+data\s+bss\s+dec\s+hex\s+filename\n\s+0\s+0\s+0\s+0\s+0\s+\S+\/bash\.wasm\n$/, berkeley.stdout);

  const bad = await go(['bash', '-c', 'printf "\\0asm\\1\\0\\0\\0\\16\\0" > future.wasm && size -A future.wasm']);
  assert.notEqual(bad.status, 0, 'a section id BFD does not know (14) is still refused');
  assert.match(bad.stderr, /file format not recognized/, bad.stderr);
}
