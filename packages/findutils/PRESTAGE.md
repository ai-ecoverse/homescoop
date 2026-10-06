# wasm-findutils 4.10.0-1 pre-stage

Stage only — do not publish until SLICC accepts.

## Artifact
- `@ai-ecoverse/wasm-findutils@4.10.0-1`
- `find` + `xargs` only (no locate/updatedb)
- Link: slicc **fork** profile (ASYNCIFY) + `slicc_spawn` (find/xargs use `fork`+`execvp`)
- `-lnodefs.js` for host smoke; SLICC MEMFS does not need it
- Packed ~959 KB; unpacked ~2.8 MB

## Local smoke (NODEFS / `run-wasm-cli.mjs`)
- `-name` / `-type` / `-newer` / `-size` / `-mtime` / `-maxdepth` / `-prune` / `-delete`: OK
- `-exec … \;` (spawn via fork→`slicc_spawn` + `kernel.wait`): OK (self-`find` as command)
- `-exec {} +`, `-execdir`, `xargs -P` / pipe-stdio: host smoke kernel is incomplete for
  xargs’s close-on-exec status pipe; accept these in SLICC with `wasm-coreutils` `echo`.

## Acceptance (in SLICC)
With `@ai-ecoverse/wasm-coreutils` (or any `echo`) installed:
- `-name` / `-type` / `-newer` / `-size` / `-mtime` / `-maxdepth` / `-prune` / `-delete`
- `-exec {} +`, `-execdir`, `-print0 | xargs -0`, `xargs -P4 -n1`

## Install for acceptance
```bash
ipk add -g /path/to/ai-ecoverse-wasm-findutils-4.10.0-1.tgz
# or from the homescoop package tree after npm pack
```
