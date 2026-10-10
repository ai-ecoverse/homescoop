/**
 * wasix-sysroot 2025.9.30-20: test/tzname.c. strftime("%Z") with tm_zone
 * pointing at a heap copy: a zone name the tz knows (EST, EDT, UTC, and
 * CET/CEST of a TZif zone) prints; anything else and NULL print "". On -19
 * (NEGATIVE.md) every copy printed "". The TZif file is the host's
 * Europe/Berlin, written into the kernel.
 */
import { existsSync, readFileSync } from 'node:fs';

export default async function (ctx) {
  const { run, assert, kernel } = ctx;
  const host = '/usr/share/zoneinfo/Europe/Berlin';
  const tzif = existsSync(host) && kernel?.writeFile;
  if (tzif) await kernel.writeFile('/tmp/zoneinfo-Berlin', readFileSync(host));
  const r = await run(['tzname', ...(tzif ? ['/tmp/zoneinfo-Berlin'] : [])], { cwd: '/tmp' });
  assert.equal(r.status, 0, `tzname rc=${r.status} ${r.stdout} ${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'own pointer: [EST]',
    'copy EST: [EST]',
    'copy EDT: [EDT]',
    'copy UTC: [UTC]',
    'copy XYZ: []',
    'null: []',
    ...(tzif ? ['tzif jan copy: [CET]', 'tzif jul copy: [CEST]', 'tzif bogus: []'] : []),
    'tzname done',
  ], r.stdout);
  if (!tzif) console.log('tzname: no host zoneinfo, TZif case skipped');
}
