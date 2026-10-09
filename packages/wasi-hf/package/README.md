# `@ai-ecoverse/wasi-hf`

`hf` for [slicc](https://github.com/ai-ecoverse/slicc): downloads models and
datasets from the Hugging Face Hub, and `hf auth`. It is a small WASI command
(about 260 KB, written in Rust on homescoop's `wasix-net`). **It is not
huggingface_hub's CLI.** It implements `download` and `auth`, with the same
flag names where they overlap. See
[homescoop#110](https://github.com/ai-ecoverse/homescoop/issues/110) for why:
the real CLI needs wasix-python (about 126 MB), and it cannot fetch LFS files
through a transport that follows redirects (slicc-extension, the page's fetch).

```bash
pnpm add -g @ai-ecoverse/wasi-hf
hf download onnx-community/whisper-tiny.en                      # → /home/models/onnx-community/whisper-tiny.en
hf download Xenova/all-MiniLM-L6-v2 config.json tokenizer.json --to ./minilm
hf download owner/model --include '*.onnx' --exclude '*fp16*' --revision v2
hf download datasets/owner/set                                  # → /home/datasets/owner/set
hf auth login --token hf_…    # or: echo hf_… | hf auth login
hf auth whoami
```

| | |
| --- | --- |
| `hf download <repo> [files…]` | the whole repo, or the files named (a name ending in `/` is a folder) |
| `--to DIR`, `--local-dir DIR` | destination; default `/home/models/<owner>/<name>` (datasets `/home/datasets/…`, spaces `/home/spaces/…`); relative paths are taken from the working directory |
| `--revision REV` | branch, tag, commit or `refs/pr/N` (default `main`); every file comes from the one commit it resolves to |
| `--include GLOB`, `--exclude GLOB` | repeatable; fnmatch as in huggingface_hub (`*` also matches `/`; `dir/` means everything below it) |
| `--repo-type model\|dataset\|space` | or a `datasets/` / `spaces/` prefix on the repo |
| `--force`, `--force-download` | download again even if present |
| `-j N`, `--concurrency N`, `--max-workers N` | files at once (default 4) |
| `--token TOKEN`, `-q` | a token for this run; print only the destination |
| `hf auth login [--token T] [--no-verify]` | checks the token with `/api/whoami-v2`, then saves it |
| `hf auth whoami`, `hf auth logout` | |

**Files** land as plain files under the destination, with no
huggingface_hub cache, `snapshots/` or symlinks, so anything that reads OPFS
directly sees them. A file that is already there with the size the Hub lists
is skipped.

**Downloads** pin the commit (`/api/<type>s/<repo>/revision/<rev>`) and list
the tree at that commit (`/tree/<sha>?recursive=true`, following `Link`
pages). Then they fetch `/<repo>/resolve/<sha>/<path>` through the kernel's
proxy. That works whether the transport hands over the 302 to the CDN or
follows it itself, because nothing is read from the redirect.

**Resume and integrity:**
- A file is written to `<file>.incomplete`, fsynced every 4 MiB, and renamed
  when it is complete.
- An interrupted file (a dropped connection, or a killed process) resumes
  with `Range: bytes=<n>-`.
- LFS files are checked against their sha256. A mismatch after a resume
  downloads the file again from the start; a second mismatch fails.

**Tokens:**
- The token comes from `HF_TOKEN` (or `HUGGING_FACE_HUB_TOKEN`), then
  `$HF_TOKEN_PATH`, then `$HF_HOME/token`, which defaults to
  `~/.cache/huggingface/token` (`/home/.cache/huggingface/token` in seven).
  That is the same order huggingface_hub uses.
- It is sent to the Hub endpoint only. A redirect to another host (the CDN,
  whose URLs are signed) drops it.
- `HF_ENDPOINT` points at a mirror.

**Where models go:** `/home/models/<owner>/<name>/` is this package's
default. slicc-ortllama ([slicc-ortllama#2](https://github.com/ai-ecoverse/slicc-ortllama/issues/2))
should pin the folder it loads models from. Until it does, `HF_MODELS_DIR`
moves the default, and `--to` sets any folder.

**Not here:** `upload`, `repos`, `cache`, `jobs`, `cp`, `hf://` and the
rest exit 2 with a message. For those, use huggingface_hub
(`pip install huggingface_hub` on wasix-python, behind a local proxy).
There is no Xet protocol either: Xet-stored files come through the Hub's
HTTP bridge.

The licences of the linked crates, Rust's standard library and wasi-libc are
in `THIRD-PARTY-NOTICES.md`.
