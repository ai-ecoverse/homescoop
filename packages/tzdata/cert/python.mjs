import { checkCases, linkZoneinfo, ZONEINFO } from './lib/zones.mjs';

// time.strftime over time.localtime and datetime's astimezone() both go
// through libc (musl's __tz.c), which this package feeds.
const SCRIPT = String.raw`
import sys, time, datetime
for arg in sys.argv[1:]:
    k, t = arg.split("=")
    t = int(t)
    a = time.strftime("%H:%M %Z %z", time.localtime(t))
    b = datetime.datetime.fromtimestamp(t, datetime.timezone.utc).astimezone().strftime("%H:%M %Z %z")
    if a != b:
        sys.exit(f"{k}: time.localtime says {a}, datetime.astimezone {b}")
    print(k, a)
`;

const ZI = String.raw`
import json, datetime, zoneinfo
ber = zoneinfo.ZoneInfo("Europe/Berlin")
us = zoneinfo.ZoneInfo("US/Eastern")
print(json.dumps({
    "tzpath": "/usr/share/zoneinfo" in zoneinfo.TZPATH,
    "berlin": datetime.datetime(2026, 7, 15, 12, tzinfo=ber).strftime("%Z %z"),
    "eastern": datetime.datetime(2026, 1, 15, 12, tzinfo=us).strftime("%Z %z"),
    "available": {"Europe/Berlin", "America/New_York", "UTC"} <= zoneinfo.available_timezones(),
}))
`;

export default async function (ctx) {
  const { write, run, assert } = ctx;
  await linkZoneinfo(ctx);
  await write('/tmp/tz_local.py', SCRIPT);
  await checkCases(ctx, 'python', ['python3', '/tmp/tz_local.py']);

  // zoneinfo with no tzdata package: the system path, i.e. this package.
  await write('/tmp/tz_zoneinfo.py', ZI);
  const r = await run(['python3', '-c', 'import importlib.util,sys; sys.exit(importlib.util.find_spec("tzdata") is not None)'], { cwd: '/tmp' });
  assert.equal(r.status, 0, 'py-tzdata is not installed, so zoneinfo can only read the system tree');
  const z = await run(['python3', '/tmp/tz_zoneinfo.py'], { cwd: '/tmp' });
  assert.equal(z.status, 0, `zoneinfo: rc=${z.status} stderr=${z.stderr}`);
  const out = JSON.parse(z.stdout.trim().split('\n').pop());
  assert.deepEqual(out, { tzpath: true, berlin: 'CEST +0200', eastern: 'EST -0500', available: true });
  console.log(`python: zoneinfo reads Europe/Berlin and US/Eastern from /usr/share/zoneinfo (${ZONEINFO}) with no tzdata package`);
}
