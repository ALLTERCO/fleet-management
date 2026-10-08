# Vendored PDF font subsets

These files make server-generated reports portable across production hosts.
They are the unmodified regular-weight WOFF assets published by Fontsource
5.3.0. Each upstream font is licensed under the SIL Open Font License 1.1;
the matching license text is stored beside the asset.

| Asset | Fontsource package | Upstream file | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| `noto-sans-arabic-arabic-400-normal.woff` | `@fontsource/noto-sans-arabic@5.3.0` | `files/noto-sans-arabic-arabic-400-normal.woff` | 79084 | `6d47c7e4dfc76e221d078945ef2bbf47b047f1b316cf87c7663086639814c763` |
| `noto-sans-hebrew-hebrew-400-normal.woff` | `@fontsource/noto-sans-hebrew@5.3.0` | `files/noto-sans-hebrew-hebrew-400-normal.woff` | 8952 | `50e545f6b9e4300a49ecf975baf4b1316e41ff287f1ceaf90861f9e0206185cf` |
| `noto-sans-bengali-bengali-400-normal.woff` | `@fontsource/noto-sans-bengali@5.3.0` | `files/noto-sans-bengali-bengali-400-normal.woff` | 54272 | `c480dd5f1c21af4e5d5e9ecbffc4d164f4375b5fd76ac7949bce08098de18dd6` |
| `noto-sans-thai-thai-400-normal.woff` | `@fontsource/noto-sans-thai@5.3.0` | `files/noto-sans-thai-thai-400-normal.woff` | 11316 | `e601a5a91e1b567fb0648ff598923aea68502b048d9e8ee995033f12a373eb09` |
| `noto-emoji-9-400-normal.woff` | `@fontsource/noto-emoji@5.3.0` | `files/noto-emoji-9-400-normal.woff` | 86644 | `a14b0d9b743f4641a9025a2aa34128ad5223e672494feaa5a120cefc859f62d5` |

Canonical package sources:

- `https://registry.npmjs.org/@fontsource/noto-sans-arabic/-/noto-sans-arabic-5.3.0.tgz`
- `https://registry.npmjs.org/@fontsource/noto-sans-hebrew/-/noto-sans-hebrew-5.3.0.tgz`
- `https://registry.npmjs.org/@fontsource/noto-sans-bengali/-/noto-sans-bengali-5.3.0.tgz`
- `https://registry.npmjs.org/@fontsource/noto-sans-thai/-/noto-sans-thai-5.3.0.tgz`
- `https://registry.npmjs.org/@fontsource/noto-emoji/-/noto-emoji-5.3.0.tgz`

The PDF renderer uses the Noto assets for shaped visible outlines and an exact
logical text layer for search and accessibility. Existing packaged Noto Sans
and Unifont assets remain the Latin, Cyrillic, Greek, Devanagari, CJK, and
last-resort paths. Unsupported supplementary scalars are disclosed as
`[U+XXXXX]` rather than silently replaced by a missing-glyph box.
