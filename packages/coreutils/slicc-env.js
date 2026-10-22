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
