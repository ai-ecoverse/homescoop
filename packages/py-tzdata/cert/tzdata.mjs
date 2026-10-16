const SCRIPT = String.raw`
import json, datetime, importlib.resources, zoneinfo
zoneinfo.reset_tzpath(to=[])
ber = zoneinfo.ZoneInfo("Europe/Berlin")
kol = zoneinfo.ZoneInfo("Asia/Kolkata")
d = datetime.datetime(2026, 7, 15, 12, 0, tzinfo=ber)
tzif = importlib.resources.files("tzdata.zoneinfo").joinpath("Europe", "Berlin").read_bytes()[:4]
out = {
    "berlin": [str(d.utcoffset()), d.tzname(), str(datetime.datetime(2026, 1, 15, 12, tzinfo=ber).utcoffset())],
    "kolkata": d.astimezone(kol).strftime("%H:%M %Z"),
    "fold": [str(datetime.datetime(2026, 10, 25, 2, 30, fold=f, tzinfo=ber).utcoffset()) for f in (0, 1)],
    "tzif": tzif.decode(),
    "available": "Europe/Berlin" in zoneinfo.available_timezones(),
}
import tzdata
out["iana"] = tzdata.IANA_VERSION
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/tzdata_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/tzdata_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, {
    berlin: ['2:00:00', 'CEST', '1:00:00'],
    kolkata: '15:30 IST',
    fold: ['2:00:00', '1:00:00'],
    tzif: 'TZif',
    available: true,
    iana: '2026d',
  });
  console.log('tzdata: zoneinfo with no system tzpath reads Europe/Berlin (CEST/CET) and Asia/Kolkata (IST) from the package, the 2026-10-25 fold 0/1 offsets, the TZif data file, available_timezones');
}
