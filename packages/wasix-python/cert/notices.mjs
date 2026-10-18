const SCRIPT = String.raw`
import json, os, sys
text = open(os.path.join(sys.base_prefix, "THIRD-PARTY-NOTICES.md"), encoding="utf-8").read()
want = {
    "CPython incorporated software": "Licenses and Acknowledgements for Incorporated Software",
    "CPython HACL*": "HACL* Contributors",
    "OpenSSL": "## OpenSSL",
    "OpenSSL Apache-2.0": "TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
    "zlib": "Jean-loup Gailly",
    "bzip2": "Julian R Seward",
    "xz 0BSD": "Permission to use, copy, modify, and/or distribute this",
    "SQLite": "May you do good and not evil",
    "GNU Readline GPL-3.0": "Version 3, 29 June 2007",
    "ncurses": "Thomas E. Dickey",
    "libffi": "libffi - Copyright",
    "wasix-libc musl": "musl as a whole is licensed under the following standard MIT license",
    "wasix-libc cloudlibc": "Nuxi",
    "libc++": "The libc++ library is dual licensed",
    "libc++abi": "The libc++abi library is dual licensed",
    "libunwind": "The libunwind library is dual licensed",
    "GPL combined work": "distributed under the terms of the GPL-3.0-or-later",
    "Corresponding Source": "Redistributors pass on its Corresponding Source",
}
print(json.dumps({"bytes": len(text.encode()), "missing": sorted(k for k, v in want.items() if v not in text),
                  "fences": sum(1 for l in text.splitlines() if l.startswith("~~~") or l.startswith("\x60\x60\x60")) % 2}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/notices_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/notices_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim());
  assert.deepEqual(o.missing, [], `THIRD-PARTY-NOTICES.md lacks licence texts: ${o.missing.join(', ')}`);
  assert.equal(o.fences, 0, 'unbalanced code fences in THIRD-PARTY-NOTICES.md');
  assert.ok(o.bytes > 100000, `THIRD-PARTY-NOTICES.md is ${o.bytes} bytes`);
  console.log(`notices: ${o.bytes} bytes, every component's licence text present`);
}
