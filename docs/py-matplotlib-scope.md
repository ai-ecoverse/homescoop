# Matplotlib (Agg / PNG) — scope + status

## Published
- `@ai-ecoverse/py-pandas@2.3.2-5` (`latest`)

## Staged for SLICC acceptance — **do not publish until OK**
| Package | Version |
|---|---|
| py-pyparsing | 3.3.3-1 |
| py-packaging | 26.3-1 |
| py-cycler | 0.12.1-1 |
| py-fonttools | 4.66.1-1 |
| py-kiwisolver | 1.5.1-1 |
| py-contourpy | 1.4.0-1 |
| py-pillow | 12.3.0-1 |
| **py-matplotlib** | **3.11.2-1** |

All under `slicc-emscripten/tmp-wasi/staging/`. Hard checks passed locally (wasix SOABI, Agg-path ctypes clean, FT-only unresolved, `.pyc`).

## Your check
```python
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
# line, hist, df.plot() → PNG; size + header; import time
```
