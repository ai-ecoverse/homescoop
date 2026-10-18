addToLibrary({
  $SYSCALLS__postset: `{
    const lenient = SYSCALLS.getStr;
    const strict = new TextDecoder('utf-8', { fatal: true });
    SYSCALLS.getStr = (ptr) => {
      let end = ptr;
      while (HEAPU8[end]) end++;
      try {
        strict.decode(HEAPU8.subarray(ptr, end));
      } catch {
        throw new FS.ErrnoError({{{ cDefs.EILSEQ }}});
      }
      return lenient(ptr);
    };
  }`,
});
