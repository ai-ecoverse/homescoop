export default async function (ctx) {
  const { run, read, assert } = ctx;
  const cwd = '/home/screen';
  await run(['mkdir', '-p', cwd], { cwd: '/home' });
  const r = await run(['bash', '--norc', '-c', [
    'rm -f F.log H.txt',
    'screen -L -Logfile /home/screen/F.log -dmS L bash --norc; sleep 1',
    'screen -S L -X stuff \'echo logged-$((6*7))\\n\'; sleep 1',
    'screen -S L -X hardcopy /home/screen/H.txt; sleep 0.5',
    'screen -S L -X quit; sleep 0.5',
  ].join('\n')], { cwd });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const hardcopy = await read(`${cwd}/H.txt`);
  const log = await read(`${cwd}/F.log`);
  assert.match(hardcopy, /^logged-42\s*$/m, `-X hardcopy has the window's output: ${JSON.stringify(hardcopy)}`);
  assert.match(log, /^logged-42\r?$/m, `-L -Logfile has the window's output: ${JSON.stringify(log)}`);
  console.log('stuff-log: -X stuff runs a command in the window; -X hardcopy and -L -Logfile both hold logged-42');
}
