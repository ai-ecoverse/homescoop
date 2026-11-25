export default async function ({ run, write, read, assert }) {
  const H = '/home/impdesign';
  const site = `${H}/site`;
  const sections = Array.from({ length: 6 }, (_, i) => `## Section ${i + 1}\n\n${'Words about the type scale and spacing rhythm that go on for a while. '.repeat(5)}\n`).join('\n');
  const design = `---\nname: Harbor\n# All values mirror tokens.css.\ncolors:\n  brand: "#c8552b"   # the accent\n  ink: "#1a1816"\n---\n\n# Harbor Design\n\n**The One Accent Rule.** Brand is under 10% of a screen.\n\n${sections}\n## Don'ts\n\n- Don't add drop shadows to cards.\n`;
  const map = `---
name: Harbor
colors:
  brand: "#c8552b"
  ink: "#1a1816"
---

# Harbor Design

<!-- impeccable:design-map -->
Name: Harbor
Colors: brand #c8552b, ink #1a1816
Rules:
- The One Accent Rule. Brand is under 10% of a screen.
Don't:
- Don't add drop shadows to cards.
Full: .impeccable/design-full.md (read a section when you need its detail)
`;
  await write(`${site.slice(1)}/package.json`, '{"name":"site","private":true}\n');
  await write(`${site.slice(1)}/DESIGN.md`, design);
  await write(`${H.slice(1)}/empty/package.json`, '{"name":"empty","private":true}\n');
  const show = (label, r) => `${label} → rc=${r.status}\n--- stdout\n${r.stdout.slice(0, 2000)}\n--- stderr\n${r.stderr.slice(0, 1500)}`;
  const imp = (args, cwd = site) => run(['impeccable', ...args], { cwd, env: { HOME: H, IMPECCABLE_NO_UPDATE_CHECK: '1', IMPECCABLE_NO_TELEMETRY: '1' } });
  const clean = (label, r) => assert.ok(!/Unknown command|panicked|wasm trap|unreachable/.test(r.stderr), show(label, r));
  const ok = async (label, args, cwd) => {
    const r = await imp(args, cwd);
    clean(label, r);
    assert.equal(r.status, 0, show(label, r));
    assert.equal(r.stderr, '', show(label, r));
    return r.stdout;
  };

  const proposal = await ok('design-compact', ['design-compact']);
  assert.equal(proposal, `${map}
---
DESIGN.md: ${design.length} bytes now, ${map.length} as the map (saves ${design.length - map.length} bytes, about ${Math.floor((design.length - map.length) / 4)} tokens each time it is read).
The original would move to .impeccable/design-full.md, where the map points for any section's detail.
Show this to the person; write it with \`impeccable design-compact --write\` only once they agree.
`, show('design-compact', { status: 0, stdout: proposal, stderr: '' }));
  assert.equal(await read(`${site}/DESIGN.md`), design);
  assert.equal(await read(`${site}/.impeccable/design-full.md`), null);

  assert.equal(await ok('design-lookup brand', ['design-lookup', 'brand']), 'colors.brand: #c8552b (DESIGN.md frontmatter)\n');
  assert.equal(
    await ok('design-lookup nothing-like-this', ['design-lookup', 'nothing-like-this']),
    'Nothing matches nothing-like-this in DESIGN.md (frontmatter and sections), .impeccable/design.json.\n',
  );
  const bare = await imp(['design-lookup']);
  assert.equal(bare.status, 1, show('design-lookup', bare));
  assert.match(bare.stderr, /^Usage: impeccable design-lookup <term>\.\.\. \[--target <path>\]$/m, show('design-lookup', bare));

  const context = await ok('context (long DESIGN.md)', ['context']);
  assert.ok(context.includes('\n# DESIGN.md (map; full file: DESIGN.md)\n\nName: Harbor\nColors: brand #c8552b, ink #1a1816\n') && context.includes('\nLookup: `impeccable design-lookup <term>` prints one token, component or section, with its file.\n'), show('context', { status: 0, stdout: context, stderr: '' }));
  assert.ok(!context.includes('Words about the type scale'), show('context', { status: 0, stdout: context, stderr: '' }));
  assert.doesNotMatch(context, /^ACCOUNT:/m, show('context', { status: 0, stdout: context, stderr: '' }));

  assert.equal(
    await ok('design-compact --write', ['design-compact', '--write']),
    `DESIGN.md is now its map (${map.length} bytes); the original is in .impeccable/design-full.md.\n`,
  );
  assert.equal(await read(`${site}/DESIGN.md`), map);
  assert.equal(await read(`${site}/.impeccable/design-full.md`), design);

  assert.equal(
    await ok('design-compact --write (again)', ['design-compact', '--write']),
    `DESIGN.md is already short (${map.length} bytes): it is carried whole, with nothing to compact.\n`,
  );
  const section = await ok('design-lookup Section 4', ['design-lookup', 'Section 4']);
  assert.ok(section.startsWith('\n## Section 4\n\nWords about the type scale'), show('design-lookup Section 4', { status: 0, stdout: section, stderr: '' }));
  assert.ok(section.endsWith('\n(.impeccable/design-full.md:25)\n'), show('design-lookup Section 4', { status: 0, stdout: section, stderr: '' }));
  assert.equal(await ok('design-lookup brand (compacted)', ['design-lookup', 'brand']), 'colors.brand: #c8552b (DESIGN.md frontmatter)\n');

  await write(`${site.slice(1)}/DESIGN.md`, design);
  const kept = await imp(['design-compact', '--write']);
  clean('design-compact --write (archive there)', kept);
  assert.equal(kept.status, 1, show('design-compact --write (archive there)', kept));
  assert.equal(kept.stdout, '', show('design-compact --write (archive there)', kept));
  assert.equal(kept.stderr, `${site}/.impeccable/design-full.md already exists: nothing written. Move it aside first.\n`, show('design-compact --write (archive there)', kept));
  assert.equal(await read(`${site}/DESIGN.md`), design);
  assert.equal(await read(`${site}/.impeccable/design-full.md`), design);

  assert.equal(
    await ok('design-compact (no DESIGN.md)', ['design-compact'], `${H}/empty`),
    'No DESIGN.md here. `/impeccable document` writes one from the code.\n',
  );
}
