export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/screen';
  await run(['mkdir', '-p', cwd], { cwd: '/home' });
  const sh = (script) => run(['bash', '--norc', '-c', script], { cwd });
  const r = await sh([
    'screen -dmS W bash --norc; sleep 1',
    'screen -S W -X screen -t two bash --norc; sleep 0.5',
    'echo "[$(screen -S W -Q windows)]"',
    'echo "[$(screen -S W -Q windows \'%n %t|\')]"',
    'echo "[$(screen -S W -Q title)]"',
    'screen -S W -X quit',
  ].join('\n'));
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, '[]\n[0 bash|1 two|]\n[two]\n', 'upstream screen 5.0.1 natively prints the same three lines (homescoop#662)');
  console.log('query: -Q windows is empty on a detached session as in native 5.0.1; -Q windows FORMAT lists both windows; -Q title names the current one');
}
