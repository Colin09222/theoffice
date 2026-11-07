// The three.js addons bundle (post-processing chain, N8AO, GLTFLoader, SkeletonUtils) is a quarter of a megabyte, so it is
// fetched once, on demand, by whichever module first needs it: the stage when a tier wants post-processing, the models
// module when a floor asks for its furniture and people. The low tier on a phone never pays for it.
let pending = null;
export function loadAddons() {
  pending ||= import('../vendor/three/addons.module.min.js');
  return pending;
}
