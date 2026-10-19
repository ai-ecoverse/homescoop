# Python 3.15 for slicc (homescoop#761)

`@ai-ecoverse/wasix-python` moves from CPython 3.14 to **CPython 3.15**, and the scientific py-* packages move with it. The npm `latest` tag now points at the cp315 builds:

| package | was (cp314) | now (cp315) |
|---|---|---|
| `@ai-ecoverse/wasix-python` | 3.14.2-29 | 3.15.0-2 |
| `@ai-ecoverse/py-numpy` | 2.3.2-12 | 2.5.4-1 |
| `@ai-ecoverse/py-pandas` | 2.3.2-12 | **3.0.6-1** (major) |
| `@ai-ecoverse/py-scipy` | 1.18.1-1 | 1.18.1-2 |
| `@ai-ecoverse/py-matplotlib` | 3.11.2-10 | 3.11.2-11 |
| `@ai-ecoverse/py-pillow` | 12.3.0-10 | **13.0.0-1** (major) |
| `@ai-ecoverse/py-contourpy` | 1.4.0-9 | 1.4.0-10 |
| `@ai-ecoverse/py-kiwisolver` | 1.5.1-9 | 1.5.1-10 |
| `@ai-ecoverse/py-cycler`, `py-fonttools`, `py-packaging`, `py-pyparsing` | -8 | -9 |

py-six, py-tzdata, py-pytz and py-python-dateutil serve both lines and don't change.

## Mixing the two lines

- **A Python release runs only extensions built for it.** A cp314 extension (`*.cpython-314-wasm32-wasix.so`) doesn't load on 3.15: discovery skips the package, and `python -v` says why. Install the cp315 builds, which are now `latest`, together with wasix-python 3.15. npm installs one python for the whole set.
- **The 3.14 builds stay on npm.** Install them by exact version if you need to stay on 3.14 for now, for example `@ai-ecoverse/wasix-python@3.14.2-29 @ai-ecoverse/py-pandas@2.3.2-12`. Each py-* package takes its wasix-python as a range within one line, so a 3.14 package never pulls in 3.15, and the reverse holds too.

## What changes for your code

Most code runs unchanged. The two major upgrades, pandas 3 and Pillow 13, change behaviour.

### pandas 3.0 (was 2.3)

- **Copy-on-write is always on.** A derived frame or series acts as a copy. Chained assignment such as `df["a"][0] = 1` or `df[df.b > 0]["a"] = 1` no longer writes through to `df`; use `df.loc[0, "a"] = 1`. `SettingWithCopyWarning` is gone.
- **Text columns default to the `str` dtype, not `object`.** `pd.Series(["a", "b"]).dtype` is now `str` (here it's Python-backed; PyArrow isn't available). Code that compares a dtype with `object`, or puts non-strings into a text column, needs a look.
- **pytz is no longer a dependency.** Use the standard library's `zoneinfo`, with `tz="Europe/Berlin"` strings or `zoneinfo.ZoneInfo(...)`. If you still need pytz, install `@ai-ecoverse/py-pytz` yourself.
- **Datetimes default to microseconds.** Parsed strings (including `read_csv`) become `datetime64[us]` instead of `[ns]`; datetime objects and numpy datetimes keep their unit. `astype("int64")` on such a column gives values 1000× smaller, so use `.dt.as_unit("ns")` first.
- **Removed APIs** (the deprecations pandas 2.x warned about):
  - `DataFrame.applymap` → `DataFrame.map`;
  - `Styler.applymap` / `applymap_index` → `Styler.map` / `map_index`;
  - `DataFrame.swapaxes` and `Series.swapaxes` → `transpose` / `T`;
  - `Series.ravel` → `to_numpy().ravel()`;
  - `Series.view` → `astype`;
  - the `method=` keyword of `fillna` → `ffill()` / `bfill()`;
  - `DataFrameGroupBy.fillna`, `SeriesGroupBy.fillna` and `Resampler.fillna` → `ffill` / `bfill`;
  - the `axis=` keyword of `groupby`, `rolling`, `resample` and every groupby operation;
  - in `read_csv`: `delim_whitespace=True` → `sep=r"\s+"`, `date_parser` → `date_format`, and `infer_datetime_format` and `keep_date_col` are gone;
  - `errors="ignore"` in `to_datetime`, `to_timedelta` and `to_numeric`;
  - the option `mode.use_inf_as_na`;
  - `Index.is_boolean`, `is_integer`, `is_floating`, `is_numeric`, `is_categorical`, `is_object` and `is_interval` → `pandas.api.types`;
  - `pandas.api.types.is_interval` and `is_period` → `isinstance`;
  - `DateOffset.is_anchored`;
  - `DataFrameGroupBy.grouper`.
- **Changed defaults and behaviour:**
  - `groupby(observed=)` defaults to `True`;
  - `Series[int]` is always label-based (use `.iloc` for positions);
  - the frequency aliases `M`, `Q`, `Y`, `A`, `H`, `T`, `L`, `U`, `N` are now `ME`, `QE`, `YE`, `h`, `min`, `ms`, `us`, `ns`;
  - `interpolate(method="pad"/"ffill"/"bfill")` is gone;
  - the silent downcasting in `fillna`/`where`/`replace` is gone.

  pandas' [3.0.0 release notes](https://pandas.pydata.org/docs/whatsnew/v3.0.0.html) have the full list (about 180 removals).

### Pillow 13.0 (was 12.3)

- **Includes security fixes:** two critical and thirteen high, among them a JPEG decoder buffer overflow and stale image storage after a mode change. There are also many TIFF, PDF, GIF and decompression-bomb fixes. This alone is worth the upgrade.
- **Removed APIs:**
  - `Image.Image.get_child_images()` moved to `ImageFile.ImageFile.get_child_images()` (on opened files);
  - `Image._show` → `ImageShow.show`;
  - `ImageCms.ImageCmsProfile.product_name` and `.product_info` are gone (they were `None` since 2.3);
  - `ExifTags.IFD.Makernote` → `ExifTags.IFD.MakerNote`;
  - `Image.fromarray(mode=...)` no longer converts data types; leave `mode` out and let it be inferred from the array.
- **Changed behaviour:**
  - saving an I-mode (32-bit) image as PNG no longer clips quietly to 16 bits; convert it first (`im.convert("I;16")`);
  - `ImageColor.getcolor()` returns premultiplied values for `RGBa` and `La`.
- **Deprecated, to be removed in Pillow 15:** the IM format, `JpegImageFile.load_djpeg` and `ImageQt.align8to32`.

  Pillow's [13.0.0 release notes](https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html) have the details.

### numpy 2.5 (was 2.3), scipy, matplotlib

These are minor releases, with no change you need to act on. numpy 2.4 and 2.5 expire some long-deprecated aliases and keywords; see numpy's [2.4](https://numpy.org/doc/stable/release/2.4.0-notes.html) and [2.5](https://numpy.org/doc/stable/release/2.5.0-notes.html) notes. scipy and matplotlib keep their upstream versions. `scipy.odr`, deprecated upstream, isn't in either line's scipy build.
