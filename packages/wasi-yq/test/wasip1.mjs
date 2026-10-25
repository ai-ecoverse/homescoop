export const errnoText = [
  ['no such file or directory', 'No such file or directory'],
  ['permission denied', 'Permission denied'],
];

export const wasip1 = (text) => errnoText.reduce((t, [native, wasi]) => t.split(`: ${native}`).join(`: ${wasi}`), text);
