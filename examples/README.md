# Examples

Real reports from DEA, saved as they came out (only machine-specific paths were shortened). Each one is a single command.

| Folder | Command | What it shows |
|---|---|---|
| [`jehaduddin-explain/`](jehaduddin-explain/explain.md) | `dea explain https://jehaduddin.vercel.app` | A code teardown of a React + three.js portfolio with no source maps: build, stack, how the app is put together, 67 shader stages, GSAP calls, data. |
| [`jehaduddin-extract/`](jehaduddin-extract/extract.md) | `dea extract https://jehaduddin.vercel.app --to react --verify-build` | A buildable React kit: tokens, motion, the hero's text layout, the site's own render graph rebuilt as an editable three.js project (28 materials, 29 render targets), a build check, and the visual diff below. |
| [`gsap-investigate/`](gsap-investigate/report.md) | `dea investigate https://gsap.com --goal "what fonts, colours and animation tech does the homepage use, with proof"` | A planned investigation with an evidence index: GSAP 3.15.0 + ScrollTrigger, PP Mori, the colour scheme with contrast, 273 animated elements, 44 ScrollTriggers. |
| [`hn-algolia-api/`](hn-algolia-api/api.md) | `dea api https://hn.algolia.com` | The APIs a page calls, as OpenAPI 3.1 ([`openapi.json`](hn-algolia-api/openapi.json)), with the source line that calls each one (from the site's source maps) and the API key redacted. |

## The extract's visual diff

Left: the original first screen after its intro. Right: the kit's editable three.js rebuild, made from the two WebGL
frames DEA recorded right before that screenshot (the site's own shaders, render targets, camera and meshes, as three.js
objects; see [`rebuild.md`](jehaduddin-extract/rebuild.md) and [`render-graph.md`](jehaduddin-extract/render-graph.md)).

![Original and rebuild side by side](jehaduddin-extract/side-by-side.jpg)

| | Page score | Canvas-only score |
|---|---|---|
| DEA's start (one shader on a plane) | 50.7% | 1.6% |
| Earlier version: hand-written particle stand-in | 88.1% | 50.9% |
| Editable rebuild from the recording (this kit) | 95.0% | 93.1% |

The page score compares colour, brightness layout and edges at 96×60. The canvas-only score looks at the WebGL canvas
alone with the text hidden (SSIM at three scales, edges, tones), so text and layout cannot carry it. What is still off:
the bottom of the original is darker than the rebuild (the top half matches pixel for pixel); something outside the
recorded WebGL context darkens it, and the report's "Gap → path to result" names the next probe. Screenshots were
taken on a machine without a GPU, so the site's WebGL ran in software.
