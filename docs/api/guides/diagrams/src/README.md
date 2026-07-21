# Diagram sources (editable)

The `.svg` files in the parent folder are **generated** — do not hand-edit them.
Edit the generator script here, then re-run it to regenerate the SVG.

## How it works

- `kit.js` — the shared toolkit: palette, icon tiles + glyphs, boxes, boundary
  groups, connectors, and helpers for sequence / state-machine diagrams. Every
  diagram builds from this so they all share one look.
- `<name>.js` — one generator per diagram. It builds the SVG string from `kit.js`
  and writes `../<name>.svg`.
- `render.js` — renders an SVG to PNG (via `sharp`) so you can eyeball it.
- `crop.js` — renders at 3× and crops a region, to check for pixel-level overlaps.

## Regenerate a diagram

```sh
# from the repo root
SCRATCH=docs/api/guides/diagrams/src \
  node docs/api/guides/diagrams/src/connection.js
# writes docs/api/guides/diagrams/connection.svg
```

Each generator reads `SCRATCH` for the folder that holds `kit.js` and writes the
SVG one level up (into the diagrams folder). Run under plain `node` — not `tsx`.

## Preview / verify

```sh
NODE_PATH=backend/node_modules \
  node docs/api/guides/diagrams/src/render.js <in.svg> <out.png>
```

The docs build (`scripts/generate/api-guides.ts`) inlines each referenced
`.svg` as a base64 data-URI so Scalar renders it offline — nothing here runs at
build time.
