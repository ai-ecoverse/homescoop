/**
 * wasi-bat checklist: bat 0.26.1 as a WASI command. --version, cat mode on
 * pipes, exact highlighting (Oniguruma regexes, the bundled syntaxes and
 * themes), decorations, line ranges, stdin, errors, the IO circle check
 * (patches/clircle-wasi.patch), paging (patches/bat-wasi-no-builtin-pager.patch),
 * the config and cache under $HOME (patches/etcetera-wasi-home.patch), custom
 * syntaxes (bat cache --build) and a tty's width (patches/console-wasi-winsize.patch).
 * Expected bytes come from native bat 0.26.1 (aarch64-apple-darwin, the same
 * .crate and features).
 */
const RS = 'fn main() {\n    println!("hi");\n}\n';
// bat --color=always -p t.rs (Monokai Extended, 8-bit colours).
const RS_HL =
  '\x1b[38;5;81mfn\x1b[0m\x1b[38;5;231m \x1b[0m\x1b[38;5;149mmain\x1b[0m\x1b[38;5;231m(\x1b[0m\x1b[38;5;231m)\x1b[0m\x1b[38;5;231m \x1b[0m\x1b[38;5;231m{\x1b[0m\n' +
  '\x1b[38;5;231m    \x1b[0m\x1b[38;5;231mprintln!\x1b[0m\x1b[38;5;231m(\x1b[0m\x1b[38;5;186m"\x1b[0m\x1b[38;5;186mhi\x1b[0m\x1b[38;5;186m"\x1b[0m\x1b[38;5;231m)\x1b[0m\x1b[38;5;231m;\x1b[0m\n' +
  '\x1b[38;5;231m}\x1b[0m\n';

export default async function (ctx) {
  const { run, write, read, pty, assert } = ctx;
  const cwd = '/home/b';
  const bat = (args, opts = {}) => run(['bat', ...args], { cwd, ...opts });
  const sh = (script, opts = {}) => run(['bash', '-c', script], { cwd, ...opts });
  // Files bat has already looked up go through the kernel: a ctx.write of a
  // path a process found missing isn't seen by the next process.
  const put = async (path, text) => {
    const r = await run(['bash', '-c', 'mkdir -p "$(dirname "$1")" && cat > "$1"', 'put', path], { cwd, stdin: text });
    assert.equal(r.status, 0, `put ${path}: ${r.stderr}`);
  };
  const out = (r) => `rc=${r.status} stdout=${JSON.stringify(r.stdout.slice(0, 400))} stderr=${JSON.stringify(r.stderr.slice(0, 400))}`;
  await write(`${cwd}/t.rs`, RS);
  await write(`${cwd}/a.json`, '{"a": [1, true]}\n');

  // --version without a git hash (GIT_CEILING_DIRECTORIES in build.sh).
  const ver = await bat(['--version']);
  assert.equal(ver.status, 0, out(ver));
  assert.equal(ver.stdout, 'bat 0.26.1\n');

  // Not a terminal: cat, byte for byte, as upstream.
  const plain = await bat(['t.rs']);
  assert.equal(plain.status, 0, out(plain));
  assert.equal(plain.stdout, RS);
  assert.equal((await sh('bat t.rs | bat')).stdout, RS, 'bat | bat');

  // Highlighting: Oniguruma, the bundled Rust syntax and default theme.
  const hl = await bat(['--color=always', '-p', 't.rs']);
  assert.equal(hl.stdout, RS_HL, out(hl));
  // Syntax by file name, by -l, and from stdin.
  const dk = await sh('printf "FROM alpine\\nRUN ls\\n" > Dockerfile && bat --color=always -p Dockerfile');
  assert.equal(dk.stdout, '\x1b[38;5;203mFROM\x1b[0m\x1b[38;5;231m alpine\x1b[0m\n\x1b[38;5;203mRUN \x1b[0m\x1b[38;5;231mls\x1b[0m\n', out(dk));
  const json = '\x1b[38;5;231m{\x1b[0m\x1b[38;5;208m"\x1b[0m\x1b[38;5;208ma\x1b[0m\x1b[38;5;208m"\x1b[0m\x1b[38;5;231m:\x1b[0m\x1b[38;5;231m \x1b[0m\x1b[38;5;231m[\x1b[0m\x1b[38;5;141m1\x1b[0m\x1b[38;5;231m,\x1b[0m\x1b[38;5;231m \x1b[0m\x1b[38;5;141mtrue\x1b[0m\x1b[38;5;231m]\x1b[0m\x1b[38;5;231m}\x1b[0m\n';
  assert.equal((await bat(['--color=always', '-p', 'a.json'])).stdout, json, 'a.json');
  assert.equal((await sh('cat a.json | bat -l json --color=always -p')).stdout, json, 'pipe -l json');
  assert.equal((await bat(['-l', 'json', '--color=always', '-p', '-'], { stdin: '{"a": [1, true]}\n' })).stdout, json, 'ctx stdin, explicit -');
  // Another theme, and truecolour with COLORTERM.
  const gh = await bat(['--color=always', '-p', '--theme=GitHub', '-l', 'rs'], { stdin: 'fn x() {}\n' });
  assert.equal(gh.stdout, '\x1b[38;5;125mfn\x1b[0m\x1b[38;5;236m \x1b[0m\x1b[38;5;97mx\x1b[0m\x1b[38;5;236m(\x1b[0m\x1b[38;5;236m)\x1b[0m\x1b[38;5;236m \x1b[0m\x1b[38;5;236m{\x1b[0m\x1b[38;5;236m}\x1b[0m\n', out(gh));
  const tc = await bat(['--color=always', '-p', '-l', 'rs'], { stdin: 'fn x() {}\n', env: { COLORTERM: 'truecolor' } });
  assert.match(tc.stdout, /^\x1b\[38;2;102;217;239mfn\x1b\[0m/, out(tc));

  // Decorations: header, grid and numbers at --terminal-width.
  const full = await bat(['--color=never', '--decorations=always', '--style=full', '--terminal-width=40', 't.rs']);
  assert.equal(full.status, 0, out(full));
  assert.equal(full.stdout, [
    '─────┬──────────────────────────────────',
    '     │ File: t.rs',
    '     │ Size: 34 B',
    '─────┼──────────────────────────────────',
    '   1 │ fn main() {',
    '   2 │     println!("hi");',
    '   3 │ }',
    '─────┴──────────────────────────────────',
    '',
  ].join('\n'));
  // -r, -H, -A.
  assert.equal((await bat(['-r', '2:2', 't.rs'])).stdout, '    println!("hi");\n');
  const hi = await bat(['--color=always', '--style=numbers', '-H', '2', '--terminal-width=30', 't.rs']);
  assert.match(hi.stdout.split('\n')[1], /^\x1b\[38;5;246m {3}2\x1b\[0m \x1b\[48;5;236;38;5;231m {4}\x1b\[0m/, out(hi));
  assert.equal((await bat(['-A'], { stdin: 'a\tb\r\n' })).stdout, 'a├─┤b␍␊\n');

  // Errors: a missing file and a directory; the other inputs still print.
  const miss = await bat(['--decorations=always', '--style=header', '--color=never', 't.rs', 'nope.txt', 'a.json']);
  assert.equal(miss.status, 1, out(miss));
  assert.equal(miss.stdout, `File: t.rs\n${RS}\nFile: a.json\n{"a": [1, true]}\n`);
  assert.match(miss.stderr, /\[bat error\]\x1b\[0m: 'nope\.txt': No such file or directory/);
  const dir = await bat(['/home']);
  assert.equal(dir.status, 1, out(dir));
  assert.match(dir.stderr, /'\/home' is a directory\./);

  // patches/clircle-wasi.patch: an input that is also the output is refused.
  const loop = await sh('bat t.rs >> t.rs; echo rc=$?; cat t.rs');
  assert.equal(loop.stdout, `rc=1\n${RS}`, out(loop));
  assert.match(loop.stderr, /IO circle detected\. The input from 't\.rs' is also an output\./);
  assert.equal((await sh('bat a.json > copy.json; echo rc=$?; cat copy.json')).stdout, 'rc=0\n{"a": [1, true]}\n', 'another output file is fine');

  // patches/bat-wasi-no-builtin-pager.patch: no pager can start on WASI,
  // so every paging mode, the built-in pager too, writes to stdout.
  for (const args of [['--paging=always'], ['--paging=always', '--pager=builtin'], ['--paging=always', '--pager=less -R']]) {
    const r = await bat([...args, '-p', 't.rs']);
    assert.equal(r.status, 0, `${args.join(' ')}: ${out(r)}`);
    assert.equal(r.stdout, RS, args.join(' '));
  }
  const pg = await bat(['-p', 't.rs'], { env: { BAT_PAGER: 'builtin', BAT_PAGING: 'always' } });
  assert.equal(pg.stdout, RS, `BAT_PAGER=builtin: ${out(pg)}`);

  // patches/etcetera-wasi-home.patch: config and cache under $HOME.
  assert.equal((await bat(['--config-dir'])).stdout, '/root/.config/bat\n');
  assert.equal((await bat(['--cache-dir'])).stdout, '/root/.cache/bat\n');
  await put('/root/.config/bat/config', '# homescoop cert\n--decorations=always\n--style=numbers\n--color=never\n');
  const cfg = await bat(['t.rs']);
  assert.equal(cfg.stdout, '   1 fn main() {\n   2     println!("hi");\n   3 }\n', `config file: ${out(cfg)}`);
  assert.equal((await bat(['--no-config', 't.rs'])).stdout, RS, '--no-config');
  await put('/home/b/other-config', '--style=numbers,header\n--decorations=always\n--color=never\n');
  assert.equal((await bat(['a.json'], { env: { BAT_CONFIG_PATH: '/home/b/other-config' } })).stdout, '     File: a.json\n   1 {"a": [1, true]}\n', 'BAT_CONFIG_PATH');
  await put('/root/.config/bat/config', '');
  // homescoop#1895: without $HOME (unset or empty), the passwd entry of
  // $USER, as native bat's libc fallback; with neither, "/". No panic.
  const nohome = await sh('env -u HOME bat --config-dir; HOME= bat --cache-dir; HOME= bat t.rs');
  assert.equal(nohome.status, 0, `no HOME: ${out(nohome)}`);
  assert.equal(nohome.stdout, `/root/.config/bat\n/root/.cache/bat\n${RS}`, `no HOME: ${out(nohome)}`);
  const bare = await sh('env -i /usr/bin/bat --config-dir; env -i /usr/bin/bat --cache-dir; env -i /usr/bin/bat t.rs');
  assert.equal(bare.status, 0, `env -i: ${out(bare)}`);
  assert.equal(bare.stdout, `/.config/bat\n/.cache/bat\n${RS}`, `env -i: ${out(bare)}`);

  // build-assets: a custom syntax from ~/.config/bat/syntaxes, cached in ~/.cache/bat.
  await put('/root/.config/bat/syntaxes/Greet.sublime-syntax', [
    '%YAML 1.2', '---', 'name: Greet', 'file_extensions: [greet]', 'scope: source.greet', 'contexts:', '  main:',
    "    - match: '\\bhello\\b'", '      scope: keyword.control.greet', '',
  ].join('\n'));
  await write(`${cwd}/x.greet`, 'hello world\n');
  const before = await bat(['--color=always', '-p', 'x.greet']);
  assert.equal(before.stdout, '\x1b[38;5;231mhello world\x1b[0m\n', 'no Greet syntax yet');
  const build = await bat(['cache', '--build']);
  assert.equal(build.status, 0, out(build));
  assert.match(build.stdout, /Writing syntax set to \/root\/\.cache\/bat\/syntaxes\.bin \.\.\. okay/);
  assert.ok(await read('/root/.cache/bat/metadata.yaml'), 'metadata.yaml written');
  const after = await bat(['--color=always', '-p', 'x.greet']);
  assert.equal(after.stdout, '\x1b[38;5;203mhello\x1b[0m\x1b[38;5;231m world\x1b[0m\n', `custom syntax: ${out(after)}`);
  assert.equal((await bat(['--list-languages'])).stdout.split('\n').filter((l) => l === 'Greet:greet').length, 1, 'Greet listed');
  const clear = await bat(['cache', '--clear']);
  assert.equal(clear.status, 0, out(clear));
  assert.equal((await bat(['--color=always', '-p', 'x.greet'])).stdout, before.stdout, 'back to the built-in assets');

  // The bundled sets.
  const langs = (await bat(['--list-languages'])).stdout.split('\n');
  for (const l of ['Rust:rs', 'Python:py,py3', 'Dockerfile', 'TOML:toml', 'Markdown:md', 'TypeScript:ts', 'Zig:zig']) {
    assert.ok(langs.some((x) => x.startsWith(l)), `--list-languages has ${l}`);
  }
  assert.ok(langs.length > 150, `${langs.length} languages`);
  const themes = (await bat(['--list-themes', '--color=never'])).stdout.split('\n');
  for (const t of ['Monokai Extended', 'GitHub', 'Dracula', 'Nord', 'Solarized (dark)']) assert.ok(themes.includes(t), `--list-themes has ${t}`);
  assert.match((await bat(['--completion', 'bash'])).stdout, /complete -F _bat/, '--completion bash');

  // patches/console-wasi-winsize.patch: on a tty, decorations and colour are
  // on and the grid is the terminal's width (80 without the patch).
  for (const cols of [60, 100]) {
    const t = await pty(['bat', 't.rs'], { cwd, cols, rows: 20, timeoutMs: 30000 });
    assert.equal(t.status, 0, `pty ${cols}: ${JSON.stringify(t.out)}`);
    const lines = t.out.replace(/\x1b\[[0-9;]*m/g, '').split('\r\n');
    assert.equal(lines[0], `${'─'.repeat(5)}┬${'─'.repeat(cols - 6)}`, `pty ${cols}: top rule`);
    assert.equal(lines[1], '     │ File: t.rs');
    assert.equal(lines[3], '   1 │ fn main() {');
    assert.equal(lines[6], `${'─'.repeat(5)}┴${'─'.repeat(cols - 6)}`, `pty ${cols}: bottom rule`);
    assert.match(t.out, /\x1b\[38;2;102;217;239mfn\x1b\[0m/, `pty ${cols}: truecolour (the kernel's COLORTERM)`);
  }
  // A long line wraps at the terminal's width, not at 80 (native bat 0.26.1
  // with --terminal-width=50 prints the same).
  await write(`${cwd}/long.txt`, `${'x'.repeat(70)}\n`);
  const w = await pty(['bat', '--style=numbers', 'long.txt'], { cwd, cols: 50, rows: 20, timeoutMs: 30000 });
  assert.deepEqual(w.out.replace(/\x1b\[[0-9;]*m/g, '').split('\r\n'), [`   1 ${'x'.repeat(45)}`, `     ${'x'.repeat(25)}`, ''], `wrap: ${JSON.stringify(w.out)}`);
}
