three.js r186 (npm three@0.186.1), MIT License (see LICENSE).
three.module.min.js = build/three.module.js + build/three.core.js bundled and minified with esbuild.
addons.module.min.js = the examples/jsm addons we use (EffectComposer, RenderPass, ShaderPass, UnrealBloomPass, OutputPass,
FXAAPass, GLTFLoader, SkeletonUtils, RoomEnvironment) plus n8ao 2.0.1 (ISC, https://github.com/N8python/n8ao), bundled by
scripts/build-vendor.mjs from the same three@0.186.1 package; it imports ./three.module.min.js so both share one module instance.
