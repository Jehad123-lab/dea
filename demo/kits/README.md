# Demo kits

Each folder here is a kit from `dea extract <url> --own-assets`, committed as generated (the whole output folder:
`index.html`, `package.json`, `src/`, `public/`, `rebuild/`, `preview/`, ...). The folder name is the demo's slug in
`demo/demos.json` and its path on the live site (`/igloo/`, `/keyframes/`).

Only `--own-assets` kits belong here: they carry no images or models of the site's. A kit without `--own-assets` ships the
site's own bytes and must not be published.

`node demo/build.mjs` (Vercel runs it) installs each kit's dependencies, builds it with Vite under its own path and writes
the landing page; the output is `demo/dist`.
