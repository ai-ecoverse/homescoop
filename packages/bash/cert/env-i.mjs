export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['env', '-i', 'bash', '-c', 'echo "[$PATH] [$HOME] [$USER] [$LOGNAME] [$LANG]"; export -p'], { cwd: '/tmp' });
  assert.equal(r.status, 0, r.stderr);
  const [line, ...exports] = r.stdout.trimEnd().split('\n');
  assert.equal(line, '[/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:.] [] [] [] []', `env -i bash: bash's own default PATH and no HOME, USER, LOGNAME or LANG, as GNU bash on Linux; Emscripten's getEnvStrings gave PATH=/, HOME=/home/web_user, USER=LOGNAME=web_user and LANG (homescoop#1418): ${JSON.stringify(line)}`);
  const names = exports.map((l) => /^declare -x ([A-Za-z_][A-Za-z0-9_]*)/.exec(l)?.[1]).filter(Boolean).sort();
  for (const n of names) assert.ok(['HOSTNAME', 'OLDPWD', 'PWD', 'SHLVL'].includes(n), `env -i bash exports only what bash itself sets: ${names.join(' ')}`);
  for (const n of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG']) assert.ok(!names.includes(n), `${n} is not exported: ${names.join(' ')}`);
  console.log(`env-i: env -i bash has bash's default PATH, no HOME/USER/LOGNAME/LANG, and exports only ${names.join(' ')}`);
}
