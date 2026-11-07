# Deploying the look upgrade (branch `towers-look`)

Nothing beyond a normal deploy is needed: no new environment variables, no build step, no CDN, and the CSP is unchanged
(`script-src 'self'`). This note is what is new on disk and what to check afterwards.

## What ships
- `public/vendor/three/addons.module.min.js`: the three.js r186 addons we use (EffectComposer, N8AO, bloom, OutputPass,
  FXAA, GLTFLoader, SkeletonUtils, RoomEnvironment) bundled by `scripts/build-vendor.mjs`. It imports the vendored
  `three.module.min.js` by relative path and is fetched lazily, only when a tier wants post-processing or a floor needs models.
  Rebuild it only when the vendored three version changes; the script refuses a version mismatch.
- `public/models/`: Kenney's CC0 Furniture Kit and Mini Characters, only the files used, with `NOTICE.txt` recording the
  source, the zip hashes and the licence text. The server now serves `.glb` (`model/gltf-binary`, gzipped) and `.png`.
- The static table is built at start-up, so the server must restart to pick the files up, as with any deploy.

## After deploying
1. Open the lobby on a desktop: `__stage.post` should be set and `__stage.q.ao` should read `full` (`half` on a phone,
   `off` after the frame-time watchdog decides the device can't keep up, and no post at all on the low tier).
2. Open a floor: people should get their model within a second or two (`[...__office.view.actors.values()][0].char.isModel`
   is true) and the furniture should swap (`__office.view.modelsOn`). If either stays false, check that
   `/theoffice/models/characters/character-male-a.glb` returns `model/gltf-binary` and that the addons bundle loads.
3. Nothing else changed in the API, the database or the environment.

## Rollback
Deploy `main` again. The branch adds files and changes only the client and the static-file types; there is no migration.

## Second pass (branch `ultra-look`)
Still no new environment variables, no build step, no CDN, and the CSP is unchanged. New on disk and worth checking after a deploy:

- **Stamped URLs.** `server/statics.js` reads `public/` at start-up and stamps every internal reference with a content version (`?v=...`): imports in every module, the page's links, font URLs in the stylesheets, and a version for the whole `models/` folder. The files on disk are not changed. A request whose `v` matches gets `cache-control: public, max-age=31536000, immutable`. A wrong `v` gets `no-cache`, no `v` gets the old hour. The page itself is `no-cache` with an ETag, so a return visit costs one small 304 and an API call. Check: `curl -sI 'https://iscolinfree.com/theoffice/'` shows `cache-control: no-cache` and an `etag`, and the `main.js?v=...` it names shows `immutable`.
- **Brotli.** `server/index.js` compresses every asset once after it starts listening, one at a time on the thread pool, which takes about 10 to 20 seconds of one core on first boot. Gzip answers until each file lands. The proxy in front must pass `content-encoding` and `vary` through and must not re-compress. If it strips `accept-encoding`, visitors simply get plain files, so check that `curl -sI -H 'accept-encoding: br' .../theoffice/js/main.js` shows `content-encoding: br` once the server has been up for half a minute.
- **Slimmer models.** The `.glb` files in `public/models` were re-packed by `scripts/strip-models.mjs` (unused animation clips and UVs removed, normals, UVs and skin weights stored as small integers). Three's loader reads this natively. If a future kit update replaces a file, run the script on it. `public/models/NOTICE.txt` records this.
- **A lost GPU.** `npm run e2e:resilience` proves the path in real Chrome. In a browser on the live site you can try it from the console: `__stage.renderer.getContext().getExtension('WEBGL_lose_context').loseContext()` should show the painted city at once, and `.restoreContext()` should bring the picture back.
- **Nothing migrates.** Rollback is deploying the previous branch. A browser holding the old stamped files simply never asks for them again.
