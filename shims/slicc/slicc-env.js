// The environment is only what the kernel passes (homescoop#612, #535): none
// of Emscripten's placeholders (USER and LOGNAME web_user, HOME /home/web_user,
// PATH and PWD /, LANG, _). When the kernel passes nothing, as after env -i,
// there is no HOME, USER, LOGNAME or PATH; a PATH search then uses libc's
// default directories, never /.
addToLibrary({
  $getEnvStrings__deps: ['$ENV'],
  $getEnvStrings: () => {
    if (!getEnvStrings.strings) {
      const strings = [];
      for (const x in ENV) if (ENV[x] !== undefined) strings.push(`${x}=${ENV[x]}`);
      getEnvStrings.strings = strings;
    }
    return getEnvStrings.strings;
  },
});
