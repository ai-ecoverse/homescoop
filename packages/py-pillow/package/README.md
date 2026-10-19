# `@ai-ecoverse/py-pillow`

Pillow 13.0.0 for slicc WASIX CPython 3.15 (`cp315-wasix_wasm32`): JPEG, PNG (zlib) and FreeType text. Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

- **Side modules:**
  - `_imaging`, with libjpeg-turbo 3.1.2 linked in statically; zlib comes from `python.wasm`;
  - `_imagingft`, with FreeType linked in statically;
  - `_imagingmath` and `_imagingmorph`.
  There's no `_imagingtk` (no Tk on WASIX), `_imagingcms`, `_webp` or `_avif`.
- **Build:** in homescoop's CI from the PyPI sdist against wasix-python 3.15.0-1 (wasix-sysroot 2025.9.30-38).
- **Python range:** `>=3.15.0-1 <3.15.1`.
- **Pillow 13 removals** (see also "What changes for your code" below):
  - Python 3.10 support;
  - saving I-mode images as PNG with clipping;
  - `Image.fromarray(mode=…)` when it changes data types;
  - `Image.Image.get_child_images()`, moved to `ImageFile`;
  - `Image._show`;
  - `ImageCmsProfile.product_name`/`product_info`;
  - `ExifTags.IFD.Makernote`.
  `ImageColor.getcolor()` returns premultiplied values for `RGBa`/`La`. See Pillow's 13.0.0 release notes.

## What changes for your code (Pillow 13 after 12.3)

- **Includes security fixes:** two critical, thirteen high, among them a JPEG decoder overflow and stale image storage after a mode change.
- **Removed:**
  - `Image.Image.get_child_images()`, now on `ImageFile.ImageFile`;
  - `Image._show` (use `ImageShow.show`);
  - `ImageCms.ImageCmsProfile.product_name` and `.product_info`;
  - `ExifTags.IFD.Makernote` (use `MakerNote`);
  - `Image.fromarray(mode=...)` no longer converts data types.
- **Changed:**
  - I-mode images saved as PNG no longer clip quietly; convert first;
  - `ImageColor.getcolor()` returns premultiplied values for `RGBa`/`La`.

Details: homescoop's [release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md).
