# py-matplotlib: negative proof

## 3.11.2-8: negative 3.11.2-7 (homescoop#197)

The published `@ai-ecoverse/py-matplotlib@3.11.2-7` installed from npm (`npm i @ai-ecoverse/py-matplotlib@3.11.2-7`) brings its exact pins, among them py-kiwisolver 1.5.1-6 and wasix-python 3.14.2-16. On slicc-kernel 1.100.4's Node entry, 2026-10-16, `constrained.mjs` (py-kiwisolver's `cert/matplotlib.mjs`) fails:

```
rc=134 stderr=python3: wasm trap: function signature mismatch
```

The same tree with py-kiwisolver 1.5.1-7 (the published tarball of #556), which is what 3.11.2-8 pins, passes: `ConstrainedLayoutEngine`, a PNG, and the left column at x0 0.137 against the default layout's 0.125.
