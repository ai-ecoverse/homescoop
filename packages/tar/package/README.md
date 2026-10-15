# `@ai-ecoverse/wasm-tar`

[GNU tar](https://www.gnu.org/software/tar/) 1.35 for slicc's wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-tar
tar -tf archive.tar
```

Since 1.35.0-5 tar uses slicc-kernel's process credentials, so root is root:
`tar -x` as root keeps the archive's owners and modes (setuid and setgid
included), as GNU tar does on Linux; any other user gets its own ids and its
umask. 1.35.0-4 and older saw Emscripten's fixed ids, and root's `tar -x`
behaved like a non-root extract unless given `--same-owner -p`.


Since 1.35.0-6 tar makes hard links through slicc-kernel (`linkat`). On
slicc-kernel 1.90.0 and later, a hard-link member extracts as a real link
where the filesystem supports it (a tmpfs mount); the browser's OPFS has no
hard links, so there, and on older kernels, tar reports `Cannot hard link
to …: Too many links` (EMLINK), exits 2 and extracts the other members.
