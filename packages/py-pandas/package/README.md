# `@ai-ecoverse/py-pandas`

Pandas **3.0.6** built as WASIX side modules for `@ai-ecoverse/wasix-python` CPython 3.15 (`cpython-315-wasm32-wasix`). Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Build:** in homescoop's CI from the PyPI sdist, `pandas-3.0.6.tar.gz`, with meson and Cython, against wasix-python 3.15.0-1 and py-numpy 2.5.4-1 (wasix-sysroot 2025.9.30-38; C++ headers from the sysroot). No patches.
- **Ranges:** wasix-python and py-numpy are taken as ranges from those revisions on.
- **pandas 3 changes behaviour from 2.3:**
  - copy-on-write is always on;
  - the default string dtype is `str`, a PyArrow-less Python-backed string array here;
  - pytz isn't a dependency any more;
  - several deprecated APIs are removed.
  See pandas' 3.0 release notes.

## What changes for your code (pandas 3 after 2.3)

- **Copy-on-write is always on.** Chained assignment (`df["a"][0] = 1`) no longer writes through to `df`; use `df.loc[0, "a"] = 1`.
- **Text columns default to the `str` dtype**, not `object`.
- **pytz is no longer a dependency**: use `zoneinfo` (or install `@ai-ecoverse/py-pytz` yourself).
- **Datetimes default to microseconds**: parsed strings become `datetime64[us]`, not `[ns]`.
- **Removed:**
  - `DataFrame.applymap` (use `map`);
  - `swapaxes`;
  - `Series.view` and `ravel`;
  - `fillna(method=)` (use `ffill`/`bfill`);
  - the `axis=` keywords of `groupby`/`rolling`/`resample`;
  - `read_csv`'s `delim_whitespace`, `date_parser`, `infer_datetime_format` and `keep_date_col`;
  - `errors="ignore"` in `to_datetime`/`to_numeric`;
  - `mode.use_inf_as_na`;
  - the `Index.is_*` attributes.

  `groupby(observed=)` defaults to `True`, and `Series[int]` is always by label.

Details: homescoop's [release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md).
