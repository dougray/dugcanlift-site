# Vendored: MapLibre GL JS

| | |
|---|---|
| Package | `maplibre-gl` |
| Version | **5.24.0** (published to npm 2026-04-23; the newest 5.x) |
| Source | `https://registry.npmjs.org/maplibre-gl/-/maplibre-gl-5.24.0.tgz` |
| Tarball sha256 | `5cbf83c328c9d39cb24e3f2cefc9b407d69dd104ba0b41e84c0bfbb31c44e283` |
| Tarball integrity (npm) | `sha512-ALyFxgtd5R+65UqZ/++lOqwWcC0SNho9c27fYSyLmG7AfnAul2o46F05aDJGPbFU57wos9dgcIySHs0Xe6ia3A==` |
| License | BSD-3-Clause, `LICENSE-maplibre.txt` (the package's `LICENSE.txt`) |

Each file is copied byte for byte from the tarball, never edited:

| File here | From the package | sha256 |
|---|---|---|
| `maplibre-gl.js` | `dist/maplibre-gl.js` | `45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb` |
| `maplibre-gl.css` | `dist/maplibre-gl.css` | `ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732` |
| `LICENSE-maplibre.txt` | `LICENSE.txt` | `ee5fc05a0677eaf69601d2c7db0d9ecd6cc27c3abc1d0733bc9ed34707cf8ef2` |

## Why 5.x, and how it loads

MapLibre GL JS 6 ships ES modules only, which would need a dynamic `import(`
in `map.js`; every app's no-network scan bans that word. 5.24.0 is the last
release with a classic-script build (`dist/maplibre-gl.js`, UMD), so it loads
the way `lift/jsqr.js` does: the page includes
`<script src="map/maplibre-gl.js">` before `map/map.js` and the app's own
scripts, and it sets `window.maplibregl`. `map.js` uses that global. A page
without it draws every route as the app's plain line.

The worker is built from code inside `maplibre-gl.js` itself: the bundle turns
its worker source into a Blob and starts the worker from that `blob:` URL. The
worker therefore requests no script, and `map.js` does not call
`setWorkerUrl`. A `blob:` worker belongs to the page's origin. Neither app sets
a Content-Security-Policy, so nothing blocks it. If one is ever added, it needs
`worker-src blob:` (or MapLibre's separate CSP build).

`map.js` adds `maplibre-gl.css` from the same folder itself, once.

Every file here is on the app's own origin. Nothing is loaded from a CDN.

`maplibre-gl.js` ends in a `//# sourceMappingURL=` comment. The map file is not
vendored: a browser asks for it only while its developer tools are open, and
gets a 404 from the app's own origin.

## Updating

1. `npm pack maplibre-gl@<version>` into an empty scratch directory (never run
   its scripts), and check the tarball's sha512 against `npm view
   maplibre-gl@<version> dist.integrity`. Only a release with a classic
   `dist/maplibre-gl.js` fits.
2. Copy the three files above over these, update this table, and run
   `node map/write-checksum.mjs`.
3. `node --test map/*.test.mjs map/web/*.test.mjs`, then copy `map/` into both
   apps with the new `map-files.sha256`.
