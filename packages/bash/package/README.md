# `@ai-ecoverse/wasm-bash`

GNU bash 5.3 with readline (history, line editing, tab completion) for
slicc's panel terminal. Fork/job control via Asyncify + slicc shims.

```bash
pnpm add -g @ai-ecoverse/wasm-bash
bash -i
```

## Users (5.3.0-13, slicc-kernel ≥ 1.44.0)

bash runs as the user the kernel says. `$UID`, `$EUID`, `$GROUPS`, `~` and the
`\u`/`\$` prompt escapes come from slicc-kernel's process credentials and its
`/etc/passwd`. Root (the kernel's default) gets uid 0, `/root` and a `#` prompt.
A user added with `kernel.users.add({ name })` gets its own uid, home and `$`.

There is no fallback: on an older kernel the ids are -1 and the prompt says
"I have no name!". File owners are the kernel's; 1.44.0 reports uid 1000 for
every file.
