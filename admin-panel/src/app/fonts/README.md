# Application fonts

These files come from the official [Google Fonts repository](https://github.com/google/fonts) at commit `1d0e46c7933245c8180fe83e47917961c913bbdb`. Exact source URLs and source/output SHA-256 checksums are in `sources.json`. Each family is distributed under its accompanying SIL Open Font License 1.1 file.

- Geist and Geist Mono retain the variable weight range 100–900.
- DM Sans retains variable weights (the application declares 300–800). Its optical-size axis is instantiated at the upstream default of 9, matching the previous Google CSS font's `DM Sans 9pt` family and weight-only variation axis.
- DM Mono includes regular 400 and medium 500.
- All upstream glyphs are retained, including Latin Extended characters used in Polish. No Unicode subsetting is performed.

Conversion: FontTools 4.67.0 with Brotli 1.2.0. Read each upstream TTF using `TTFont(path, recalcTimestamp=False)`; for DM Sans call `instantiateVariableFont(font, {'opsz': 9}, inplace=True)`; set `font.flavor = 'woff2'` and save. No build-time download or conversion is required. `tests/unit/local-fonts.test.ts` verifies the committed binaries' family, weights and Latin/Polish glyph coverage.
