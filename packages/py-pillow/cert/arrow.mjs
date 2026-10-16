const SCRIPT = String.raw`
import json
from PIL import Image
im = Image.new("RGBA", (3, 2), (1, 2, 3, 4))
schema = im.__arrow_c_schema__()
array = im.__arrow_c_array__()
gray = Image.new("L", (2, 2), 7).__arrow_c_array__()
print(json.dumps({
    "schema": type(schema).__name__,
    "array": [type(x).__name__ for x in array],
    "gray": [type(x).__name__ for x in gray],
    "names": [schema.__repr__().split()[0].strip("<"), array[1].__repr__().split()[0].strip("<")],
}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/pil_arrow.py', SCRIPT);
  const r = await run(['python3', '/tmp/pil_arrow.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `Image.__arrow_c_schema__/__arrow_c_array__ must not trap (homescoop#588): rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out.schema, 'PyCapsule', JSON.stringify(out));
  assert.deepEqual(out.array, ['PyCapsule', 'PyCapsule'], JSON.stringify(out));
  assert.deepEqual(out.gray, ['PyCapsule', 'PyCapsule'], JSON.stringify(out));
  console.log('Pillow Arrow export (homescoop#588): RGBA Image.__arrow_c_schema__() gives a PyCapsule and __arrow_c_array__() a (schema, array) capsule pair, L too; 12.3.0-8: wasm trap, rc 134');
}
