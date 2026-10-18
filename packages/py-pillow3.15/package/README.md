# `@ai-ecoverse/py-pillow` (cp315)

Pillow 13.0.0 for slicc WASIX CPython 3.15 (`cp315-wasix_wasm32`): JPEG, PNG (zlib) and FreeType text. During the Python 3.15 wave (homescoop#761) it's published under the npm dist-tag `python3.15`, and `latest` stays on the cp314 line (12.3.0-N) until the flip.

- **Side modules:**
  - `_imaging`, with libjpeg-turbo 3.1.2 linked in statically; zlib comes from `python.wasm`;
  - `_imagingft`, with FreeType linked in statically;
  - `_imagingmath` and `_imagingmorph`.
  There's no `_imagingtk` (no Tk on WASIX), `_imagingcms`, `_webp` or `_avif`.
- **Build:** in homescoop's CI from the PyPI sdist against wasix-python 3.15.0-1 (wasix-sysroot 2025.9.30-38).
- **Python range:** `>=3.15.0-1 <3.15.1`.
- **Pillow 13 removals:**
  - Python 3.10 support;
  - saving I-mode images as PNG with clipping;
  - `Image.fromarray(mode=…)` when it changes data types;
  - `Image.Image.get_child_images()`, moved to `ImageFile`;
  - `Image._show`;
  - `ImageCmsProfile.product_name`/`product_info`;
  - `ExifTags.IFD.Makernote`.
  `ImageColor.getcolor()` returns premultiplied values for `RGBa`/`La`. See Pillow's 13.0.0 release notes.
