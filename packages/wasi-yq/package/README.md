# @ai-ecoverse/wasi-yq

[yq](https://github.com/mikefarah/yq) v4 (mikefarah's, Go) as a WASI
preview1 command for SLICC: `yq` reads, queries and edits YAML, JSON, TOML,
XML, INI, CSV/TSV, properties, HCL and Lua, and converts between them.

```sh
yq '.jobs.*.steps[0]' .github/workflows/ci.yml
yq -i '.jobs.test.runs-on = "ubuntu-24.04"' .github/workflows/ci.yml
yq 'select(.kind == "Deployment") | .spec.template.spec.containers[].image' k8s.yaml
yq --front-matter=extract '.title' post.md
yq -o json config.yaml
yq -p toml '.package.version' Cargo.toml
yq -p xml -o json pom.xml
yq ea '. as $item ireduce ({}; . * $item)' base.yaml prod.yaml
TAG=1.5.0 yq -i '.image = "web:" + strenv(TAG)' values.yaml
```

`-i` edits in place and keeps comments (yq drops blank lines, as it does
natively). `yq --help` lists every flag; the
[docs](https://mikefarah.gitbook.io/yq/) have the expression language.

## From just-bash's yq

just-bash's `yq` was a JavaScript look-alike (yaml, smol-toml,
fast-xml-parser, ini) and only in its Node bundle, so SLICC never had it.
This is the real yq, so expressions, flags and output are upstream's.

## Differences from native yq

- Errors from the file system use Go wasip1's text, capitalised:
  `Error: open missing.yaml: No such file or directory` and
  `Permission denied`, where native yq writes them in lower case.
- Output is never coloured unless `-C` is given: Go on wasip1 can't tell a
  terminal apart, so yq behaves as native yq writing into a pipe.
- `-i` writes a temporary file in `$TMPDIR` (or `/tmp`) and moves it over
  the original. Native yq on Linux then gives it the original's owner; on
  wasip1 (as on macOS) there is no chown, so a file root edits in place
  becomes root's. Mode and content are kept. A failed `-i` (a bad
  expression, a file it can't write) leaves its temporary file behind, as
  native yq does.
- The `system` operator (off by default, `--security-enable-system-operator`)
  can't start processes on wasip1.

## Build

`yq.wasm` is yq `4.54.1` (tag `v4.54.1`, commit `504fc38`), built by
homescoop with Go 1.27.3, `GOOS=wasip1 GOARCH=wasm`, from vendored modules
(go.sum checked), with upstream's release flags (`-s -w`). No patches: every
module it links builds for wasip1 as it is. It needs no slicc-kernel imports
beyond WASI preview1, and the build is reproducible. The wasm is about
26 MB (6 MB in the npm tarball), since it has all of upstream's formats.

The build also compiles the same source natively and runs the cert's 41
cases (`test/goldens.mjs`) with it against the committed goldens
(`test/fixtures/expected.json`), so the cert's byte-for-byte comparisons are
with native yq. To refresh them after a version bump, run
`node test/native-goldens.mjs <native yq> --write` and review the diff.

Certified under slicc-kernel users `enforce`: a GitHub Actions workflow and
a k8s manifest read and edited in place with comments kept, front matter,
YAML, JSON, TOML and XML in and out, `eval-all`, `env()`/`strenv()`, the
errors, a 4 MB file, each compared byte for byte with native yq; `-i` on
another user's file is refused; the licence and notices.

MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`. `github.com/hashicorp/hcl/v2`
is MPL-2.0 and linked unmodified; its source is at
https://github.com/hashicorp/hcl at the version the notices name.
`go.yaml.in/yaml/v4`'s libyaml-derived files are MIT; that module ships only
its Apache-2.0 licence and a NOTICE pointing at MIT, so the notices add the
MIT text for those files from go-yaml v3's LICENSE (same files, same
copyright).
