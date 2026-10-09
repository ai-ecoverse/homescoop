// hf's host import (hf_host.chmod) for slicc-kernel: WASI preview1 and WASIX
// have no chmod, so hf sets the token file's mode through the kernel's
// filesystem. Loaded for the hf command (slicc.commands.hf.imports) in every
// worker of the process. Without it the kernel answers ENOSYS (52), and hf
// says it could not restrict the file.

const errno = { EACCES: 2, EINVAL: 28, EIO: 29, ENOENT: 44, ENOTDIR: 54, EPERM: 63, EROFS: 69 }
const decoder = new TextDecoder()

export function createImports (ctx) {
  return {
    hf_host: {
      chmod (pointer, length, mode) {
        try {
          const bytes = Uint8Array.from(new Uint8Array(ctx.memory().buffer, pointer >>> 0, length >>> 0))
          const path = decoder.decode(bytes)
          if (!path.startsWith('/') || path.includes('\0')) return errno.EINVAL
          ctx.fs.chmod(path, (mode >>> 0) & 0o7777)
          return 0
        } catch (error) {
          return errno[error?.code] ?? errno.EIO
        }
      },
    },
  }
}
