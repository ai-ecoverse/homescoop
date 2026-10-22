export default async function manifest(ctx) {
  const { assert } = ctx;
  const pkg = JSON.parse((await ctx.read(`/node_modules/${ctx.npmName}/package.json`)) ?? '{}');
  const cmds = pkg.slicc?.commands ?? {};
  assert.deepEqual(Object.keys(cmds).sort(), ['fix-qdf', 'qpdf', 'zlib-flate']);
  assert.equal(cmds['fix-qdf'].helper, true, 'fix-qdf is a helper command (slicc.commands, the KC ruling)');
  assert.equal(cmds.qpdf.helper, undefined, 'qpdf is a user command');
  assert.equal(cmds['zlib-flate'].helper, undefined, 'zlib-flate is a user command');
  assert.doesNotMatch(pkg.description, /wasm|emscripten|slicc|abi/i, 'the description is one plain sentence for a user');
}
