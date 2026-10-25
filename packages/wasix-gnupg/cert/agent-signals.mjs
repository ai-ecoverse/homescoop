export default async function (ctx) {
  const { run, assert } = ctx;
  const G = '/home/gnupg-sig';
  const sh = (script) => run(['bash', '-c', `export GNUPGHOME=${G}; ${script}`], { cwd: '/home' });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r.stdout;
  };
  const pid = async () => /^D (\d+)$/m.exec(await ok('gpg-connect-agent "getinfo pid" /bye'))?.[1];
  await ok(`mkdir -p ${G} && chmod 700 ${G} && printf 'log-file ${G}/agent.log\\nverbose\\n' > ${G}/gpg-agent.conf`);
  const first = await pid();
  assert.ok(first, 'no gpg-agent pid');
  await ok(`kill -HUP ${first}`);
  const t0 = Date.now();
  let hup = '';
  while (Date.now() - t0 < 10000 && !/SIGHUP received/.test(hup)) {
    hup = await ok(`sleep 0.2; cat ${G}/agent.log`);
  }
  assert.match(hup, /SIGHUP received - re-reading configuration and flushing cache/, `HUP: ${hup}`);
  assert.equal(await pid(), first, 'gpg-agent restarted after SIGHUP');
  await ok(`kill -TERM ${first}`);
  const t1 = Date.now();
  let term = '';
  let alive = true;
  while (Date.now() - t1 < 10000 && alive) {
    term = await ok(`sleep 0.2; cat ${G}/agent.log`);
    alive = (await sh(`kill -0 ${first}`)).status === 0;
  }
  const secs = (Date.now() - t1) / 1000;
  assert.match(term, /SIGTERM received - shutting down/, `TERM: ${term}`);
  assert.equal(alive, false, `gpg-agent ${first} still alive ${secs}s after SIGTERM`);
  assert.ok(secs < 5, `gpg-agent took ${secs}s to exit after SIGTERM`);
  const second = await pid();
  assert.ok(second && second !== first, `no new gpg-agent after TERM: ${second}`);
  await ok(`kill -INT ${second}`);
  const t2 = Date.now();
  let int = '';
  alive = true;
  while (Date.now() - t2 < 10000 && alive) {
    int = await ok(`sleep 0.2; cat ${G}/agent.log`);
    alive = (await sh(`kill -0 ${second}`)).status === 0;
  }
  assert.match(int, /SIGINT received - immediate shutdown/, `INT: ${int}`);
  assert.equal(alive, false, `gpg-agent ${second} still alive after SIGINT`);
  const readme = await ok('for d in /node_modules /*/node_modules /*/*/node_modules /*/*/*/node_modules; do f=$d/@ai-ecoverse/wasix-gnupg/README.md; if [ -f $f ]; then cat $f; break; fi; done');
  const rec = /^- Built against wasix-sysroot 2025\.9\.30(-\d+)/m.exec(readme)?.[1];
  assert.equal(rec && `wasix-sysroot ${rec}`, 'wasix-sysroot -43', `toolchain record in README.md: ${rec}`);
  console.log(`agent-signals: pid ${first}, HUP reloads in place, TERM exits in ${secs}s, INT exits; wasix-sysroot ${rec}`);
}
