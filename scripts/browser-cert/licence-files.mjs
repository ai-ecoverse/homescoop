const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export function licenceFileErrors(found, want) {
  const errors = [];
  for (const [file, phrases] of Object.entries(want)) {
    const text = found[file];
    if (text == null) {
      errors.push(`${file} is not in the package`);
      continue;
    }
    for (const p of phrases) if (!norm(text).includes(norm(p))) errors.push(`${file} lacks "${p}"`);
  }
  return errors;
}

export function licenceFilesSpec(want) {
  return async function licenceFiles(ctx) {
    const { assert } = ctx;
    const dir = `/node_modules/${ctx.npmName}`;
    const pkg = JSON.parse((await ctx.read(`${dir}/package.json`)) ?? '{}');
    const found = {};
    for (const file of Object.keys(want)) found[file] = await ctx.read(`${dir}/${file}`);
    for (const file of Object.keys(want)) assert.ok(Array.isArray(pkg.files) && pkg.files.includes(file), `package.json files[] lists ${file}: ${JSON.stringify(pkg.files)}`);
    const errors = licenceFileErrors(found, want);
    assert.deepEqual(errors, [], `${ctx.npmName}: ${errors.join('; ')}`);
    console.log(`licence files: ${ctx.npmName} ships ${Object.keys(want).join(' and ')}`);
  };
}
