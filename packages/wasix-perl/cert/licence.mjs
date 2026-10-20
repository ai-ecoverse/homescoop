const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export default async function (ctx) {
  const { assert } = ctx;
  const dir = `/node_modules/${ctx.npmName}`;
  const pkg = JSON.parse((await ctx.read(`${dir}/package.json`)) ?? '{}');
  assert.equal(pkg.license, 'Artistic-1.0-Perl OR GPL-1.0-or-later', `package.json license: ${pkg.license}`);
  const licence = norm((await ctx.read(`${dir}/LICENSE`)) ?? '');
  assert.ok(licence.length > 0, `${dir}/LICENSE is missing`);
  const texts = {
    'Artistic-1.0-Perl': 'The "Artistic License" Preamble The intent of this document is to state the conditions under which a Package may be copied',
    'GPL-1.0-or-later': 'GNU GENERAL PUBLIC LICENSE Version 1, February 1989',
  };
  for (const [id, text] of Object.entries(texts)) assert.ok(licence.includes(text), `package/LICENSE has no ${id} text ("${text}")`);
  for (const f of ['Artistic', 'Copying']) assert.ok(licence.includes(`==> ${f} <==`), `package/LICENSE has no ${f} section`);
  console.log(`licence: ${pkg.license}; LICENSE has the Artistic and the GPL (Copying) texts`);
}
