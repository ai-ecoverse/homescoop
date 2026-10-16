export function treeCrates(tree) {
  const out = new Set();
  tree.split('\n').filter(Boolean).forEach((line, i) => {
    if (i === 0 || line.includes('(/')) return;
    const m = line.match(/^(\S+) v(\S+)/);
    if (m) out.add(`${m[1]} ${m[2]}`);
  });
  return out;
}
