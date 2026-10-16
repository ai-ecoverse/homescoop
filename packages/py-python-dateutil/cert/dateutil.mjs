const SCRIPT = String.raw`
import json, datetime
from dateutil import parser, relativedelta, rrule, tz, easter
d = parser.parse("Fri, 16 Oct 2026 13:45:10 +0200")
ber = tz.gettz("Europe/Berlin")
out = {
    "parse": [d.isoformat(), parser.parse("2026-10-16T13:45").isoformat(), parser.parse("16/10/2026", dayfirst=True).date().isoformat()],
    "fuzzy": parser.parse("meet on 3 March 2027 at noon", fuzzy=True).isoformat(),
    "relativedelta": (datetime.date(2026, 1, 31) + relativedelta.relativedelta(months=1)).isoformat(),
    "between": str(relativedelta.relativedelta(datetime.date(2026, 10, 16), datetime.date(1990, 2, 1))),
    "rrule": [x.date().isoformat() for x in rrule.rrule(rrule.MONTHLY, count=3, byweekday=rrule.FR(-1), dtstart=datetime.datetime(2026, 1, 1))],
    "tz": [datetime.datetime(2026, 7, 1, 12, tzinfo=ber).tzname(), datetime.datetime(2026, 1, 1, 12, tzinfo=ber).tzname(), str(tz.tzutc())],
    "easter": easter.easter(2027).isoformat(),
}
import six
out["six"] = six.__version__
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/dateutil_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/dateutil_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out, {
    parse: ['2026-10-16T13:45:10+02:00', '2026-10-16T13:45:00', '2026-10-16'],
    fuzzy: '2027-03-03T00:00:00',
    relativedelta: '2026-02-28',
    between: 'relativedelta(years=+36, months=+8, days=+15)',
    rrule: ['2026-01-30', '2026-02-27', '2026-03-27'],
    tz: ['CEST', 'CET', 'tzutc()'],
    easter: '2027-03-28',
    six: '1.17.0',
  });
  console.log('dateutil 2.9.0.post0: parser (RFC 2822 with offset, ISO, dayfirst, fuzzy), relativedelta (month-end clamp, age), rrule last Fridays, tz.gettz Europe/Berlin CEST/CET, easter 2027, with py-six from its range');
}
