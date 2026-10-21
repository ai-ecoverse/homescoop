export function detached (ctx, { env, budgetMs = 300000, pollMs = 5000, root = '/home', log = console.log } = {}) {
  const { run, write, assert } = ctx;
  let n = 0;
  return async (script, cwd = '/home') => {
    n += 1;
    const dir = `${root}/.uv-detached-${n}`;
    const budget = Math.round(budgetMs / 1000);
    log(`wasi-uv: ${cwd}$ ${script} (detached, polled, budget ${budget} s)`);
    const mk = await run(['bash', '-c', `rm -rf ${dir} && mkdir -p ${dir}`], { cwd, env });
    assert.equal(mk.status, 0, `mkdir ${dir}: ${mk.stderr}`);
    await write(`${dir}/cmd.sh`, `${script}\n`);
    await write(`${dir}/runner.sh`, [
      `bash ${dir}/cmd.sh >${dir}/out 2>${dir}/err </dev/null & p=$!`,
      `echo $p >${dir}/pid`,
      'wait $p; r=$?',
      `echo $r >${dir}/rc.tmp && mv ${dir}/rc.tmp ${dir}/rc`,
      '',
    ].join('\n'));
    const t0 = Date.now();
    const start = await run(['bash', '-c', `bash ${dir}/runner.sh </dev/null >/dev/null 2>&1 &`], { cwd, env });
    assert.equal(start.status, 0, `start ${script}: rc=${start.status} ${start.stderr}`);
    const waits = Math.max(1, Math.round(pollMs / 1000));
    for (;;) {
      const p = await run(['bash', '-c', `for i in $(seq ${waits}); do [ -s ${dir}/rc ] && break; sleep 1; done; cat ${dir}/rc 2>/dev/null; exit 0`], { cwd, env });
      const rc = p.stdout.trim();
      const seconds = Math.round((Date.now() - t0) / 1000);
      if (/^\d+$/.test(rc)) {
        const out = await run(['bash', '-c', `cat ${dir}/out`], { cwd, env });
        const err = await run(['bash', '-c', `cat ${dir}/err`], { cwd, env });
        log(`wasi-uv: ${script}: rc=${rc} in ${seconds} s (budget ${budget} s)`);
        return { status: Number(rc), stdout: out.stdout, stderr: err.stdout, seconds };
      }
      if (Date.now() - t0 >= budgetMs) {
        const tail = await run(['bash', '-c', `kill -9 $(cat ${dir}/pid 2>/dev/null) 2>/dev/null; tail -c 1500 ${dir}/err 2>/dev/null; exit 0`], { cwd, env });
        const line = `wasi-uv: FAIL ${script}: no exit within ${budget} s (detached, polled; ${seconds} s)`;
        log(line);
        assert.fail(`${line}\nstderr tail=${tail.stdout}`);
      }
    }
  };
}
