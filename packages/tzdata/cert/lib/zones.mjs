// Shared by the tzdata cert specs: make the package's zoneinfo the system's,
// the way slicc-bios does (a /usr/share/zoneinfo link and /etc/localtime),
// and the instants every language prints.
export const PKG = '/node_modules/@ai-ecoverse/tzdata';
export const ZONEINFO = `${PKG}/share/zoneinfo`;

// UTC seconds → what each zone's local clock reads (HH:MM %Z %z). 1970 is
// before Berlin's first transition, 1985 inside the transition table, 2026
// at the slim file's footer rule, 2040 past 2038 (64-bit time_t).
export const INSTANTS = {
  jan2026: 1768478400, // 2026-01-15T12:00:00Z
  jul2026: 1784116800, // 2026-07-15T12:00:00Z
  jul2040: 2224756800, // 2040-07-01T12:00:00Z
  jul1970: 15681600, // 1970-07-01T12:00:00Z
  jul1985: 489067200, // 1985-07-01T12:00:00Z
};

export const BERLIN = {
  jan2026: '13:00 CET +0100',
  jul2026: '14:00 CEST +0200',
  jul2040: '14:00 CEST +0200',
  jul1970: '13:00 CET +0100',
  jul1985: '14:00 CEST +0200',
};
export const NEW_YORK = {
  jan2026: '07:00 EST -0500',
  jul2026: '08:00 EDT -0400',
  jul2040: '08:00 EDT -0400',
  jul1970: '08:00 EDT -0400',
  jul1985: '08:00 EDT -0400',
};
export const KOLKATA = {
  jan2026: '17:30 IST +0530',
  jul2026: '17:30 IST +0530',
  jul2040: '17:30 IST +0530',
  jul1970: '17:30 IST +0530',
  jul1985: '17:30 IST +0530',
};
export const TOKYO = {
  jan2026: '21:00 JST +0900',
  jul2026: '21:00 JST +0900',
  jul2040: '21:00 JST +0900',
  jul1970: '21:00 JST +0900',
  jul1985: '21:00 JST +0900',
};
export const UTC = Object.fromEntries(Object.keys(INSTANTS).map((k) => [k, `${String(new Date(INSTANTS[k] * 1000).getUTCHours()).padStart(2, '0')}:00 UTC +0000`]));

// The cases every language runs: [label, environment, expected]. env TZ=null
// means TZ unset (musl then reads /etc/localtime).
export const CASES = [
  ['TZ=Europe/Berlin', { TZ: 'Europe/Berlin' }, BERLIN],
  ['TZ=America/New_York', { TZ: 'America/New_York' }, NEW_YORK],
  ['TZ=US/Eastern (backward)', { TZ: 'US/Eastern' }, NEW_YORK],
  ['TZ=:<package path>/Asia/Tokyo', { TZ: `:${ZONEINFO}/Asia/Tokyo` }, TOKYO],
  // /etc/localtime names a zone that is no runner's or browser's own, so a
  // TZ the kernel still passes on can't pass this.
  ['TZ unset, /etc/localtime → Asia/Kolkata', { TZ: null }, KOLKATA],
  ['TZ=UTC', { TZ: 'UTC' }, UTC],
  // NEGATIVE: the same name with no file behind it is UTC, so the cases above
  // read the package's files.
  ['NEGATIVE: TZ=:/tmp/no-zoneinfo/Europe/Berlin', { TZ: ':/tmp/no-zoneinfo/Europe/Berlin' }, UTC],
];

/** Link /usr/share/zoneinfo to the package and /etc/localtime into it (Asia/Kolkata). */
export async function linkZoneinfo(ctx) {
  const { run, assert } = ctx;
  const r = await run(['bash', '-c', [
    'set -e',
    'mkdir -p /usr/share /etc',
    'rm -rf /usr/share/zoneinfo /etc/localtime',
    `ln -s ${ZONEINFO} /usr/share/zoneinfo`,
    'ln -s /usr/share/zoneinfo/Asia/Kolkata /etc/localtime',
    'head -c 4 /usr/share/zoneinfo/Europe/Berlin; echo',
    'head -c 4 /etc/localtime; echo',
  ].join('\n')], { cwd: '/tmp' });
  assert.equal(r.status, 0, `link zoneinfo: rc=${r.status} stderr=${r.stderr}`);
  assert.equal(r.stdout, 'TZif\nTZif\n', 'the links reach TZif files');
}

/**
 * Run `argv` (which prints one "label HH:MM %Z %z" line per instant, reading
 * the instants from argv) under each case and compare with what we expect.
 */
export async function checkCases(ctx, lang, argv) {
  const { run, assert } = ctx;
  const keys = Object.keys(INSTANTS);
  const args = keys.map((k) => `${k}=${INSTANTS[k]}`);
  const seen = [];
  for (const [label, env, want] of CASES) {
    // env -u TZ: the kernel (>= 1.174.2) puts the browser's TZ in every environment.
    const pre = env.TZ === null ? ['env', '-u', 'TZ'] : ['env', `TZ=${env.TZ}`];
    const r = await run([...pre, ...argv, ...args], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${lang} ${label}: rc=${r.status} stderr=${r.stderr}`);
    const got = Object.fromEntries(r.stdout.trim().split('\n').map((l) => {
      const i = l.indexOf(' ');
      return [l.slice(0, i), l.slice(i + 1)];
    }));
    assert.deepEqual(got, want, `${lang} ${label}`);
    seen.push(label);
  }
  console.log(`${lang}: ${seen.join('; ')}: CET/CEST, EST/EDT, JST, IST and UTC as expected at ${keys.join(', ')}`);
}
