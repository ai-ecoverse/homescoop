const SCRIPT = String.raw`
import json, datetime, pytz
ber = pytz.timezone("Europe/Berlin")
ny = pytz.timezone("America/New_York")
w = ber.localize(datetime.datetime(2026, 1, 15, 12, 0))
s = ber.localize(datetime.datetime(2026, 7, 15, 12, 0))
gap = None
try:
    ber.localize(datetime.datetime(2026, 3, 29, 2, 30), is_dst=None)
except pytz.exceptions.NonExistentTimeError:
    gap = "NonExistentTimeError"
amb = None
try:
    ber.localize(datetime.datetime(2026, 10, 25, 2, 30), is_dst=None)
except pytz.exceptions.AmbiguousTimeError:
    amb = "AmbiguousTimeError"
out = {
    "offsets": [str(w.utcoffset()), str(s.utcoffset()), w.tzname(), s.tzname()],
    "convert": s.astimezone(ny).strftime("%Y-%m-%d %H:%M %Z"),
    "utc": pytz.utc.localize(datetime.datetime(2026, 1, 1)).astimezone(ber).isoformat(),
    "gap": gap, "ambiguous": amb,
    "normalize": str(ber.normalize(ber.localize(datetime.datetime(2026, 3, 29, 1, 30)) + datetime.timedelta(hours=1))),
    "count": len(pytz.all_timezones) > 400,
    "country": "Europe/Berlin" in pytz.country_timezones["de"],
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/pytz_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/pytz_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, {
    offsets: ['1:00:00', '2:00:00', 'CET', 'CEST'],
    convert: '2026-07-15 06:00 EDT',
    utc: '2026-01-01T01:00:00+01:00',
    gap: 'NonExistentTimeError',
    ambiguous: 'AmbiguousTimeError',
    normalize: '2026-03-29 03:30:00+02:00',
    count: true,
    country: true,
  });
  console.log('pytz 2026.4: Europe/Berlin CET/CEST offsets, conversion to America/New_York (EDT), UTC localize, the 2026-03-29 spring gap (NonExistentTimeError) and 2026-10-25 fall overlap (AmbiguousTimeError), normalize across the gap, all_timezones, country_timezones');
}
