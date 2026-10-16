# `@ai-ecoverse/py-pillow`

Pillow 12.3.0 for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`): JPEG, PNG (zlib) and FreeType text.

- Side modules `_imaging` (libjpeg-turbo 3.1.2 linked in statically; zlib comes from `python.wasm`), `_imagingft` (FreeType 2.13.3 statically), `_imagingmath` and `_imagingmorph`. No `_imagingtk` (there is no Tk on WASIX), `_imagingcms`, `_webp` or `_avif`.
- Takes `@ai-ecoverse/wasix-python` `>=3.14.2-25 <3.14.3`: the python whose headers it is built against, and later revisions of that line.

## Since 12.3.0-9

Built from the sdist in homescoop's CI (`build.sh`, homescoop#211). Up to -8 the package reused bytes built outside the repo.
- `Image.__arrow_c_schema__()` and `Image.__arrow_c_array__()`, Pillow 12's Arrow export, work. Up to -8 they ended python with `wasm trap: function signature mismatch`: the two `METH_VARARGS` functions took one parameter, and CPython calls them with two (homescoop#588, `pillow-wasm-call-signatures.patch`).
- `_imagingtk` is gone. Importing it trapped the same way, and there is nothing for it to drive.
