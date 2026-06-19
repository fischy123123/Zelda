import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Builds the post-processing pipeline: scene render -> bloom -> anti-alias ->
// tone-mapped sRGB output. Bloom makes emissive surfaces (rupees, torches, the
// sun, portals, fireflies) glow for a polished, cinematic look.
export function createComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();

  // HDR float target so bright highlights bloom smoothly.
  const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
    type: THREE.HalfFloatType,
    samples: 0,
  });
  const composer = new EffectComposer(renderer, target);

  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.65, // strength
    0.55, // radius
    0.82  // threshold — only bright/emissive pixels glow
  );
  composer.addPass(bloom);

  const smaa = new SMAAPass(size.x * pr, size.y * pr);
  composer.addPass(smaa);

  composer.addPass(new OutputPass());

  return { composer, bloom, smaa };
}
