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
