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

## Patches (5.3.0-17)

5.3.0-17 is the certified 5.3.0-15 build under a new number: npm never served
5.3.0-15 or 5.3.0-16 (their publishes were swallowed, npm/cli#9889, and both
numbers are burned).

GNU bash 5.3 with these homescoop patches (GPL-3.0-or-later, like bash; the
list with the files each one changes is in `THIRD-PARTY-NOTICES.md`):

- `environ.patch`: the shell's environment comes from `environ` (Emscripten
  calls `main(argc, argv)` without `envp`).
- `eval-tty-signals.patch`: a ^C or ^Z typed right after Enter reaches the new
  job (the recorder between command reads).
- `jobs-notify-unqueue.patch`: a SIGCHLD that arrives while job status is
  printed is reaped, so a killed stopped job reports "Killed".
- `jobs-parent-terminal.patch`: the shell gives the terminal to a new
  foreground job itself, since the forked child takes it late.
- `pipestatus-restore-null.patch`: `PIPESTATUS` is filled again after a
  `PROMPT_COMMAND` ran before the first pipeline (an upstream 5.3 bug).
- `readline-sigint-discard.patch`: a ^C while bash takes an accepted line
  drops that line (never "leep" for "sleep"); a ^C noticed late leaves the
  next line whole, minus what was typed before it.

