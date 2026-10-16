import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
from packaging.version import Version
from packaging.specifiers import SpecifierSet
from packaging.requirements import Requirement
from packaging.markers import Marker
from packaging.tags import sys_tags
from packaging.utils import canonicalize_name
vs = ["1.0", "1.0.post1", "1.0rc1", "2.0.dev3", "1.10", "1.9"]
req = Requirement('Requests[security]>=2.8.1,<3 ; python_version >= "3.8"')
out = {
    "sorted": [str(v) for v in sorted(map(Version, vs))],
    "spec": [v for v in vs if v in SpecifierSet(">=1.0,<2,!=1.9")],
    "req": [req.name, sorted(req.extras), str(req.specifier), str(req.marker), req.marker.evaluate()],
    "marker": Marker('os_name == "nt"').evaluate({"os_name": "posix"}),
    "canon": canonicalize_name("Foo.Bar_baz"),
    "tag": str(next(iter(sys_tags()))).split("-")[0],
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/packaging_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/packaging_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.sorted, ['1.0rc1', '1.0', '1.0.post1', '1.9', '1.10', '2.0.dev3'], o);
  assert.deepEqual(out.spec, ['1.0', '1.0.post1', '1.10'], o);
  assert.deepEqual(out.req, ['Requests', ['security'], '<3,>=2.8.1', 'python_version >= "3.8"', true], o);
  assert.equal(out.marker, false, o);
  assert.equal(out.canon, 'foo-bar-baz', o);
  assert.equal(out.tag, 'cp314', o);
  console.log(`packaging on wasix-python ${python}: Version ordering, SpecifierSet, Requirement + marker, canonicalize_name, sys_tags ${out.tag}`);
}
