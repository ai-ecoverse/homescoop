# @ai-ecoverse/wasi-html-to-markdown

[html-to-markdown](https://github.com/JohannesKaufmann/html-to-markdown)
v2's CLI as a WASI preview1 command for SLICC, under two names:
`html-to-markdown` (the name just-bash's command had) and `html2markdown`
(upstream's). Both run the same `bin/html2markdown.wasm`.

```sh
curl -sL https://nodejs.org/api/tty.html | html-to-markdown
curl -sL https://example.com/pricing | html-to-markdown --plugin-table
html-to-markdown --input page.html
html-to-markdown --input "src/*.html" --output "docs/"
html-to-markdown --exclude-selector "nav,footer" --domain https://example.com/ < page.html
```

HTML on stdin becomes Markdown on stdout. `--plugin-table` keeps tables as
Markdown tables; without it a table's cells run together as text.
`html2markdown --help` lists every flag.

## From just-bash's html-to-markdown

just-bash's command was turndown (JavaScript). This one is a different
converter, so the Markdown differs in details: emphasis is `*text*`, a
horizontal rule is `* * *`, and an empty input gives one newline.

| just-bash | here |
| --- | --- |
| HTML on stdin, Markdown on stdout | the same |
| `html-to-markdown FILE` | `--input FILE` (a glob also works); a file argument without `--input` exits 1 with `unknown arguments` |
| `-` for stdin | stdin is read when nothing else is given; there is no `-` |
| `-b`, `--bullet=CHAR` | no CLI flag; bullets are always `-` (just-bash's default) |
| `-c`, `--code=FENCE` | no CLI flag; fences are always ```` ``` ```` (just-bash's default) |
| `-r`, `--hr=STRING` | no CLI flag; rules are always `* * *` |
| `--heading-style=atx\|setext` | no CLI flag; headings are always ATX (`#`, just-bash's default) |
| `<footer>` removed | `--exclude-selector footer` |
| `<script>`, `<style>` removed | removed too (also `<head>`, `<iframe>`, `<noscript>`, form fields) |

Upstream has library options for the bullet, fence, rule and heading style
but no CLI flags for them, so these flags exit 1 (`unknown flag: -b`).

## Build

`html2markdown.wasm` is html-to-markdown `2.5.2` (tag `v2.5.2`, commit
`290df46`), `./cli/html2markdown` built by homescoop with Go 1.27.3,
`GOOS=wasip1 GOARCH=wasm`, from vendored modules (go.sum checked), with the
version, commit and date upstream's release build sets. It needs no
slicc-kernel imports beyond WASI preview1. The build is reproducible.

One patch, `0001-termenv-wasip1.patch`: the colour library behind the
CLI's `error:` prefix has no wasip1 code; the patch adds it, and it reports
no colour support when the output isn't a terminal. Go on wasip1 can't tell
a terminal apart, so errors are plain text everywhere, which is what
native `html2markdown` writes into a pipe.

The build also compiles the same source natively and checks its output on
the cert's fixtures against the committed goldens, so the cert's
byte-for-byte comparisons are with native `html2markdown`. To refresh them
after a version bump, run `node test/native-goldens.mjs <native
html2markdown> --write` and review the diff.

Certified under slicc-kernel users `enforce`: `curl … | html-to-markdown`
on a real page (the Node.js `tty` docs), the same on stdin, `--input` and
`--output`, globs, invalid HTML, a 3 MB page, empty input and the errors,
each compared byte for byte with native `html2markdown`; file permissions
between users; the licence and notices.

MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
