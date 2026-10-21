# `@ai-ecoverse/wasm-zip`

[Info-ZIP](http://infozip.sourceforge.net/) `zip` 3.0 and `unzip` 6.0 for
slicc's wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-zip
zip out.zip file.txt
unzip -l out.zip
```

- `zip -T` runs `unzip` itself, without a shell. A `-TT` command is a shell
  command, so it needs one (`@ai-ecoverse/wasm-bash`).
- Non-ASCII names are UTF-8. `zip` sets the UTF-8 flag on them, and `unzip`
  shows them and reads Info-ZIP's Unicode path field.
- The realm's file names are UTF-8. An entry whose name isn't (an old
  Latin-1 or CP437 archive without a Unicode path) is not extracted under a
  changed name: `unzip` says `cannot create <name>` / `Illegal byte sequence`
  and exits 50. `unzip -p` still streams its bytes. Such entries are refused
  rather than renamed because a substituted name can collide with another
  entry or an existing file and silently overwrite it.
- `unzip -%` (opt-in) extracts those entries under an escaped name instead.
  Each byte of the name outside a valid UTF-8 sequence becomes `%XX` (two
  upper-case hex digits), and a `%` in that name becomes `%25`; a name that is
  valid UTF-8 is left exactly as it is. So `caf\xe9.txt` is written as
  `caf%E9.txt` and `100%\xe9.txt` as `100%25%E9.txt`, and unzip prints
  `escaped: <path>` for each one. To get the stored name back, replace every
  `%XX` in a reported path with the byte XX, e.g. in Python
  `urllib.parse.unquote_to_bytes(name)`. An escaped name never replaces
  anything: if its path exists already (on disk, or from an earlier entry),
  the entry is refused by name, and a later entry whose path an escaped entry
  took is refused too. unzip then exits 2, also under `-o` and `-n`. Symlink
  targets are not escaped, so a link whose target isn't UTF-8 is still refused.
- A Unix entry with the PKWARE verification bit (internal attribute bit 2)
  carries a checksum where its mode would be, so it is extracted as a regular
  file with 0666 (0444 if marked read-only) less your umask, not with the
  mode 000 that Debian's handling of the bit leaves.
- `zip - … > file` and `zip - … | …` write valid archives, and `zip -s 0`
  merges split archives (`zip -s 1m`) back with every byte.
- `zipinfo` is unzip's zipinfo mode, the same as `unzip -Z`.
- unzip carries Debian's unzip 6.0 security patches.
