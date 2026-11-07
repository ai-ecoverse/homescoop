# `@ai-ecoverse/tzdata`

The IANA time zone database 2026f as compiled zone files, so TZ=Europe/Berlin works in python, perl and ruby.

The [IANA tz database](https://www.iana.org/time-zones), compiled with the
release's own `zic`, as a data-only package: no commands, no install
scripts, no dependencies. It's what lets `TZ=Europe/Berlin` (the zone
slicc-kernel puts in every environment) work in programs that ask libc for
local time: wasix-python's `time.localtime()`, `datetime.now().astimezone()`
and `strftime('%Z')`, Perl's `localtime` and POSIX `strftime`, Ruby's
`Time.now`. coreutils' `date` reads `TZ` on its own.

## The path

The zone files are at **`share/zoneinfo/`** in the package:

```text
<package root>/share/zoneinfo/Europe/Berlin
<package root>/share/zoneinfo/America/New_York
<package root>/share/zoneinfo/UTC            (also Etc/UTC)
<package root>/share/zoneinfo/US/Eastern     (backward's old names)
<package root>/share/zoneinfo/tzdata.zi      (the whole database as zic input, "# version 2026f" first)
<package root>/share/zoneinfo/zone1970.tab   (also zone.tab, zonenow.tab, iso3166.tab, leapseconds)
```

`package.json` says the same in `slicc.zoneinfo` (`"share/zoneinfo"`, relative
to the package root), and `homescoop.upstream` is the IANA release.

The package root is wherever the installer puts `@ai-ecoverse/tzdata`:
`/node_modules/@ai-ecoverse/tzdata` for a global add or the base set, and
`/opt/slicc/tools/node_modules/@ai-ecoverse/tzdata` when slicc-bios installs
it as one of seven's tools (its pnpm project at `/opt/slicc/tools`, whose
files pnpm keeps in the store at `/opt/slicc/.store`). That path stays the
same across updates: pnpm links it to the installed version's directory
under `node_modules/.pnpm`, and an update moves the link, not the name.

## Making it the system's zoneinfo

musl (wasix-sysroot's `__tz.c`) looks a zone name up only under
`/usr/share/zoneinfo/`, `/share/zoneinfo/` and `/etc/zoneinfo/`, takes
`TZ=:/absolute/path`, and reads `/etc/localtime` when `TZ` is unset.
Installing the package alone does none of that. slicc-bios links
`/usr/share/zoneinfo` to the package's `share/zoneinfo` and points
`/etc/localtime` at the current zone's file. By hand:

```sh
ln -s /node_modules/@ai-ecoverse/tzdata/share/zoneinfo /usr/share/zoneinfo
TZ=Europe/Berlin python3 -c 'import time; print(time.strftime("%Z %z"))'
# or, with nothing linked:
TZ=:/node_modules/@ai-ecoverse/tzdata/share/zoneinfo/Europe/Berlin perl -e 'print scalar localtime, "\n"'
```

Python's `zoneinfo` finds the same tree through its system path
(`/usr/share/zoneinfo` is on `zoneinfo.TZPATH`), so it no longer needs
`@ai-ecoverse/py-tzdata` once the link is there.

## What's in it

- Main data plus `backward`, so old names (`US/Eastern`, `Asia/Calcutta`,
  `GB`) resolve. No `backzone`, and no `right/` or `posix/` trees: musl and
  Python read the plain files, and leap-second time is not POSIX time.
- Slim TZif (`zic -b slim`): 64-bit data and the POSIX `TZ` footer for the
  years after the last transition, about half the size of `-b fat`.
- Every name is a regular file. zic makes `backward`'s links hard links,
  which npm refuses, so each alias is a copy of its target's bytes.

The data is in the public domain (`LICENSE` is upstream's).
